'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHub } = require('../src/index');

test('register + test produce a manifest with assertions', () => {
  const hub = createHub({ apiKey: 'k', targetBaseUrl: 'http://localhost:4000' });
  hub.register({ method: 'GET', path: '/users/:id', name: 'Get user' });
  hub.test('GET /users/:id', { status: 200 });
  const manifest = hub.manifest();
  assert.equal(manifest.requests.length, 1);
  assert.equal(manifest.requests[0].assertions[0].expected, '200');
  assert.equal(manifest.requests[0].url, 'http://localhost:4000/users/:id');
});

test('test() on an unknown route throws', () => {
  const hub = createHub({ apiKey: 'k' });
  assert.throws(() => hub.test('GET /missing', { status: 200 }), /unknown route/);
});
