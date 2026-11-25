import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isAllowedEmail, createSessionToken, readSessionToken } from '../src/auth.js';

const SECRET = 'x'.repeat(40);

test('normalizeEmail accepts normal addresses and rejects junk', () => {
  assert.equal(normalizeEmail('  Risvan@BharatSure.com '), 'risvan@bharatsure.com');
  for (const bad of ['', 'a', 'a@b', 'a@@b.com', 'a@b.com@evil.com', 'a b@c.com', 'a@b.com,c@d.com', 'a@b.com\nbcc:x@y.com', null, undefined, 'x'.repeat(300) + '@b.com']) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
  }
});

test('allowlist: exact domain match only, or explicit address', () => {
  const env = { ALLOWED_EMAIL_DOMAINS: 'bharatsure.com, @healthysure.in', ALLOWED_EMAILS: 'guest@gmail.com' };
  assert.ok(isAllowedEmail('a@bharatsure.com', env));
  assert.ok(isAllowedEmail('a@healthysure.in', env));
  assert.ok(isAllowedEmail('guest@gmail.com', env));
  assert.ok(!isAllowedEmail('a@evilbharatsure.com', env));
  assert.ok(!isAllowedEmail('a@bharatsure.com.evil.com', env));
  assert.ok(!isAllowedEmail('a@sub.bharatsure.com', env));
  assert.ok(!isAllowedEmail('other@gmail.com', env));
  assert.ok(!isAllowedEmail('a@bharatsure.com', {}));
});

test('session token round-trips, and rejects tampering, wrong key and expiry', async () => {
  const t = await createSessionToken(SECRET, 'a@bharatsure.com');
  assert.equal(await readSessionToken(SECRET, t), 'a@bharatsure.com');
  assert.equal(await readSessionToken('y'.repeat(40), t), null);
  const [payload, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'boss@bharatsure.com', exp: 9999999999 })).toString('base64url');
  assert.equal(await readSessionToken(SECRET, `${forged}.${sig}`), null);
  assert.equal(await readSessionToken(SECRET, `${payload}.`), null);
  assert.equal(await readSessionToken(SECRET, 'garbage'), null);
  assert.equal(await readSessionToken(SECRET, await createSessionToken(SECRET, 'a@bharatsure.com', -10)), null);
});
