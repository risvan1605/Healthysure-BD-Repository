import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isAllowedEmail } from '../src/auth.js';

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

