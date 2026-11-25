// Admin (export) password, checked on the server.
//   POST /api/admin/verify    {password, action}            -> {ok:true} or 401/429
//   POST /api/admin/password  {current, next}               -> changes the password
//
// The password is never in client code. Wrong guesses are throttled per user and per IP, and every
// check is written to admin_audit (who / when / what / success).
// NOTE: this controls *who may trigger* an export; the company data itself is already loaded in a
// signed-in user's browser, so this is an accountability + friction control, not data isolation.

import { AuthError } from './auth.js';

const ITERATIONS = 100000;            // Workers' PBKDF2 maximum
const MIN_PASSWORD_LENGTH = 10;
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILS_PER_USER = 5;
const MAX_FAILS_PER_IP = 15;
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

async function audit(env, email, ip, action, ok) {
  const now = nowSec();
  await env.DB.prepare('INSERT INTO admin_audit (email, ip, action, ok, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(email, ip, action, ok ? 1 : 0, now).run();
}

async function throttle(env, email, ip) {
  const since = nowSec() - WINDOW_SECONDS;
  const count = async (col, val) => (await env.DB.prepare(`SELECT COUNT(*) c FROM admin_audit WHERE ${col} = ? AND ok = 0 AND created_at > ?`).bind(val, since).first()).c;
  if ((await count('email', email)) >= MAX_FAILS_PER_USER || (await count('ip', ip)) >= MAX_FAILS_PER_IP) {
    throw new AuthError(429, 'Too many incorrect attempts. Try again in a few minutes.');
  }
}

const ipOf = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

export async function handleAdminVerify(request, env, user, body) {
  const action = body && body.action;
  if (!ACTIONS.has(action) || action === 'change_password') throw new AuthError(400, 'Unknown action');
  const ip = ipOf(request);
  await throttle(env, user, ip);
  const ok = await checkPassword(env, body && body.password);
  await audit(env, user, ip, action, ok);
  if (!ok) throw new AuthError(401, 'Incorrect admin password');
  return { ok: true };
}

export async function handleAdminPasswordChange(request, env, user, body) {
  const ip = ipOf(request);
  const next = body && body.next;
  if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH || next.length > 200) {
    throw new AuthError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  await throttle(env, user, ip);
  const ok = await checkPassword(env, body && body.current);
  await audit(env, user, ip, 'change_password', ok);
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
