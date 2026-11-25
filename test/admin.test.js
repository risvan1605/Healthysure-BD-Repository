import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Hex, constantTimeEquals } from '../src/admin.js';

test('pbkdf2: deterministic per salt, different across salts and passwords', async () => {
  const salt = new Uint8Array(16).fill(7);
  const a = await pbkdf2Hex('correct horse', salt, 1000);
  assert.equal(a, await pbkdf2Hex('correct horse', salt, 1000));
  assert.notEqual(a, await pbkdf2Hex('correct horsf', salt, 1000));
  assert.notEqual(a, await pbkdf2Hex('correct horse', new Uint8Array(16).fill(8), 1000));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('constantTimeEquals', async () => {
  assert.equal(await constantTimeEquals('abc', 'abc'), true);
  assert.equal(await constantTimeEquals('abc', 'abd'), false);
  assert.equal(await constantTimeEquals('abc', 'abcd'), false);
  assert.equal(await constantTimeEquals('', 'x'), false);
});
