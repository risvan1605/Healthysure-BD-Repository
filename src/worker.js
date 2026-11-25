// HealthySure BD — Cloudflare Worker
// Serves the static app (public/) and the /api/* routes:
//   GET  /api/sync?since=<rev>   -> shared edits newer than <rev> (pull)
//   POST /api/companies          -> upsert edited/new company records (push)
//   POST /api/feedback           -> founder review notes
//   POST /api/prospeo            -> proxy to Prospeo (avoids browser CORS)

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS_PER_PUSH = 200;
const SYNC_PAGE_SIZE = 2000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- Cloudflare Access JWT verification (defence in depth; enforced when ACCESS_AUD is set) ----
const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

let jwksCache = { at: 0, keys: null };
async function getJwks(teamDomain) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(500, 'Unable to fetch Access signing keys');
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

export async function verifyAccessJwt(token, teamDomain, aud, jwks) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Missing or malformed Access token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  const jwk = (jwks || await getJwks(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new HttpError(401, 'Unknown Access signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, 'Invalid Access token signature');
  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new HttpError(401, 'Access token audience mismatch');
  if (payload.iss !== `https://${teamDomain}`) throw new HttpError(401, 'Access token issuer mismatch');
  if (!payload.exp || payload.exp < now) throw new HttpError(401, 'Access token expired');
  return payload.email || payload.sub || 'unknown';
}

// Fail closed: the Access JWT is always verified. The only exception is local development,
// enabled explicitly with ALLOW_INSECURE_DEV=true (in .dev.vars, never in production vars).
// The Cf-Access-Authenticated-User-Email header is never trusted on its own (it is spoofable
// if the request reaches the Worker without passing through Access).
async function identify(request, env) {
  if (env.ALLOW_INSECURE_DEV === 'true') return 'local';
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) throw new HttpError(500, 'Auth not configured');
  return verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
}

// ---- Handlers ----
async function handleSync(request, env) {
  const url = new URL(request.url);
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const { results } = await env.DB
    .prepare('SELECT data, rev FROM company_overrides WHERE rev > ? ORDER BY rev ASC LIMIT ?')
    .bind(since, SYNC_PAGE_SIZE + 1)
    .all();
  const more = results.length > SYNC_PAGE_SIZE;
  const page = more ? results.slice(0, SYNC_PAGE_SIZE) : results;
  const rev = page.length ? page[page.length - 1].rev : since;
  const records = page.map((r) => {
    const rec = JSON.parse(r.data);
    rec._rev = r.rev;
    return rec;
  });
  return json({ rev, more, records });
}

async function handlePush(request, env, user) {
  const body = await readJson(request);
  const records = Array.isArray(body && body.records) ? body.records : null;
  if (!records || records.length === 0) throw new HttpError(400, 'records[] required');
  if (records.length > MAX_RECORDS_PER_PUSH) throw new HttpError(400, `Max ${MAX_RECORDS_PER_PUSH} records per request`);

  // Last write wins per id; de-duplicate within the request.
  const byId = new Map();
  for (const rec of records) {
    const id = Number(rec && rec.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Every record needs a positive integer id');
    if (!rec.name || typeof rec.name !== 'string') throw new HttpError(400, `Record ${id} needs a name`);
    const clean = { ...rec };
    delete clean._rev;
    byId.set(id, clean);
  }
  const items = [...byId.entries()];

  // Atomically reserve a block of revisions.
  const row = await env.DB
    .prepare('UPDATE rev_counter SET v = v + ? WHERE k = 1 RETURNING v')
    .bind(items.length)
    .first();
  const end = row.v;
  const start = end - items.length + 1;

  const stmts = [];
  items.forEach(([id, rec], i) => {
    const data = JSON.stringify(rec);
    const rev = start + i;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO company_overrides (id, data, rev, updated_at, updated_by)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, ?4)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, rev = excluded.rev,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      ).bind(id, data, rev, user),
      env.DB.prepare('INSERT INTO company_history (id, rev, data, updated_by) VALUES (?1, ?2, ?3, ?4)').bind(id, rev, data, user)
    );
  });
  await env.DB.batch(stmts);
  return json({ success: true, rev: end, saved: items.length });
}

async function handleFeedback(request, env, user) {
  const body = await readJson(request);
  await env.DB.prepare('INSERT INTO feedback (payload, created_by) VALUES (?1, ?2)').bind(JSON.stringify(body), user).run();
  return json({ success: true, message: 'Feedback recorded successfully' });
}

async function handleProspeo(request) {
  const body = await request.text();
  if (body.length > 64 * 1024) throw new HttpError(413, 'Payload too large');
  const key = request.headers.get('X-KEY') || request.headers.get('Authorization') || '';
  const headers = { 'content-type': 'application/json' };
  if (key) headers['X-KEY'] = key;
  const upstream = await fetch('https://api.prospeo.io/domain-search', { method: 'POST', headers, body });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      // Every request (static files included, e.g. the 27k-company dataset) must carry a valid Access JWT.
      const user = await identify(request, env);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/sync': return await handleSync(request, env);
        case 'POST /api/companies': return await handlePush(request, env, user);
        case 'POST /api/feedback': return await handleFeedback(request, env, user);
        case 'POST /api/prospeo': return await handleProspeo(request);
        case 'GET /api/me': return json({ user });
        default: return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
