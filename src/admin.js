// Admin (export) password, checked on the server.
//   POST /api/admin/verify    {password, action}            -> {ok:true} or 401/429
//   POST /api/admin/password  {current, next}               -> changes the password
//
// The password is never in client code. Wrong guesses are throttled per signed-in user (atomically), and every
// check is written to admin_audit (who / when / what / success).
// NOTE: this controls *who may trigger* an export; the company data itself is already loaded in a
// signed-in user's browser, so this is an accountability + friction control, not data isolation.

import { AuthError } from './auth.js';

const ITERATIONS = 100000;            // Workers' PBKDF2 maximum
const MIN_PASSWORD_LENGTH = 10;
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILS_PER_USER = 5;
// Backstop against many-mailbox guessing: ~8 different people failing at once trips it. It never
// applies to password changes or to users who already passed the check in the window.
const MAX_FAILS_GLOBAL = 40;
const ACTIONS = new Set(['excel_export', 'crm_export', 'change_password']);

const enc = new TextEncoder();
const nowSec = () => Math.floor(Date.now() / 1000);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/.{2}/g) || [], (h) => parseInt(h, 16));

export async function pbkdf2Hex(password, saltBytes, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256));
}

// Constant-time string comparison (HMAC both sides under a throwaway key, compare MACs).
export async function constantTimeEquals(a, b) {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(String(a)));
  return crypto.subtle.verify('HMAC', key, mac, enc.encode(String(b)));
}

async function checkPassword(env, password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) return false;
  const row = await env.DB.prepare('SELECT salt, hash, iterations FROM admin_credentials WHERE id = 1').first();
  if (row) return constantTimeEquals(await pbkdf2Hex(password, fromHex(row.salt), row.iterations), row.hash);
  if (!env.ADMIN_PASSWORD) throw new AuthError(500, 'Admin password not configured');
  return constantTimeEquals(password, env.ADMIN_PASSWORD);
}

// Reserve an attempt *atomically* before the password is checked: one SQL statement inserts a
// pending (ok = 0) row only while this user is under the limit. Parallel guesses therefore cannot
// all pass a check-then-insert gap. The row is flipped to ok = 1 if the password turns out correct.
// Throttling is per signed-in user only (an office/VPN shares one IP, so IP lockouts would let one
// person block everyone); the IP is recorded in the audit log for investigation. A high global
// failure cap backstops attackers who control many mailboxes.
async function reserveAttempt(env, email, ip, action) {
  const now = nowSec();
  const row = await env.DB.prepare(
    `INSERT INTO admin_audit (email, ip, action, ok, created_at)
     SELECT ?1, ?2, ?3, 0, ?4
     WHERE (SELECT COUNT(*) FROM admin_audit WHERE email = ?1 AND ok = 0 AND created_at > ?5) < ?6
       AND (
         ?3 = 'change_password'
         OR EXISTS (SELECT 1 FROM admin_audit WHERE email = ?1 AND ok = 1 AND created_at > ?5)
         OR (SELECT COUNT(*) FROM admin_audit WHERE ok = 0 AND created_at > ?5) < ?7
       )
     RETURNING id`
  ).bind(email, ip, action, now, now - WINDOW_SECONDS, MAX_FAILS_PER_USER, MAX_FAILS_GLOBAL).first();
  if (!row) throw new AuthError(429, 'Too many incorrect attempts. Try again in a few minutes.');
  return row.id;
}

// Runs the password check for a reserved attempt and records the outcome.
async function checkReserved(env, attemptId, password) {
  let ok;
  try {
    ok = await checkPassword(env, password);
  } catch (err) {
    await env.DB.prepare('DELETE FROM admin_audit WHERE id = ?').bind(attemptId).run(); // config error, not a guess
    throw err;
  }
  if (ok) await env.DB.prepare('UPDATE admin_audit SET ok = 1 WHERE id = ?').bind(attemptId).run();
  return ok;
}

const ipOf = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

export async function handleAdminVerify(request, env, user, body) {
  const action = body && body.action;
  if (!ACTIONS.has(action) || action === 'change_password') throw new AuthError(400, 'Unknown action');
  const attemptId = await reserveAttempt(env, user, ipOf(request), action);
  const ok = await checkReserved(env, attemptId, body && body.password);
  if (!ok) throw new AuthError(401, 'Incorrect admin password');
  return { ok: true };
}

export async function handleAdminPasswordChange(request, env, user, body) {
  const next = body && body.next;
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH || next.length > 200) {
    throw new AuthError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const attemptId = await reserveAttempt(env, user, ipOf(request), 'change_password');
  const ok = await checkReserved(env, attemptId, body && body.current);
  if (!ok) throw new AuthError(401, 'Current admin password is incorrect');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(next, salt);
  await env.DB.prepare(
    `INSERT INTO admin_credentials (id, salt, hash, iterations, updated_at, updated_by) VALUES (1, ?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, iterations = excluded.iterations,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(toHex(salt), hash, ITERATIONS, nowSec(), user).run();
  return { ok: true };
}
