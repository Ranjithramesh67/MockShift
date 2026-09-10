'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExpects } = require('../src/assertions');

test('maps status, json, headers and responseTime into assertion objects', () => {
  const out = normalizeExpects({
    status: 200,
    json: { 'data.id': '1' },
    headers: { 'content-type': 'application/json' },
    responseTimeMs: 500,
  });
  const byType = Object.fromEntries(out.map((a) => [a.type, a]));
  assert.equal(byType.status.expected, '200');
  assert.equal(byType.jsonPath.path, 'data.id');
  assert.equal(byType.jsonPath.operator, 'eq');
  assert.equal(byType.header.path, 'content-type');
  assert.equal(byType.header.operator, 'contains');
  assert.equal(byType.responseTime.operator, 'lt');
  assert.equal(byType.responseTime.expected, '500');
});

test('empty expects yields an empty list', () => {
  assert.deepEqual(normalizeExpects(), []);
});
