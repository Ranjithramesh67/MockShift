'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractToken, resolveAuthHeader, applyAuthHeader } = require('../authToken');

test('extractToken reads dotted paths', () => {
  const body = { access_token: 'tok-1', data: { token: { id: 'nested' } }, list: [{ token: 'first' }] };
  assert.equal(extractToken(body, 'access_token'), 'tok-1');
  assert.equal(extractToken(body, 'data.token.id'), 'nested');
  assert.equal(extractToken(body, "data['token']['id']"), 'nested');
  assert.equal(extractToken(body, 'list[0].token'), 'first');
  assert.equal(extractToken(body, 'missing.path'), undefined);
  assert.equal(extractToken(body, ''), undefined);
  assert.equal(extractToken(null, 'access_token'), undefined);
});

test('extractToken reads numeric fields as values not indexes when object', () => {
  const body = { '0': 'zero', data: { '7': 'seven' } };
  assert.equal(extractToken(body, '0'), 'zero');
  assert.equal(extractToken(body, 'data.7'), 'seven');
});

test('resolveAuthHeader formats Bearer tokens', () => {
  const provider = { authType: 'BEARER_TOKEN', tokenPath: 'access_token', headerKey: 'Authorization', headerPrefix: 'Bearer' };
  const resolved = resolveAuthHeader(provider, { access_token: 'abc.def' });
  assert.deepEqual(resolved, { headerKey: 'Authorization', headerValue: 'Bearer abc.def' });
});

test('resolveAuthHeader supports OAuth2 shape and custom keys', () => {
  const provider = { authType: 'OAUTH2', tokenPath: 'data.access_token', headerKey: 'X-Api-Key', headerPrefix: '' };
  const resolved = resolveAuthHeader(provider, { data: { access_token: 'raw-token' } });
  assert.deepEqual(resolved, { headerKey: 'X-Api-Key', headerValue: 'raw-token' });
});

test('resolveAuthHeader throws when the token is missing', () => {
  const provider = { authType: 'BEARER_TOKEN', tokenPath: 'access_token', headerKey: 'Authorization', headerPrefix: 'Bearer' };
  assert.throws(() => resolveAuthHeader(provider, { code: 'error' }), /could not find token/);
});

test('resolveAuthHeader returns null for NONE', () => {
  assert.equal(resolveAuthHeader({ authType: 'NONE' }, { access_token: 'x' }), null);
});

test('applyAuthHeader replaces an existing header with the same key', () => {
  const headers = [
    { key: 'Content-Type', value: 'application/json', enabled: true },
    { key: 'Authorization', value: 'Bearer old', enabled: true },
  ];
  const out = applyAuthHeader(headers, { headerKey: 'Authorization', headerValue: 'Bearer new' });
  assert.equal(out.length, 2);
  assert.equal(out.find((h) => h.key === 'Authorization').value, 'Bearer new');
  assert.equal(out.filter((h) => h.key.toLowerCase() === 'authorization').length, 1);
});
