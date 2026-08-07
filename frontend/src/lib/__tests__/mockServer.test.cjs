'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMockHeaders, mockBaseUrl } = require('../mockServer');

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

test('mockBaseUrl points at the backend mock dispatch path', () => {
  assert.equal(mockBaseUrl('proj-123'), 'http://127.0.0.1:3001/mock/proj-123');
});
