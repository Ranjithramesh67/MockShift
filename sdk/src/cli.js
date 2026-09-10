'use strict';

function parseArgs(argv) {
  const out = { command: argv[0] || null, config: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') out.config = argv[++i] || null;
  }
  return out;
}

async function runCli(argv = [], deps = {}) {
  const req = deps.require || require;
  const log = deps.log || ((msg) => process.stdout.write(`${msg}\n`));
  const { command, config } = parseArgs(argv);

  if (command !== 'sync') {
    log('Usage: apihub-sdk sync --config <path-to-config.cjs>');
    return command ? 2 : 1;
  }
  if (!config) {
    log('Usage: apihub-sdk sync --config <path-to-config.cjs>');
    return 2;
  }
  let hub;
  try {
    hub = req(require('path').resolve(config));
  } catch (err) {
    log(`Failed to load config: ${err.message}`);
    return 1;
  }
  if (!hub || typeof hub.sync !== 'function') {
    log('Config module must export an apihub hub with a sync() method');
    return 1;
  }
  try {
    const result = await hub.sync();
    const summary = result && result.summary ? result.summary : {};
    log(`Synced: requests created: ${summary.requests ? summary.requests.created : 0}, updated: ${summary.requests ? summary.requests.updated : 0}, folders created: ${summary.folders ? summary.folders.created : 0}`);
    return 0;
  } catch (err) {
    log(`Sync failed: ${err.message}`);
    return 1;
  }
}

module.exports = { runCli, parseArgs };
