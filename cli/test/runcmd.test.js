'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { runFailed } = require('../lib/commands/run');
const { normalizeRun } = require('../lib/runmeta');
const { parseKeyValuePairs } = require('../lib/session');
const { UsageError } = require('../lib/errors');

function makeRun(status, testResults) {
  return normalizeRun({ run: { id: 'r', name: 'x', status, testResults, requestSnapshot: {} } });
}

test('runFailed is false for a successful run', () => {
  assert.strictEqual(runFailed(makeRun('SUCCESS', [])), false);
  assert.strictEqual(
    runFailed(makeRun('SUCCESS', [{ passed: true, message: 'a' }])),
    false
  );
});

test('runFailed is true when the HTTP run failed', () => {
  assert.strictEqual(runFailed(makeRun('FAILED', [])), true);
  assert.strictEqual(
    runFailed(makeRun('FAILED', [{ passed: true, message: 'a' }])),
    true
  );
});

test('runFailed is true when an assertion fails on a 2xx run', () => {
  assert.strictEqual(
    runFailed(
      makeRun('SUCCESS', [
        { passed: true, message: 'a' },
        { passed: false, message: 'b' },
      ])
    ),
    true
  );
});

test('parseKeyValuePairs builds an object', () => {
  assert.deepStrictEqual(parseKeyValuePairs(['a=1', 'b=hello world'], '--collection-vars'), {
    a: '1',
    b: 'hello world',
  });
});

test('parseKeyValuePairs rejects malformed input', () => {
  assert.throws(() => parseKeyValuePairs(['noequals'], '--collection-vars'), UsageError);
  assert.throws(() => parseKeyValuePairs(['=x'], '--collection-vars'), UsageError);
});
