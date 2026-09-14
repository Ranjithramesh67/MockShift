'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serializeRequest, REQUEST_SELECT } = require('../requestSnapshot');

test('serializeRequest maps snake_case columns to the camelCase snapshot shape', () => {
  const row = {
    id: 'r1',
    name: 'Get user',
    method: 'GET',
    url: 'https://example.com/users',
    headers: [{ key: 'A', value: '1', enabled: true }],
    query_params: [{ key: 'q', value: 'x', enabled: true }],
    body_type: 'JSON',
    body_json: '{"a":1}',
    body_text: null,
    body_parts: [],
    api_type: 'REST',
    folder_id: null,
    formula: '',
    assertions: [],
  };
  assert.deepEqual(serializeRequest(row), {
    id: 'r1',
    name: 'Get user',
    method: 'GET',
    url: 'https://example.com/users',
    headers: [{ key: 'A', value: '1', enabled: true }],
    queryParams: [{ key: 'q', value: 'x', enabled: true }],
    bodyType: 'JSON',
    bodyJson: '{"a":1}',
    bodyText: null,
    bodyParts: [],
    apiType: 'REST',
    folderId: null,
    formula: '',
    assertions: [],
  });
});

test('serializeRequest applies defaults for null jsonb columns and passes through null', () => {
  assert.equal(serializeRequest(null), null);
  const s = serializeRequest({ id: 'r2', headers: null, query_params: null, body_parts: null, assertions: null });
  assert.deepEqual(s.headers, []);
  assert.deepEqual(s.queryParams, []);
  assert.deepEqual(s.bodyParts, []);
  assert.deepEqual(s.assertions, []);
  assert.equal(s.name, undefined);
  assert.equal(s.folderId, null);
  assert.equal(s.formula, '');
});

test('REQUEST_SELECT lists the columns serializeRequest reads', () => {
  for (const col of ['id', 'name', 'method', 'url', 'headers', 'query_params', 'body_type',
    'body_json', 'body_text', 'body_parts', 'api_type', 'folder_id', 'formula', 'assertions']) {
    assert.ok(REQUEST_SELECT.includes(col), `missing ${col}`);
  }
});
