'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openTab, closeTab, insertTab } = require('../tabs.js');

test('openTab dedupes and keeps insertion order', () => {
  assert.deepEqual(openTab([], 'a'), ['a']);
  assert.deepEqual(openTab(['a'], 'a'), ['a']);
  assert.deepEqual(openTab(['a', 'c'], 'b'), ['a', 'c', 'b']);
  assert.deepEqual(openTab(['a', 'b', 'c'], 'a'), ['a', 'b', 'c']);
});

test('closeTab removes an inactive tab and keeps the active id', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(closeTab(ids, 'b', 'a'), { ids: ['b', 'c'], nextActiveId: 'b' });
  assert.deepEqual(closeTab(ids, 'a', 'c'), { ids: ['a', 'b'], nextActiveId: 'a' });
});

test('closeTab activates the right neighbour when the active tab is closed', () => {
  assert.deepEqual(closeTab(['a', 'b', 'c'], 'a', 'a'), { ids: ['b', 'c'], nextActiveId: 'b' });
  assert.deepEqual(closeTab(['a', 'b', 'c'], 'b', 'b'), { ids: ['a', 'c'], nextActiveId: 'c' });
});

test('closeTab activates the left neighbour when the last tab is closed', () => {
  assert.deepEqual(closeTab(['a', 'b', 'c'], 'c', 'c'), { ids: ['a', 'b'], nextActiveId: 'b' });
});

test('closeTab clears everything when the only tab is closed', () => {
  assert.deepEqual(closeTab(['a'], 'a', 'a'), { ids: [], nextActiveId: null });
});

test('closeTab ignores an unknown id', () => {
  assert.deepEqual(closeTab(['a', 'b'], 'b', 'zzz'), { ids: ['a', 'b'], nextActiveId: 'b' });
});

test('insertTab re-inserts a closed tab at its original position', () => {
  assert.deepEqual(insertTab(['b', 'c'], 'a', 0), ['a', 'b', 'c']);
  assert.deepEqual(insertTab(['a', 'c'], 'b', 1), ['a', 'b', 'c']);
  assert.deepEqual(insertTab(['a', 'b'], 'c', 2), ['a', 'b', 'c']);
});

test('insertTab dedupes and clamps out-of-range indices', () => {
  assert.deepEqual(insertTab(['a', 'b'], 'a', 5), ['a', 'b']);
  assert.deepEqual(insertTab(['a', 'b'], 'c', 99), ['a', 'b', 'c']);
  assert.deepEqual(insertTab(['a', 'b'], 'c', -3), ['c', 'a', 'b']);
});
