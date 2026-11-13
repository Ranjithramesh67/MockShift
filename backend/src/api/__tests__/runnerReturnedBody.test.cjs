'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparePipeline } = require('../runner');

function request(overrides = {}) {
  return {
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [],
    query_params: [],
    body_type: 'JSON',
    body_json: { placeholder: true },
    body_text: null,
    body_parts: null,
    api_type: 'REST',
    collection_id: null,
    formula: '',
    assertions: [],
    ...overrides,
  };
}

test('applies a formula return object as the request body (REQUEST-2)', async () => {
  const prepared = await preparePipeline({
    request: request({
      formula: '({ orderId: $vars.base + 1, total: 19.99 })',
    }),
    vars: { base: 6 },
    userId: null,
  });
  assert.deepEqual(JSON.parse(prepared.body), { orderId: 7, total: 19.99 });
});

test('applies a formula return string as the request body', async () => {
  const prepared = await preparePipeline({
    request: request({
      body_type: 'RAW',
      body_json: null,
      formula: '"raw-payload"',
    }),
    vars: {},
    userId: null,
  });
  assert.equal(prepared.body, 'raw-payload');
});

test('parses a JSON string return value into the request body', async () => {
  const prepared = await preparePipeline({
    request: request({
      formula: 'JSON.stringify({ token: "abc" })',
    }),
    vars: {},
    userId: null,
  });
  assert.deepEqual(JSON.parse(prepared.body), { token: 'abc' });
});

test('keeps req.body mutation when the formula also yields a leftover primitive', async () => {
  const prepared = await preparePipeline({
    request: request({
      formula: 'req.body = { mutated: true }; 1',
    }),
    vars: {},
    userId: null,
  });
  assert.deepEqual(JSON.parse(prepared.body), { mutated: true });
});
