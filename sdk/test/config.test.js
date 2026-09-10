'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../src/config');

test('reads credentials and base url from env', () => {
  const cfg = createConfig({}, { APIHUB_API_KEY: 'k1', APIHUB_BASE_URL: 'http://api.example/' });
  assert.equal(cfg.apiKey, 'k1');
  assert.equal(cfg.baseUrl, 'http://api.example');
});

test('options win over env', () => {
  const cfg = createConfig({ apiKey: 'opt', baseUrl: 'http://opt' }, { APIHUB_API_KEY: 'env' });
  assert.equal(cfg.apiKey, 'opt');
  assert.equal(cfg.baseUrl, 'http://opt');
});

test('defaults are sane', () => {
  const cfg = createConfig({ apiKey: 'k' }, {});
  assert.equal(cfg.baseUrl, 'http://localhost:3001');
  assert.equal(cfg.source, 'express');
  assert.equal(cfg.autoSync, true);
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.prune, false);
  assert.deepEqual(cfg.include, []);
  assert.deepEqual(cfg.exclude, []);
});

test('throws a config error when no key is provided', () => {
  assert.throws(() => createConfig({}, {}), /API key is required/);
});
