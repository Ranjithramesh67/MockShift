'use strict';

const fs = require('fs');
const path = require('path');

const { UsageError } = require('../errors');
const { firstOption } = require('../parser');
const { buildSession, makeApiClient } = require('../session');
const { normalizeRun, fetchRunById } = require('../runmeta');
const { buildJunitXml } = require('../report/junit');
const { buildMarkdown } = require('../report/markdown');

const FORMATS = new Set(['junit', 'markdown']);

const HELP = `Usage: apihub report <format> <runId | --from <json-file>> [-o <out-file>]

Convert a server run into a report. The run can be fetched live by id
(GET /api/history/<runId>) or read from a JSON file produced by
"apihub run --json" (or a raw server response).

Formats:
  junit     JUnit XML (testcase per assertion/request step)
  markdown  human-readable summary (.md)

Options:
  --from <file>   read the run payload from a JSON file instead of a runId
  -o, --out <file> write to a file (default: print to stdout)
`;

async function readRunFromFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`Could not read ${file}: ${err.message}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`File ${file} is not valid JSON: ${err.message}`);
  }
  const run = normalizeRun(payload);
  if (!run) throw new UsageError(`File ${file} does not look like a run payload.`);
  return run;
}

async function reportCommand(ctx, io) {
  const format = ctx.args[0];
  if (!format) throw new UsageError('Usage: apihub report <junit|markdown> <runId> [--from <file>] [-o <out>]');
  if (!FORMATS.has(format)) {
    throw new UsageError(`Unknown report format "${format}" — expected junit or markdown.`);
  }

  const fromFile = firstOption(ctx.options, 'from');
  let run;
  if (fromFile) {
    run = await readRunFromFile(fromFile);
  } else {
    const runId = ctx.args[1];
    if (!runId) {
      throw new UsageError(
        'Provide a runId or pass --from <file> with a run JSON payload (from "apihub run --json").'
      );
    }
    const session = buildSession(ctx);
    const client = makeApiClient(session);
    run = await fetchRunById(client, runId);
  }
  if (!run) throw new UsageError('Could not build a report from this run.');

  const content = format === 'junit' ? buildJunitXml(run) : buildMarkdown(run);
  const outFile = firstOption(ctx.options, 'out') || firstOption(ctx.options, 'o');

  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, content);
    io.out(`Report written to ${outFile}`);
  } else {
    io.out(content);
  }
  return 0;
}

module.exports = { reportCommand, HELP, FORMATS };
