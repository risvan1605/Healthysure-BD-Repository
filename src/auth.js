// Emailed one-time-code login (SendGrid) with signed session cookies.
//
//   POST /auth/request {email}        -> emails an 8-digit code (always answers the same, so
//                                        callers cannot learn which addresses are allowed)
//   POST /auth/verify  {email, code}  -> sets the session cookie
//   POST /auth/logout                 -> clears it
//   GET  /login                       -> the login page
//
// Secrets (wrangler secret put): SESSION_SECRET, SENDGRID_API_KEY
// Vars (wrangler.jsonc): ALLOWED_EMAIL_DOMAINS, ALLOWED_EMAILS (optional), EMAIL_FROM, EMAIL_FROM_NAME

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CODE_DIGITS = 8;
const REQUESTS_PER_EMAIL_AND_IP = 3;  // per 15 min: one visitor cannot lock others out of an address
const REQUESTS_PER_EMAIL = 10;        // per 15 min, across all IPs: bounds mail flooding and guess volume
const REQUESTS_PER_IP = 20;           // per 15 min
const FAILED_VERIFY_PER_IP = 20;      // per 15 min
const RATE_WINDOW_SECONDS = 15 * 60;

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const enc = new TextEncoder();
const nowSec = () => Math.floor(Date.now() / 1000);

const toB64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);

async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function requireSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new AuthError(500, 'Auth not configured');
  return env.SESSION_SECRET;
}

// ---- Email allowlist ----
export function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null; // exactly one '@', no spaces/commas
  return e;
}

const csv = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function isAllowedEmail(email, env) {
  if (!email) return false;
  const domains = csv(env.ALLOWED_EMAIL_DOMAINS).map((d) => d.replace(/^@/, ''));
  const list = csv(env.ALLOWED_EMAILS);
  return list.includes(email) || domains.includes(email.split('@')[1]);
}

// ---- Sessions (server-side; the cookie holds only a random token) ----
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isSecure = (url) => url.protocol === 'https:';
const cookieName = (url) => (isSecure(url) ? '__Host-hs_session' : 'hs_session');

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(url, value, maxAge) {
  return `${cookieName(url)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isSecure(url) ? '; Secure' : ''}`;
}

async function createSession(env, url, email) {
  const token = toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = nowSec();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO sessions (id_hash, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), email, now + SESSION_TTL_SECONDS, now).run();
  return sessionCookie(url, token, SESSION_TTL_SECONDS);
}

export async function getSessionUser(request, env) {
  if (env.ALLOW_INSECURE_DEV === 'true') return 'local';
  requireSecret(env);
  const token = readCookie(request, cookieName(new URL(request.url)));
  if (!token || token.length > 128) return null;
  const row = await env.DB.prepare('SELECT email FROM sessions WHERE id_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), nowSec()).first();
  // The allowlist is re-checked on every request, so removing someone takes effect immediately.
  return row && isAllowedEmail(row.email, env) ? row.email : null;
}

export async function destroySession(request, env) {
  const token = readCookie(request, cookieName(new URL(request.url)));
  if (token && token.length <= 128) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(token)).run();
}

// ---- One-time codes ----
function randomCode() {
  const buf = new Uint32Array(1);
  const space = 10 ** CODE_DIGITS;
  const limit = Math.floor(0x100000000 / space) * space; // rejection sampling: no modulo bias
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % space).padStart(CODE_DIGITS, '0');
}

