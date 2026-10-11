'use strict';

const fs = require('fs');
const path = require('path');

const { UsageError, ApiError } = require('./errors');
const { parseArgs, firstOption, hasFlag } = require('./parser');
const { colorEnabled, makePainter } = require('./format');
const authCommands = require('./commands/auth');
const objectCommands = require('./commands/objects');
const runCommands = require('./commands/run');
const reportCommands = require('./commands/reportcmd');

const COMMON_ALLOWED = ['base-url', 'token', 'json', 'help', 'version', 'color', 'no-color'];

const COMMAND_ALLOWED = {
  login: [...COMMON_ALLOWED],
  logout: [...COMMON_ALLOWED],
  whoami: [...COMMON_ALLOWED],
  workspace: [...COMMON_ALLOWED],
  project: ['workspace', 'description', ...COMMON_ALLOWED],
  collection: ['project', 'workspace', ...COMMON_ALLOWED],
  request: ['collection', 'workspace', ...COMMON_ALLOWED],
  run: ['collection-vars', 'environment', 'workspace', ...COMMON_ALLOWED],
  ci: ['collection-vars', 'environment', 'workspace', ...COMMON_ALLOWED],
  report: ['from', 'o', 'out', ...COMMON_ALLOWED],
};

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const GLOBAL_USAGE = `mockshift — official Mockshift CLI (v${readVersion()})

Usage:
  mockshift login [--base-url <url>] [--token <token>]
  mockshift logout
  mockshift whoami
  mockshift workspace list | workspace use <id>
  mockshift project list [--workspace <id>] | project create <name> [options]
  mockshift collection list [--project <id>] [--workspace <id>]
  mockshift request list [--collection <id>] | request show <requestId>
  mockshift run <requestId> [--collection-vars k=v] [options]
  mockshift ci run <requestId> [options]
  mockshift report junit|markdown <runId> [--from <file>] [-o <out>]

Global options:
  --base-url <url>   Mockshift server URL (env: MOCKSHIFT_BASE_URL)
  --token <token>    personal API token (env: MOCKSHIFT_TOKEN)
  --json             emit raw JSON for list/show/run commands
  --no-color         disable colored output (also honours NO_COLOR)
  --help, --version

Credentials are read from flags, then environment variables, then
~/.config/mockshift/config.json (saved by "mockshift login").

Exit codes:
  0  success
  1  the run failed, or an API/operational error occurred
  2  usage or configuration error

Run "mockshift <command> --help" for details on a command.`;

const COMMAND_HELP = {
  login: { run: () => authCommands.HELP },
  logout: { run: () => 'Usage: mockshift logout\n\nRemove the stored API token from the local config.\n' },
  whoami: { run: () => 'Usage: mockshift whoami\n\nPrint the authenticated user and the token prefix for the current base URL.\n' },
  workspace: {
    list: { run: () => 'Usage: mockshift workspace list\n\nList the workspaces this token can access. "*" marks the default workspace.\n' },
    use: { run: () => 'Usage: mockshift workspace use <workspaceId>\n\nSet the default workspace used by project/collection listing commands.\n' },
  },
  project: {
    list: { run: () => 'Usage: mockshift project list [--workspace <id>]\n\nList projects in a workspace (default workspace unless --workspace is given).\n' },
    create: { run: () => 'Usage: mockshift project create <name> [--workspace <id>] [--description <text>]\n\nCreate a project. Note: the current Mockshift backend exposes no create-project\nroute (projects are created implicitly with workspaces), so this command needs\nsuch a route before it can succeed.\n' },
  },
  collection: {
    list: { run: () => 'Usage: mockshift collection list [--project <id>] [--workspace <id>]\n\nList collections in a project or in the default workspace.\n' },
  },
  request: {
    list: { run: () => 'Usage: mockshift request list [--collection <id>] [--workspace <id>]\n\nList requests in a collection (or all requests in the default workspace).\n' },
    show: { run: () => 'Usage: mockshift request show <requestId>\n\nShow the stored definition of a single request.\n' },
  },
  run: { run: () => runCommands.HELP },
  ci: { run: () => runCommands.HELP },
  report: { run: () => reportCommands.HELP },
};

function buildIo(useColor) {
  const paint = makePainter(useColor);
  const out = (text) => process.stdout.write(`${text}\n`);
  const err = (text) => process.stderr.write(`${text}\n`);
  return { out, err, paint };
}

function findSubHelp(helpMap, words) {
  let node = helpMap;
  for (const word of words) {
    if (node && typeof node === 'object' && word in node) node = node[word];
    else return null;
  }
  if (node && typeof node.run === 'function') return node.run();
  return null;
}

