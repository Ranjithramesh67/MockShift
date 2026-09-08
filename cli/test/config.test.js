'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configModule = require('../lib/config');

function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apihub-config-test-'));
  const previous = process.env.APIHUB_CONFIG_DIR;
  process.env.APIHUB_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.APIHUB_CONFIG_DIR;
    else process.env.APIHUB_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('config save/load round-trips values', () => {
  withTempConfigDir(() => {
    const file = configModule.saveConfig({
      baseUrl: 'http://localhost:3001/',
      token: 'tkh_abcdef',
      defaultWorkspaceId: 'ws-1',
    });
    assert.ok(fs.existsSync(file));
    const loaded = configModule.loadConfig();
    assert.strictEqual(loaded.baseUrl, 'http://localhost:3001/');
    assert.strictEqual(loaded.token, 'tkh_abcdef');
    assert.strictEqual(loaded.defaultWorkspaceId, 'ws-1');
  });
});

test('config file is written with 0600 permissions and dir 0700', () => {
  if (process.platform === 'win32') return;
  withTempConfigDir((dir) => {
    configModule.saveConfig({ token: 'x' });
    const file = configModule.configPath();
    const mode = fs.statSync(file).mode & 0o777;
    assert.strictEqual(mode, 0o600);
    const dirMode = fs.statSync(dir).mode & 0o777;
    assert.strictEqual(dirMode, 0o700);
  });
});

test('loadConfig returns empty when no file exists', () => {
  withTempConfigDir(() => {
    const cfg = configModule.loadConfig();
    assert.deepStrictEqual(cfg, { baseUrl: undefined, token: undefined, defaultWorkspaceId: undefined });
  });
});

test('corrupt config file is moved aside and treated as empty', () => {
  withTempConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
    const cfg = configModule.loadConfig();
    assert.strictEqual(cfg.token, undefined);
    const leftovers = fs.readdirSync(dir);
    assert.ok(leftovers.some((name) => name.startsWith('config.json.invalid-')));
  });
});

test('saveConfig strips empty fields', () => {
  withTempConfigDir(() => {
    configModule.saveConfig({ baseUrl: undefined, token: '', defaultWorkspaceId: undefined });
    const raw = JSON.parse(fs.readFileSync(configModule.configPath(), 'utf8'));
    assert.deepStrictEqual(raw, {});
  });
});

test('resolveBaseUrl precedence: flag > env > config > default', () => {
  withTempConfigDir(() => {
    configModule.saveConfig({ baseUrl: 'http://from-config' });
    assert.strictEqual(configModule.resolveBaseUrl({ flag: 'http://from-flag/' }), 'http://from-flag');
    assert.strictEqual(
      configModule.resolveBaseUrl({ config: configModule.loadConfig() }),
      'http://from-config'
    );
    assert.strictEqual(configModule.resolveBaseUrl({}), configModule.DEFAULT_BASE_URL);
  });
});

test('resolveBaseUrl reads APIHUB_BASE_URL from env', () => {
  const previous = process.env.APIHUB_BASE_URL;
  process.env.APIHUB_BASE_URL = 'http://env-host:4100';
  try {
    assert.strictEqual(configModule.resolveBaseUrl({ env: 'APIHUB_BASE_URL' }), 'http://env-host:4100');
  } finally {
    if (previous === undefined) delete process.env.APIHUB_BASE_URL;
    else process.env.APIHUB_BASE_URL = previous;
  }
});

test('resolveToken precedence: flag > env > config', () => {
  withTempConfigDir(() => {
    configModule.saveConfig({ token: 'cfg-token' });
    assert.strictEqual(configModule.resolveToken({ flag: 'flag-token', config: configModule.loadConfig() }), 'flag-token');

    const previous = process.env.APIHUB_TOKEN;
    process.env.APIHUB_TOKEN = 'env-token';
    try {
      assert.strictEqual(configModule.resolveToken({ env: 'APIHUB_TOKEN', config: configModule.loadConfig() }), 'env-token');
      assert.strictEqual(configModule.resolveToken({ config: configModule.loadConfig() }), 'cfg-token');
    } finally {
      if (previous === undefined) delete process.env.APIHUB_TOKEN;
      else process.env.APIHUB_TOKEN = previous;
    }
  });
});

test('tokenPrefix returns first 12 characters', () => {
  assert.strictEqual(configModule.tokenPrefix('tkh_1234567890abcdef'), 'tkh_12345678');
  assert.strictEqual(configModule.tokenPrefix('tkh_abcd'), 'tkh_abcd');
});
