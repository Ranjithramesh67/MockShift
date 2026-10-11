'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { command: argv[0] || null, config: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') out.config = argv[++i] || null;
  }
  return out;
}

function loadTarget(resolved, req) {
  // A JS module that exports a hub (`.cjs`) or a `mockshift.json` config file.
  if (/\.json$/i.test(resolved)) {
    return { config: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
  }
  try {
    const loaded = req(resolved);
    if (loaded && typeof loaded.sync === 'function') return { hub: loaded };
    return { config: loaded };
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') {
      return { config: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
    }
    throw err;
  }
}

async function runCli(argv = [], deps = {}) {
  const req = deps.require || require;
  const log = deps.log || ((msg) => process.stdout.write(`${msg}\n`));
  const { command, config } = parseArgs(argv);

  if (command !== 'sync' || !config) {
    log('Usage: mockshift-sdk sync --config <mockshift.json | config.cjs>');
    return command ? 2 : 1;
  }

  let hub;
  try {
    const resolved = path.resolve(config);
    const target = loadTarget(resolved, req);
    if (target.hub) {
      hub = target.hub;
    } else {
      const { createHub } = req('..');
      hub = createHub({ config: target.config, configFile: resolved, file: false });
    }
  } catch (err) {
    log(`Failed to load config: ${err.message}`);
    return 1;
  }

  if (!hub || typeof hub.sync !== 'function') {
    log('Config must be a mockshift.json or export a Mockshift hub with a sync() method');
    return 1;
  }
  try {
    const result = await hub.sync();
    const summary = (result && result.summary) || {};
    log(
      `Synced: requests created: ${summary.requests ? summary.requests.created : 0}, ` +
      `updated: ${summary.requests ? summary.requests.updated : 0}, ` +
      `folders created: ${summary.folders ? summary.folders.created : 0}`
    );
    return 0;
  } catch (err) {
    log(`Sync failed: ${err.message}`);
    return 1;
  }
}

module.exports = { runCli, parseArgs, loadTarget };
