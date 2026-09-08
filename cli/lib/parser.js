'use strict';

const { UsageError } = require('./errors');

const GLOBAL_FLAGS = new Set(['json', 'help', 'version', 'color', 'no-color']);

const KNOWN_OPTIONS = new Map(
  Object.entries({
    'base-url': 'value',
    token: 'value',
    workspace: 'value',
    project: 'value',
    collection: 'value',
    environment: 'value',
    description: 'value',
    'collection-vars': 'value',
    json: 'bool',
    help: 'bool',
    version: 'bool',
    color: 'bool',
    'no-color': 'bool',
    from: 'value',
    o: 'value',
    out: 'value',
    url: 'value',
    name: 'value',
  })
);

function describeOption(name) {
  if (name === 'h') return 'bool';
  if (name === 'v') return 'bool';
  return KNOWN_OPTIONS.get(name);
}

function normalizeOptionName(name) {
  if (name === 'h') return 'help';
  if (name === 'v') return 'version';
  return name;
}

function parseArgs(argv, { options = null } = {}) {
  const positionals = [];
  const opts = {};
  let endOfOptions = false;

  const allowed = options
    ? new Set([...options, ...Array.from(GLOBAL_FLAGS)])
    : null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (endOfOptions) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    let name;
    let inlineValue;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--')) {
      name = arg.slice(2, eq === -1 ? undefined : eq);
      inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    } else {
      name = arg.slice(1);
      if (eq !== -1) {
        name = name.slice(1, eq);
        inlineValue = arg.slice(eq + 1);
      }
    }

    if (!name) throw new UsageError(`Unknown option "${arg}"`);
    const canonical = normalizeOptionName(name);
    if (allowed && !allowed.has(canonical)) {
      throw new UsageError(
        `Unknown option "--${canonical}" for this command (see "apihub <command> --help")`
      );
    }

    let type = describeOption(canonical);
    if (!type) {
      throw new UsageError(
        `Unknown option "${arg.startsWith('-') ? arg : '--' + canonical}" (see "apihub --help")`
      );
    }
    if (type !== 'bool' && inlineValue === undefined) {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new UsageError(`Option "--${canonical}" requires a value`);
      }
      inlineValue = next;
      i += 1;
    }
    if (type === 'bool') {
      if (inlineValue !== undefined) {
        if (!['true', 'false', '1', '0'].includes(String(inlineValue))) {
          throw new UsageError(`Option "--${canonical}" does not take a value`);
        }
        pushOpt(opts, canonical, inlineValue === 'true' || inlineValue === '1');
      } else {
        pushOpt(opts, canonical, true);
      }
      continue;
    }

    pushOpt(opts, canonical, inlineValue);
  }

  return { positionals, options: opts };
}

function pushOpt(opts, name, value) {
  if (name in opts) {
    if (Array.isArray(opts[name])) opts[name].push(value);
    else opts[name] = [opts[name], value];
  } else {
    opts[name] = value;
  }
}

function firstOption(options, name) {
  const value = options[name];
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

function allValues(options, name) {
  const value = options[name];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function hasFlag(options, name) {
  const value = options[name];
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
}

module.exports = { parseArgs, firstOption, allValues, hasFlag, KNOWN_OPTIONS };
