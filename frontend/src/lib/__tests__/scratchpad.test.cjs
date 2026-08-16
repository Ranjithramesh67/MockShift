'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scratchpadRequest } = require('../scratchpad.js');

test('maps a parsed GET curl into the ephemeral run shape', () => {
  const input = scratchpadRequest(
    { method: 'GET', url: 'https://api.example.com/posts?page=2', headers: [], queryParams: [], bodyType: 'NONE', bodyJson: null, bodyText: null },
    { collectionId: 'col-1' }
  );
  assert.deepEqual(input, {
    method: 'GET',
    url: 'https://api.example.com/posts?page=2',
    headers: [],
    queryParams: [],
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    apiType: 'REST',
    collectionId: 'col-1',
    persistHistory: false,
  });
});

test('keeps bodyJson for a JSON body and falls back to bodyText', () => {
  const json = scratchpadRequest(
    { method: 'POST', url: 'https://api.example.com/orders', headers: [], queryParams: [], bodyType: 'JSON', bodyJson: { sku: 'A1' }, bodyText: null },
    {}
  );
  assert.equal(json.bodyType, 'JSON');
  assert.deepEqual(json.bodyJson, { sku: 'A1' });

  const raw = scratchpadRequest(
    { method: 'POST', url: 'https://api.example.com/raw', headers: [], queryParams: [], bodyType: 'RAW_TEXT', bodyJson: null, bodyText: 'hello' },
    {}
  );
  assert.equal(raw.bodyType, 'RAW_TEXT');
  assert.equal(raw.bodyJson, 'hello');
  assert.equal(raw.bodyText, 'hello');
});

test('never persists history and defaults collection/type', () => {
  const input = scratchpadRequest(
    { method: '', url: '', headers: undefined, queryParams: undefined, bodyType: undefined, bodyJson: null, bodyText: null },
    {}
  );
  assert.equal(input.persistHistory, false);
  assert.equal(input.collectionId, null);
  assert.equal(input.method, 'GET');
  assert.equal(input.bodyType, 'NONE');
  assert.deepEqual(input.headers, []);
  assert.deepEqual(input.queryParams, []);
  assert.equal(input.apiType, 'REST');
});
