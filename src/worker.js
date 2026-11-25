// HealthySure BD — Cloudflare Worker
// Serves the static app (public/) and the /api/* routes:
//   GET  /api/sync?since=<rev>   -> shared edits newer than <rev> (pull)
//   POST /api/companies          -> upsert edited/new company records (push)
//   POST /api/feedback           -> founder review notes
//   POST /api/prospeo            -> proxy to Prospeo (avoids browser CORS)

import { handleAdminPasswordChange, handleAdminVerify } from './admin.js';
import { AuthError, LOGIN_HTML, clearSessionCookie, destroySession, getSessionUser, requestCode, verifyCode } from './auth.js';

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

// ---- Record schema (allowlist) ----
// Only known keys survive, values are coerced to capped primitives, spocs/aiIntelligence are
// rebuilt from scratch. Anything else a client sends is dropped, so one user cannot plant
// unexpected structures in data that every other user's browser renders.
const STRING_FIELDS = {
  name: 300, strength: 40, size: 40, location: 300, bd: 100, src: 500, dataSourceCategory: 200,
  dataSource: 200, contact: 300, designation: 300, email: 300, phone: 100, remarks: 5000,
  month: 40, date: 40, status: 40, insurer: 300, broker: 300, premium: 100, website: 300,
};
const SPOC_STRING_FIELDS = { name: 300, title: 300, department: 300, email: 300, phone: 100, authority: 300 };
const MAX_SPOCS = 20;
const MAX_INTEL_KEYS = 30;

const str = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).slice(0, max);

export function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new HttpError(400, 'Record must be an object');
  const id = Number(rec.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Every record needs a positive integer id');
  const out = { id };
  for (const [k, max] of Object.entries(STRING_FIELDS)) {
    if (rec[k] !== undefined) out[k] = str(rec[k], max);
  }
  if (!out.name || !out.name.trim()) throw new HttpError(400, `Record ${id} needs a name`);
  if (rec.aiEnriched !== undefined) out.aiEnriched = rec.aiEnriched === true;
  if (rec.spocs !== undefined) {
    if (!Array.isArray(rec.spocs)) throw new HttpError(400, `Record ${id}: spocs must be an array`);
    out.spocs = rec.spocs.slice(0, MAX_SPOCS).filter((x) => x && typeof x === 'object').map((x, i) => {
      const spoc = { id: Number.isSafeInteger(Number(x.id)) ? Number(x.id) : i + 1, isPrimary: x.isPrimary === true };
      for (const [k, max] of Object.entries(SPOC_STRING_FIELDS)) spoc[k] = str(x[k], max);
      return spoc;
    });
  }
  if (rec.aiIntelligence && typeof rec.aiIntelligence === 'object' && !Array.isArray(rec.aiIntelligence)) {
    // Flat map of short strings only (e.g. healthysure_renewal_hook).
    const intel = {};
    for (const [k, v] of Object.entries(rec.aiIntelligence).slice(0, MAX_INTEL_KEYS)) {
      if (/^[A-Za-z0-9_]{1,60}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) intel[k] = str(v, 5000);
    }
    out.aiIntelligence = intel;
  }
  return out;
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
    const clean = normalizeRecord(rec);
    byId.set(clean.id, clean);
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

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const withHeaders = (res, extra = {}) => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...securityHeaders, ...extra })) out.headers.set(k, v);
  return out;
};

const wantsHtml = (request) =>
  request.headers.get('Sec-Fetch-Dest') === 'document' || (request.headers.get('Accept') || '').includes('text/html');

// Cross-site POSTs are refused (the session cookie is SameSite=Lax as well).
function checkOrigin(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-origin request refused');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      checkOrigin(request, url);

      // ---- Public: login page + auth endpoints ----
      if (url.pathname === '/login' && request.method === 'GET') {
        return withHeaders(new Response(LOGIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }));
      }
      if (url.pathname === '/auth/request' && request.method === 'POST') {
        return withHeaders(json(await requestCode(request, env, await readJson(request))));
      }
      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        const { email, cookie } = await verifyCode(request, env, await readJson(request));
        return withHeaders(json({ ok: true, email }), { 'set-cookie': cookie });
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        await destroySession(request, env); // server-side: the cookie is dead even if someone copied it
        return withHeaders(json({ ok: true }), { 'set-cookie': clearSessionCookie(url) });
      }

      // ---- Everything else needs a session (pages, the 27k-company data file, the API) ----
      const user = await getSessionUser(request, env);
      if (!user) {
        if (!url.pathname.startsWith('/api/') && wantsHtml(request) && request.method === 'GET') {
          return withHeaders(new Response(null, { status: 302, headers: { location: '/login', 'cache-control': 'no-store' } }));
        }
        return withHeaders(json({ error: 'Not signed in' }, 401));
      }
      if (!url.pathname.startsWith('/api/')) {
        return withHeaders(await env.ASSETS.fetch(request), { 'cache-control': 'private, no-cache' });
      }

      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/sync': return withHeaders(await handleSync(request, env));
        case 'POST /api/companies': return withHeaders(await handlePush(request, env, user));
        case 'POST /api/feedback': return withHeaders(await handleFeedback(request, env, user));
        case 'POST /api/prospeo': return withHeaders(await handleProspeo(request));
        case 'POST /api/admin/verify': return withHeaders(json(await handleAdminVerify(request, env, user, await readJson(request))));
        case 'POST /api/admin/password': return withHeaders(json(await handleAdminPasswordChange(request, env, user, await readJson(request))));
        case 'GET /api/me': return withHeaders(json({ user }));
        default: return withHeaders(json({ error: 'Not found' }, 404));
      }
    } catch (err) {
      if (err instanceof HttpError || err instanceof AuthError) return withHeaders(json({ error: err.message }, err.status));
      console.error(err);
      return withHeaders(json({ error: 'Internal error' }, 500));
    }
  },
};
