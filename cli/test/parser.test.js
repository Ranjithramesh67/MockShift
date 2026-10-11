'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseArgs, firstOption, allValues, hasFlag } = require('../lib/parser');
const { UsageError } = require('../lib/errors');

test('parses bare positionals', () => {
  const { positionals, options } = parseArgs(['login']);
  assert.deepStrictEqual(positionals, ['login']);
  assert.deepStrictEqual(options, {});
});

test('parses command words with option flags interleaved', () => {
  const { positionals, options } = parseArgs([
    'run',
    'abc-123',
    '--collection-vars',
    'baseUrl=http://x',
    '--collection-vars',
    'limit=10',
    '--json',
  ]);
  assert.deepStrictEqual(positionals, ['run', 'abc-123']);
  assert.deepStrictEqual(options['collection-vars'], ['baseUrl=http://x', 'limit=10']);
  assert.strictEqual(hasFlag(options, 'json'), true);
});

test('supports --opt=value form', () => {
  const { positionals, options } = parseArgs(['project', 'create', 'Name', '--description=hello world', '--workspace=w1']);
  assert.deepStrictEqual(positionals, ['project', 'create', 'Name']);
  assert.strictEqual(options.description, 'hello world');
  assert.strictEqual(options.workspace, 'w1');
});

test('boolean flags do not consume the next token', () => {
  const { options, positionals } = parseArgs(['--json', 'run', 'id']);
  assert.strictEqual(hasFlag(options, 'json'), true);
  assert.deepStrictEqual(positionals, ['run', 'id']);
});

test('repeated value option collects into array; firstOption returns last', () => {
  const { options } = parseArgs(['--token', 'a', '--token', 'b']);
  assert.deepStrictEqual(options.token, ['a', 'b']);
  assert.strictEqual(firstOption(options, 'token'), 'b');
  assert.deepStrictEqual(allValues(options, 'token'), ['a', 'b']);
});

test('-- stops option parsing', () => {
  const { positionals, options } = parseArgs(['run', '--', '--json']);
  assert.deepStrictEqual(positionals, ['run', '--json']);
  assert.deepStrictEqual(options, {});
});

test('unknown option is a usage error', () => {
  assert.throws(() => parseArgs(['--bogus']), UsageError);
});

test('option missing a value is a usage error', () => {
  assert.throws(() => parseArgs(['run', 'id', '--token']), UsageError);
});

test('boolean option with a non-boolean value is a usage error', () => {
  assert.throws(() => parseArgs(['--json=nope']), UsageError);
});

test('short flags -h and -v map to help and version', () => {
  const { options } = parseArgs(['-h']);
  assert.strictEqual(hasFlag(options, 'help'), true);
  assert.strictEqual(hasFlag(options, 'version'), false);
  const { options: v } = parseArgs(['-v']);
  assert.strictEqual(hasFlag(v, 'version'), true);
});

test('empty argv yields no positionals', () => {
  const { positionals, options } = parseArgs([]);
  assert.deepStrictEqual(positionals, []);
  assert.deepStrictEqual(options, {});
});
