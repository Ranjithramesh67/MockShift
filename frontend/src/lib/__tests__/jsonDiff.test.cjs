'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonInput, diffJson, compareParsed, preview } = require('../jsonDiff');
const { sortValue } = require('../jsonSort');

test('parseJsonInput reports empty and invalid JSON', () => {
  assert.equal(parseJsonInput('').ok, false);
  assert.equal(parseJsonInput('{').ok, false);
  assert.deepEqual(parseJsonInput('{"a":1}').value, { a: 1 });
});

test('diff detects added removed changed and type', () => {
  const changes = diffJson(
    { keep: 1, gone: 2, n: 3, t: 'x' },
    { keep: 1, extra: 9, n: 4, t: 1 }
  );
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c.kind]));
  assert.equal(byPath['$.gone'], 'removed');
  assert.equal(byPath['$.extra'], 'added');
  assert.equal(byPath['$.n'], 'changed');
  assert.equal(byPath['$.t'], 'type');
  assert.equal(byPath['$.keep'], undefined);
});

test('sorted compare ignores key order', () => {
  const left = sortValue({ b: 1, a: { z: 2, y: 3 } }, { keyMode: 'alpha' });
  const right = sortValue({ a: { y: 3, z: 2 }, b: 1 }, { keyMode: 'alpha' });
  const result = compareParsed(left, right);
  assert.equal(result.equal, true);
  assert.equal(result.summary.total, 0);
});

test('preview truncates long values', () => {
  const text = preview({ a: 'x'.repeat(400) });
  assert.ok(text.endsWith('…'));
  assert.ok(text.length <= 241);
});
