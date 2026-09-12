'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMockHeaders, mockBasePath, mockBaseUrl, mockRequestBaseUrl } = require('../mockServer');

test('parseMockHeaders handles empty string as no headers', () => {
  assert.deepEqual(parseMockHeaders(''), {});
  assert.deepEqual(parseMockHeaders('   '), {});
  assert.deepEqual(parseMockHeaders(null), {});
  assert.deepEqual(parseMockHeaders(undefined), {});
});

test('parseMockHeaders parses a JSON object', () => {
  assert.deepEqual(parseMockHeaders('{"x-mock":"true","Authorization":"Bearer abc"}'), {
    'x-mock': 'true',
    Authorization: 'Bearer abc',
  });
});

test('parseMockHeaders rejects arrays and non-objects', () => {
  assert.throws(() => parseMockHeaders('["a","b"]'), /JSON object/);
  assert.throws(() => parseMockHeaders('"nope"'), /JSON object/);
  assert.throws(() => parseMockHeaders('42'), /JSON object/);
});

test('parseMockHeaders rejects invalid JSON', () => {
  assert.throws(() => parseMockHeaders('{broken'), /JSON/);
});

test('mockBasePath is the relative dispatch path', () => {
  assert.equal(mockBasePath('proj-123'), '/mock/proj-123');
});

test('mockBaseUrl returns the relative path without an origin', () => {
  assert.equal(mockBaseUrl('proj-123'), '/mock/proj-123');
});

test('mockBaseUrl prefixes a browser origin and trims trailing slashes', () => {
  assert.equal(mockBaseUrl('proj-123', 'https://app.example.com/'), 'https://app.example.com/mock/proj-123');
});

test('mockRequestBaseUrl targets the backend origin the runner can fetch', () => {
  assert.equal(mockRequestBaseUrl('proj-123'), 'http://127.0.0.1:3001/mock/proj-123');
});
