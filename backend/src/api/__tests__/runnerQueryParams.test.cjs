'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparePipeline } = require('../runner');

function request(overrides = {}) {
  return {
    method: 'GET',
    url: 'https://api.example.com/posts',
    headers: [],
    query_params: [],
    body_type: 'NONE',
    body_json: null,
    body_text: null,
    body_parts: null,
    api_type: 'REST',
    collection_id: null,
    formula: '',
    assertions: [],
    ...overrides,
  };
}

test('appends enabled query params onto the prepared URL (REQUEST-1)', async () => {
  const prepared = await preparePipeline({
    request: request({
      query_params: [
        { key: 'page', value: '2', enabled: true },
        { key: 'limit', value: '10', enabled: true },
        { key: 'secret', value: 'nope', enabled: false },
        { key: '', value: 'skip', enabled: true },
      ],
    }),
    vars: {},
    userId: null,
  });
  const u = new URL(prepared.url);
  assert.equal(u.origin + u.pathname, 'https://api.example.com/posts');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('limit'), '10');
  assert.equal(u.searchParams.has('secret'), false);
});

test('does not duplicate a query key already present on the URL', async () => {
  const prepared = await preparePipeline({
    request: request({
      url: 'https://api.example.com/posts?page=1',
      query_params: [
        { key: 'page', value: '9', enabled: true },
        { key: 'q', value: 'books', enabled: true },
      ],
    }),
    vars: {},
    userId: null,
  });
  const u = new URL(prepared.url);
  assert.equal(u.searchParams.getAll('page').join(','), '1');
  assert.equal(u.searchParams.get('q'), 'books');
});

test('substitutes environment variables in query values', async () => {
  const prepared = await preparePipeline({
    request: request({
      query_params: [{ key: 'token', value: '{{apiKey}}', enabled: true }],
    }),
    vars: { apiKey: 'abc-123' },
    userId: null,
  });
  assert.equal(new URL(prepared.url).searchParams.get('token'), 'abc-123');
});
