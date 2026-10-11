'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isLlmConfigComplete, maskKey } = require('../llmConfig');

test('isLlmConfigComplete requires a key, an http(s) base URL and a model', () => {
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }), true);
  assert.equal(isLlmConfigComplete({ apiKey: '', baseUrl: 'https://x/v1', model: 'm' }), false);
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'ftp://x', model: 'm' }), false);
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'https://x/v1', model: '' }), false);
  assert.equal(isLlmConfigComplete(null), false);
});

test('maskKey keeps only the last four characters', () => {
  assert.equal(maskKey('sk-abcdef'), '•••••cdef');
  assert.equal(maskKey('abcd'), '••••');
  assert.equal(maskKey(''), '');
});
