'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCli, loadTarget } = require('../src/cli');

test('sync loads a config module that exports a hub', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshift-cli-'));
  const file = path.join(dir, 'mockshift.config.cjs');
  const calls = [];
  let output = '';
  const deps = {
    require: () => ({ sync: async () => { calls.push('sync'); return { summary: { requests: { created: 2 } } }; } }),
    log: (msg) => { output += `${msg}\n`; },
  };
  const code = await runCli(['sync', '--config', file], deps);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.match(output, /created: 2/);
});

test('sync without --config exits 2', async () => {
  let output = '';
  const code = await runCli(['sync'], { require: () => ({}), log: (m) => { output += m; } });
  assert.equal(code, 2);
  assert.match(output, /--config/);
});

test('loadTarget parses a JSON config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshift-cli-'));
  const file = path.join(dir, 'mockshift.json');
  fs.writeFileSync(file, JSON.stringify({ token: 't', project: 'P' }));
  const target = loadTarget(file, () => { throw new Error('should not require json'); });
  assert.equal(target.config.token, 't');
  assert.equal(target.hub, undefined);
});

test('sync builds a hub from a mockshift.json file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshift-cli-'));
  const file = path.join(dir, 'mockshift.json');
  fs.writeFileSync(file, JSON.stringify({ token: 't', baseUrl: 'http://localhost:1', autoSync: false }));
  let output = '';
  const code = await runCli(['sync', '--config', file], { log: (m) => { output += `${m}\n`; } });
  // Network is unreachable, so the sync fails — but only after building the hub,
  // proving the JSON path was parsed rather than rejected as a bad config.
  assert.equal(code, 1);
  assert.match(output, /Sync failed/);
});
