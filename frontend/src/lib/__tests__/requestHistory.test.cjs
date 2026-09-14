'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fieldLabel, formatValue, revisionSummary, formatChange } = require('../requestHistory');

test('fieldLabel maps known fields to human labels and passes unknown through', () => {
  assert.equal(fieldLabel('url'), 'URL');
  assert.equal(fieldLabel('queryParams'), 'Query params');
  assert.equal(fieldLabel('mystery'), 'mystery');
});

test('formatValue renders strings, empties, nulls and objects', () => {
  assert.equal(formatValue('GET'), 'GET');
  assert.equal(formatValue(''), '(empty)');
  assert.equal(formatValue(null), '—');
  assert.equal(formatValue(undefined), '—');
  assert.equal(formatValue(false), 'false');
  assert.equal(formatValue([{ key: 'A', value: '1' }]), '[{"key":"A","value":"1"}]');
});

test('revisionSummary describes create, rollback and changed fields', () => {
  assert.equal(revisionSummary({ changeKind: 'create', changedFields: [] }), 'Created');
  assert.equal(revisionSummary({ changeKind: 'rollback', changedFields: [] }), 'Restored an earlier version');
  assert.equal(
    revisionSummary({ changeKind: 'update', changedFields: [{ field: 'url' }, { field: 'headers' }] }),
    'URL, Headers'
  );
  assert.equal(
    revisionSummary({
      changeKind: 'update',
      changedFields: [{ field: 'url' }, { field: 'headers' }, { field: 'bodyJson' }, { field: 'formula' }],
    }),
    'URL, Headers, Body (JSON) +1 more'
  );
  assert.equal(revisionSummary({ changeKind: 'update', changedFields: [] }), 'No field changes');
});

test('formatChange returns labelled before/after strings', () => {
  assert.deepEqual(formatChange({ field: 'url', from: 'https://a', to: 'https://b' }), {
    label: 'URL',
    before: 'https://a',
    after: 'https://b',
  });
});
