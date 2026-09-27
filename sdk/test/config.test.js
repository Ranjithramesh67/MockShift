'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfig } = require('../src/config');

function tmpConfig(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshift-cfg-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('reads credentials and base url from env', () => {
  const cfg = createConfig({ file: false }, { APIHUB_API_KEY: 'k1', APIHUB_BASE_URL: 'http://api.example/' });
  assert.equal(cfg.apiKey, 'k1');
  assert.equal(cfg.baseUrl, 'http://api.example');
});

test('MOCKSHIFT_* env wins over the legacy APIHUB_* names', () => {
  const cfg = createConfig({ file: false }, { MOCKSHIFT_API_KEY: 'new', APIHUB_API_KEY: 'old' });
  assert.equal(cfg.apiKey, 'new');
});

test('options win over env', () => {
  const cfg = createConfig({ apiKey: 'opt', baseUrl: 'http://opt', file: false }, { APIHUB_API_KEY: 'env' });
  assert.equal(cfg.apiKey, 'opt');
  assert.equal(cfg.baseUrl, 'http://opt');
});

test('defaults are sane', () => {
  const cfg = createConfig({ apiKey: 'k', file: false }, {});
  assert.equal(cfg.baseUrl, 'http://localhost:3001');
  assert.equal(cfg.source, 'express');
  assert.equal(cfg.autoSync, true);
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.prune, false);
  assert.deepEqual(cfg.include, []);
  assert.deepEqual(cfg.exclude, []);
  assert.equal(cfg.capture.enabled, true);
  assert.equal(cfg.assertions.status, true);
});

test('throws a config error when no key is provided', () => {
  assert.throws(() => createConfig({ file: false }, {}), /API key is required/);
});

test('loads token and options from a mockshift.json file', () => {
  const file = tmpConfig('mockshift.json', JSON.stringify({
    token: 'file-key',
    baseUrl: 'http://file.example',
    project: 'My App',
    include: ['/api'],
    assertions: { status: false },
  }));
  const cfg = createConfig({ configFile: file }, {});
  assert.equal(cfg.apiKey, 'file-key');
  assert.equal(cfg.baseUrl, 'http://file.example');
  assert.equal(cfg.project, 'My App');
  assert.deepEqual(cfg.include, ['/api']);
  assert.equal(cfg.assertions.status, false);
  assert.equal(cfg.assertions.json, true);
  assert.equal(cfg.configPath, file);
});

test('explicit options override file values', () => {
  const file = tmpConfig('mockshift.json', JSON.stringify({ token: 't', baseUrl: 'http://file' }));
  const cfg = createConfig({ configFile: file, baseUrl: 'http://opt' }, {});
  assert.equal(cfg.baseUrl, 'http://opt');
});

test('rejects an invalid config file with a config error', () => {
  const file = tmpConfig('mockshift.json', '{ not json');
  assert.throws(() => createConfig({ configFile: file }, {}), /Invalid mockshift config/);
});

test('a missing explicit config file falls back to options/env', () => {
  const cfg = createConfig({ configFile: '/nope/missing.json', apiKey: 'k', file: false }, {});
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.configPath, null);
});

