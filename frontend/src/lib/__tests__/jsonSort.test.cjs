'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  alphanumCompare,
  normalizeSortOptions,
  sortValue,
  formatSorted,
} = require('../jsonSort');

test('alphanumeric compare orders item2 before item10', () => {
  assert.ok(alphanumCompare('item2', 'item10') < 0);
  assert.ok(alphanumCompare('item10', 'item2') > 0);
  assert.equal(alphanumCompare('a', 'a'), 0);
});

test('sorts object keys alphabetically and descending', () => {
  const value = { zeta: 1, alpha: 2, middle: 3 };
  assert.deepEqual(Object.keys(sortValue(value, { keyMode: 'alpha' })), ['alpha', 'middle', 'zeta']);
  assert.deepEqual(Object.keys(sortValue(value, { keyMode: 'alpha', keyDirection: 'desc' })), [
    'zeta',
    'middle',
    'alpha',
  ]);
});

test('alphanum key sort beats lexicographic digit order', () => {
  const value = { k10: 1, k2: 2, k1: 3 };
  assert.deepEqual(Object.keys(sortValue(value, { keyMode: 'alphanum' })), ['k1', 'k2', 'k10']);
  assert.deepEqual(Object.keys(sortValue(value, { keyMode: 'alpha' })), ['k1', 'k10', 'k2']);
});

test('original key mode keeps insertion order', () => {
  const value = { zeta: 1, alpha: 2 };
  assert.deepEqual(Object.keys(sortValue(value, { keyMode: 'original' })), ['zeta', 'alpha']);
});

test('array numeric and length sorts', () => {
  assert.deepEqual(sortValue(['10', '2', '3'], { arrayMode: 'numeric' }), ['2', '3', '10']);
  assert.deepEqual(sortValue(['aaa', 'b', 'cc'], { arrayMode: 'length' }), ['b', 'cc', 'aaa']);
  assert.deepEqual(sortValue(['b', 'a'], { arrayMode: 'alpha', arrayDirection: 'desc' }), ['b', 'a']);
});

test('nested objects and arrays are sorted', () => {
  const sorted = sortValue(
    { b: [{ z: 1, a: 2 }, { a: 0 }], a: { d: 1, c: 2 } },
    { keyMode: 'alpha', arrayMode: 'json' }
  );
  assert.deepEqual(Object.keys(sorted), ['a', 'b']);
  assert.deepEqual(Object.keys(sorted.a), ['c', 'd']);
  assert.deepEqual(sorted.b, [{ a: 0 }, { a: 2, z: 1 }]);
});

test('normalizeSortOptions falls back to defaults', () => {
  assert.deepEqual(normalizeSortOptions({ keyMode: 'nope', arrayMode: 'x' }), {
    keyMode: 'alpha',
    keyDirection: 'asc',
    arrayMode: 'none',
    arrayDirection: 'asc',
  });
});

test('formatSorted pretty-prints', () => {
  const text = formatSorted({ b: 1, a: 2 }, { keyMode: 'alpha' });
  assert.equal(text, '{\n  "a": 2,\n  "b": 1\n}');
});