function resolveCommand(positionals) {
  const command = positionals[0];
  if (!command) return null;

  const groups = ['workspace', 'project', 'collection', 'request'];
  if (command === 'ci') {
    const sub = positionals[1];
    if (sub === 'run') return { command, handler: 'run', words: ['ci', 'run'], args: positionals.slice(2) };
    throw new UsageError('Usage: mockshift ci run <requestId> [options] (ci accepts only the "run" subcommand)');
  }
  if (command === 'report') {
    const format = positionals[1];
    return { command, handler: format || null, words: ['report'], args: positionals.slice(1) };
  }
  if (groups.includes(command)) {
    const sub = positionals[1];
    if (!sub) {
      throw new UsageError(
        `Usage: mockshift ${command} list | ${command} ${command === 'workspace' ? 'use <id>' : command === 'project' ? 'create <name>' : command === 'request' ? 'show <requestId>' : '...'}\nSee "mockshift ${command} --help".`
      );
    }
    return { command, handler: sub, words: [command, sub], args: positionals.slice(2) };
  }
  if (['login', 'logout', 'whoami', 'run'].includes(command)) {
    return { command, handler: null, words: [command], args: positionals.slice(1) };
  }
  throw new UsageError(`Unknown command "${command}". Run "mockshift --help".`);
}

async function runCommand(resolved, ctx, io) {
  switch (resolved.words.join(' ')) {
    case 'login':
      return authCommands.loginCommand(ctx, io);
    case 'logout':
      return authCommands.logoutCommand(ctx, io);
    case 'whoami':
      return authCommands.whoamiCommand(ctx, io);
    case 'workspace list':
      return objectCommands.workspaceList(ctx, io);
    case 'workspace use':
      return objectCommands.workspaceUse(ctx, io);
    case 'project list':
      return objectCommands.projectList(ctx, io);
    case 'project create':
      return objectCommands.projectCreate(ctx, io);
    case 'collection list':
      return objectCommands.collectionList(ctx, io);
    case 'request list':
      return objectCommands.requestList(ctx, io);
    case 'request show':
      return objectCommands.requestShow(ctx, io);
    case 'run':
      return runCommands.runRequest(ctx, io);
    case 'ci run':
      return runCommands.ciRunCommand(ctx, io);
    default:
      if (resolved.command === 'report') {
        return reportCommands.reportCommand(ctx, io);
      }
      return 2;
  }
}

async function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const parsed = parseArgs(argv);
  const { options, positionals } = parsed;

  const useColor = hasFlag(options, 'color')
    ? true
    : hasFlag(options, 'no-color')
      ? false
      : colorEnabled(stdout);

  if (hasFlag(options, 'version')) {
    stdout.write(`mockshift ${readVersion()}\n`);
    return 0;
  }

  let resolved;
  try {
    resolved = resolveCommand(positionals);
  } catch (err) {
    if (hasFlag(options, 'help')) {
      stdout.write(GLOBAL_USAGE);
      return 0;
    }
    stderr.write(`mockshift: ${err.message}\n`);
    return 2;
  }

  if (!resolved) {
    stdout.write(GLOBAL_USAGE);
    return 0;
  }

  if (hasFlag(options, 'help')) {
    const helpText = findSubHelp(COMMAND_HELP, resolved.words) || findSubHelp(COMMAND_HELP, [resolved.command]) || GLOBAL_USAGE;
    stdout.write(helpText);
    return 0;
  }

  const ctx = {
    options,
    args: resolved.args,
    useColor,
    stdout,
    stderr,
  };

  const allowedForCommand = COMMAND_ALLOWED[resolved.command];
  const disallowed = Object.keys(options).filter(
    (name) => !allowedForCommand.includes(name)
  );
  if (disallowed.length > 0) {
    stderr.write(
      `mockshift: option(s) not valid here: ${disallowed.map((d) => `--${d}`).join(', ')}\n`
    );
    return 2;
  }

  const io = buildIo(useColor);

  try {
    return await runCommand(resolved, ctx, io);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`mockshift: ${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof ApiError) {
      const code = err.status ? `HTTP ${err.status}` : 'network error';
      stderr.write(`mockshift: ${code}: ${err.message}\n`);
      if (err.status === 401) {
        stderr.write('mockshift: not authenticated — run "mockshift login" or set MOCKSHIFT_TOKEN/--token.\n');
      }
      return err.exitCode;
    }
    stderr.write(`mockshift: ${err && err.message ? err.message : err}\n`);
    return 1;
  }
}

module.exports = { main, GLOBAL_USAGE, readVersion };
