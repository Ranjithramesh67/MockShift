'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changedFields, stableStringify } = require('../collabDiff');

test('changedFields reports only fields whose value changed', () => {
  const before = { name: 'A', url: 'https://old', method: 'GET' };
  const after = { name: 'A', url: 'https://new', method: 'GET' };
  assert.deepEqual(changedFields(before, after), [
    { field: 'url', from: 'https://old', to: 'https://new' },
  ]);
});

test('changedFields ignores object key order within array items', () => {
  const before = { headers: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] };
  const after = { headers: [{ value: '1', key: 'A' }, { value: '2', key: 'B' }] };
  assert.deepEqual(changedFields(before, after), []);
});

test('changedFields treats reordered array items as a change', () => {
  const before = { headers: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] };
  const after = { headers: [{ value: '2', key: 'B' }, { value: '1', key: 'A' }] };
  const fields = changedFields(before, after);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].field, 'headers');
});

test('changedFields returns [] when nothing changed and normalises undefined to null', () => {
  assert.deepEqual(changedFields({ name: 'A' }, { name: 'A' }), []);
  assert.deepEqual(changedFields({}, { formula: '' }), [
    { field: 'formula', from: null, to: '' },
  ]);
});

test('stableStringify sorts keys so equivalent objects compare equal', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
});
