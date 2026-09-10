'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCli } = require('../src/cli');

test('sync loads the config module and calls hub.sync()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apihub-cli-'));
  const file = path.join(dir, 'apihub.config.cjs');
  const calls = [];
  let output = '';
  const deps = {
    require: (p) => ({ sync: async () => { calls.push('sync'); return { summary: { requests: { created: 2 } } }; } }),
    log: (msg) => { output += `${msg}\n`; },
  };
  const code = await runCli(['sync', '--config', file], deps);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.match(output, /created: 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync without --config exits 2', async () => {
  let output = '';
  const code = await runCli(['sync'], { require: () => ({}), log: (m) => { output += m; } });
  assert.equal(code, 2);
  assert.match(output, /--config/);
});
