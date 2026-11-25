import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord } from '../src/worker.js';

test('keeps known fields, drops unknown keys and non-primitive values', () => {
  const r = normalizeRecord({ id: '42', name: 'Acme', bd: 'Aditi', evil: '<script>', contact: { a: 1 }, remarks: 'ok', _rev: 9 });
  assert.deepEqual(r, { id: 42, name: 'Acme', bd: 'Aditi', contact: '', remarks: 'ok' });
});

test('rejects bad ids and missing names', () => {
  assert.throws(() => normalizeRecord({ id: "1);alert(1);//", name: 'x' }), /positive integer id/);
  assert.throws(() => normalizeRecord({ id: 5, name: '  ' }), /needs a name/);
  assert.throws(() => normalizeRecord(null), /object/);
  assert.throws(() => normalizeRecord([1]), /object/);
});

test('caps string length', () => {
  assert.equal(normalizeRecord({ id: 1, name: 'x'.repeat(5000) }).name.length, 300);
});

test('rebuilds spocs and aiIntelligence as plain string data', () => {
  const r = normalizeRecord({
    id: 1, name: 'A', aiEnriched: 'yes',
    spocs: [{ id: 'z', name: { toString: 1 }, title: 'CHRO', email: 'a@b.c', extra: 'x', isPrimary: true }, 'junk', null],
    aiIntelligence: { healthysure_renewal_hook: 'hi', nested: { a: 1 }, 'bad key!': 'x', n: 3 },
  });
  assert.equal(r.aiEnriched, false);
  assert.equal(r.spocs.length, 1);
  assert.deepEqual(r.spocs[0], { id: 1, isPrimary: true, name: '', title: 'CHRO', department: '', email: 'a@b.c', phone: '', authority: '' });
  assert.deepEqual(r.aiIntelligence, { healthysure_renewal_hook: 'hi', n: '3' });
});

test('rejects non-array spocs', () => {
  assert.throws(() => normalizeRecord({ id: 1, name: 'A', spocs: 'nope' }), /spocs must be an array/);
});
