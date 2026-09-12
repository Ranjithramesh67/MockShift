'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateUserConfig, describeResolved, readConfig } = require('../llm');

test('validateUserConfig accepts a well-formed config and trims it', () => {
  const res = validateUserConfig({
    apiKey: '  sk-abc  ',
    baseUrl: ' https://api.example.com/v1 ',
    model: ' gpt-4o-mini ',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, {
    apiKey: 'sk-abc',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
});

test('validateUserConfig rejects bad base URLs, missing keys and long models', () => {
  assert.equal(validateUserConfig({ apiKey: 'k', baseUrl: 'ftp://x', model: 'm' }).ok, false);
  assert.equal(validateUserConfig({ apiKey: '', baseUrl: 'https://x', model: 'm' }).ok, false);
  assert.equal(
    validateUserConfig({ apiKey: 'k', baseUrl: 'https://x', model: 'm'.repeat(121) }).ok,
    false
  );
});

test('describeResolved never exposes the key and reports the source', () => {
  const desc = describeResolved({
    apiKey: 'sk-secret',
    baseUrl: 'https://x',
    model: 'm',
    configured: true,
    source: 'user',
  });
  assert.deepEqual(desc, { configured: true, model: 'm', provider: 'openai-compatible', source: 'user' });
  assert.equal('apiKey' in desc, false);
  assert.deepEqual(describeResolved(null), {
    configured: false,
    model: null,
    provider: null,
    source: 'none',
  });
});

test('readConfig stays environment-scoped', () => {
  const cfg = readConfig({
    USER_LLM_API_KEY: 'k',
    USER_LLM_BASE_URL: 'https://x',
    USER_LLM_MODEL: 'm',
    OPENAI_API_KEY: 'must-not-be-used',
  });
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.configured, true);
});
