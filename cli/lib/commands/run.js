'use strict';

const { UsageError } = require('../errors');
const { firstOption, hasFlag } = require('../parser');
const { buildSession, makeApiClient, parseKeyValuePairs } = require('../session');
const { normalizeRun, okStatus } = require('../runmeta');
const { makePainter, elide, friendlyBytes } = require('../format');

const HELP = `Usage: apihub run <requestId> [options]

Trigger a server-side run of a stored request via POST /api/runs and print
the outcome. Requires an API token with the "runs" or "write" scope.

Options:
  --collection-vars key=value   override collection/environment variables (repeatable)
  --environment <id>            run against a specific environment
  --workspace <id>              workspace context (resolved automatically by the server today)
  --json                        print the raw run JSON from the server
  --base-url <url>  --token <t>  alternative credentials

Exit codes: 0 = run passed (2xx and every assertion passed), 1 = run failed.

Alias: apihub ci run <requestId> [same options] — same behaviour, forced
plain output so CI logs are clean.`;

function runFailed(run) {
  if (!okStatus(run.status)) return true;
  if (run.hadChecks) return run.testCases.some((t) => !t.passed);
  return false;
}

function printRunSummary(run, ctx, io) {
  const painter = makePainter(ctx.useColor);
  const statusText = okStatus(run.status) ? 'PASSED' : 'FAILED';
  const paintedStatus = okStatus(run.status) ? painter.green(statusText) : painter.red(statusText);

  const http = run.statusCode !== null && run.statusCode !== undefined ? ` · HTTP ${run.statusCode}` : '';
  io.out(`${paintedStatus} ${painter.dim(run.id || '')}${http}`);

  const snapshot = run.request || {};
  if (snapshot.url) {
    io.out(`  ${(snapshot.method || 'GET').padEnd(6)} ${elide(snapshot.url, 100)}`);
  } else if (run.name) {
    io.out(`  ${run.name}`);
  }

  const bits = [];
  if (run.durationMs !== null && run.durationMs !== undefined) bits.push(`${run.durationMs} ms`);
  if (run.startedAt) bits.push(`started ${run.startedAt}`);
  if (run.response) {
    const encoding = run.response.bodyEncoding === 'base64' ? ' (base64)' : '';
    bits.push(`response ${friendlyBytes(run.responseBytes || 0)}${encoding}`);
  }
  if (bits.length) io.out(`  ${bits.join(' · ')}`);

  const results = run.testCases || [];
  if (run.hadChecks && results.length > 0) {
    const passedCount = results.filter((t) => t.passed).length;
    io.out(`  assertions ${passedCount}/${results.length} passed`);
    for (const t of results) {
      const mark = t.passed ? painter.green('ok  ') : painter.red('FAIL');
      io.out(`    ${mark} ${t.name}`);
    }
  } else if (run.error) {
    io.out(painter.red(`  error: ${run.error}`));
  }
}

async function runRequest(ctx, io) {
  const requestId = ctx.args[0];
  if (!requestId) throw new UsageError('Usage: apihub run <requestId> [options]');

  const session = buildSession(ctx);
  const client = makeApiClient(session);

  const variables = parseKeyValuePairs(
    allValuesOf(ctx.options, 'collection-vars'),
    '--collection-vars'
  );
  const environmentId = firstOption(ctx.options, 'environment');
  const workspaceId = firstOption(ctx.options, 'workspace');

  const body = { requestId };
  if (Object.keys(variables).length > 0) body.variables = variables;
  if (environmentId) body.environmentId = environmentId;
  if (workspaceId) body.workspaceId = workspaceId;

  const res = await client.post('/api/runs', { body });
  const payload = res.body || {};

  if (hasFlag(ctx.options, 'json')) {
    io.out(JSON.stringify(payload, null, 2));
  } else {
    const run = normalizeRun(payload);
    if (run) printRunSummary(run, ctx, io);
    else io.out(JSON.stringify(payload, null, 2));
  }

  const run = normalizeRun(payload);
  return run ? (runFailed(run) ? 1 : 0) : 0;
}

function allValuesOf(options, name) {
  const value = options[name];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

async function ciRunCommand(ctx, io) {
  ctx.useColor = Boolean(firstOption(ctx.options, 'color'));
  const code = await runRequest(ctx, io);
  return code;
}

module.exports = { runRequest, ciRunCommand, runFailed, HELP };