async function sendCodeEmail(env, to, code) {
  if (!env.SENDGRID_API_KEY) {
    if (env.DEV_LOG_OTP === 'true') { console.log(`[DEV] sign-in code for ${to}: ${code}`); return; }
    throw new AuthError(500, 'Email not configured');
  }
  const minutes = OTP_TTL_SECONDS / 60;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || 'HealthySure BD' },
      subject: `Your HealthySure BD sign-in code: ${code}`,
      content: [
        { type: 'text/plain', value: `Your HealthySure BD sign-in code is ${code}.\n\nIt expires in ${minutes} minutes and can be used once. If you did not request it, ignore this email.` },
        { type: 'text/html', value: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your HealthySure BD sign-in code is</p><p style="font-size:32px;letter-spacing:6px;font-weight:700;color:#0e8770">${code}</p><p style="color:#605e5c;font-size:13px">It expires in ${minutes} minutes and can be used once. If you did not request it, ignore this email.</p></div>` },
      ],
    }),
  });
  if (!res.ok) console.error('SendGrid error status', res.status); // body intentionally not logged
}

export async function requestCode(request, env, body) {
  const secret = requireSecret(env);
  if (!env.SENDGRID_API_KEY && env.DEV_LOG_OTP !== 'true') throw new AuthError(500, 'Email not configured');
  if (env.SENDGRID_API_KEY && !env.EMAIL_FROM) throw new AuthError(500, 'Email not configured');

  const email = normalizeEmail(body && body.email);
  if (!email) throw new AuthError(400, 'Enter a valid email address');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = nowSec();
  await env.DB.prepare('DELETE FROM otp_codes WHERE created_at < ?').bind(now - 24 * 3600).run();

  const since = now - RATE_WINDOW_SECONDS;
  const count = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()).c;
  const [byPair, byEmail, byIp] = await Promise.all([
    count('SELECT COUNT(*) c FROM otp_codes WHERE email = ? AND ip = ? AND created_at > ?', email, ip, since),
    count('SELECT COUNT(*) c FROM otp_codes WHERE email = ? AND created_at > ?', email, since),
    count('SELECT COUNT(*) c FROM otp_codes WHERE ip = ? AND created_at > ?', ip, since),
  ]);
  if (byPair >= REQUESTS_PER_EMAIL_AND_IP || byEmail >= REQUESTS_PER_EMAIL || byIp >= REQUESTS_PER_IP) {
    throw new AuthError(429, 'Too many requests. Try again in a few minutes.');
  }

  // Same response whether or not the address is allowed (no account enumeration).
  if (isAllowedEmail(email, env)) {
    const code = randomCode();
    await env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(email, await hmacHex(secret, `${email}:${code}`), now + OTP_TTL_SECONDS, ip, now).run();
    await sendCodeEmail(env, email, code);
  } else {
    // Record the attempt so disallowed addresses are rate-limited too.
    await env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(email, '-', now, ip, now).run();
  }
  return { ok: true, message: 'If this address is allowed, a code has been sent.' };
}

export async function verifyCode(request, env, body) {
  requireSecret(env);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = nowSec();
  const failures = (await env.DB.prepare('SELECT COUNT(*) c FROM auth_failures WHERE ip = ? AND created_at > ?')
    .bind(ip, now - RATE_WINDOW_SECONDS).first()).c;
  if (failures >= FAILED_VERIFY_PER_IP) throw new AuthError(429, 'Too many attempts. Try again in a few minutes.');
  try {
    return await verifyCodeInner(request, env, body);
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) {
      await env.DB.prepare('INSERT INTO auth_failures (ip, created_at) VALUES (?1, ?2)').bind(ip, now).run();
      await env.DB.prepare('DELETE FROM auth_failures WHERE created_at < ?').bind(now - 24 * 3600).run();
    }
    throw err;
  }
}

async function verifyCodeInner(request, env, body) {
  const secret = requireSecret(env);
  const email = normalizeEmail(body && body.email);
  const code = String((body && body.code) || '').trim();
  const fail = () => new AuthError(401, 'Invalid or expired code');
  if (!email || !new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code) || !isAllowedEmail(email, env)) throw fail();

  const latest = await env.DB.prepare('SELECT id FROM otp_codes WHERE email = ? AND code_hash != ? ORDER BY id DESC LIMIT 1').bind(email, '-').first();
  if (!latest) throw fail();
  // Atomic: the attempt is counted before comparing, and a code that reached the limit returns nothing.
  const row = await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND expires_at > ? RETURNING code_hash')
    .bind(latest.id, OTP_MAX_ATTEMPTS, nowSec()).first();
  if (!row) throw fail();

  // Constant-time comparison (crypto.subtle.verify) of the stored HMAC against the submitted code.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), fromHex(row.code_hash), enc.encode(`${email}:${code}`)).catch(() => false);
  if (!ok) throw fail();

  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run(); // single use
  return { email, cookie: await createSession(env, new URL(request.url), email) };
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export const clearSessionCookie = (url) => sessionCookie(url, '', 0);

// ---- Login page ----
export const LOGIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in | HealthySure BD</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f2f1;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#201f1e}
.card{width:min(380px,92vw);background:#fff;border:1px solid #e1dfdd;border-radius:8px;padding:28px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#605e5c;font-size:13px;line-height:1.45}
label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
input{width:100%;padding:10px 12px;border:1px solid #c8c6c4;border-radius:4px;font-size:15px}input:focus{outline:2px solid #11a387;border-color:#11a387}
#code{letter-spacing:6px;font-size:20px;text-align:center;font-weight:600}
button{width:100%;margin-top:14px;padding:10px;border:0;border-radius:4px;background:#11a387;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}.link{background:none;color:#0e8770;margin-top:8px;font-weight:500;font-size:12px}
#msg{min-height:18px;margin-top:12px;font-size:12px;color:#a80000}#msg.ok{color:#0e8770}.hidden{display:none}
</style></head><body><main class="card">
<h1>HealthySure BD</h1><p id="sub">Sign in with your work email. We'll send you a 8-digit code.</p>
<form id="f1"><label for="email">Work email</label><input id="email" type="email" autocomplete="email" required autofocus placeholder="you@bharatsure.com"><button id="b1">Send code</button></form>
<form id="f2" class="hidden"><label for="code">8-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="\\d{8}" required><button id="b2">Verify &amp; sign in</button><button type="button" class="link" id="back">Use a different email</button></form>
<div id="msg" role="status"></div></main>
<script>
const $=i=>document.getElementById(i),msg=(t,ok)=>{$('msg').textContent=t||'';$('msg').className=ok?'ok':''};
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Something went wrong');return d}
$('f1').onsubmit=async e=>{e.preventDefault();$('b1').disabled=true;msg('');try{await post('/auth/request',{email:$('email').value});$('f1').classList.add('hidden');$('f2').classList.remove('hidden');$('sub').textContent='Enter the code sent to '+$('email').value.trim()+'.';msg('Code sent if this address is allowed. It expires in 10 minutes.',true);$('code').focus()}catch(x){msg(x.message)}$('b1').disabled=false};
$('f2').onsubmit=async e=>{e.preventDefault();$('b2').disabled=true;msg('');try{await post('/auth/verify',{email:$('email').value,code:$('code').value});location.replace('/')}catch(x){msg(x.message);$('b2').disabled=false}};
$('back').onclick=()=>{$('f2').classList.add('hidden');$('f1').classList.remove('hidden');$('sub').textContent="Sign in with your work email. We'll send you a 8-digit code.";$('code').value='';msg('')};
</script></body></html>`;
