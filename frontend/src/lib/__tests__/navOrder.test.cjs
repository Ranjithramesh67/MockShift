'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RAIL_ORDER_KEYS,
  normalizeRailOrder,
  orderIndexMap,
} = require('../menuKeys.js');

test('normalizeRailOrder returns the default order for null/garbage input', () => {
  assert.deepEqual(normalizeRailOrder(null), RAIL_ORDER_KEYS);
  assert.deepEqual(normalizeRailOrder('nope'), RAIL_ORDER_KEYS);
  assert.deepEqual(normalizeRailOrder(undefined), RAIL_ORDER_KEYS);
});

test('normalizeRailOrder keeps a valid saved order and drops unknown/duplicate keys', () => {
  const saved = ['docs', 'apis', 'docs', 'bogus', 'admin', 'workflow'];
  const out = normalizeRailOrder(saved);
  assert.deepEqual(out.slice(0, 4), ['docs', 'apis', 'admin', 'workflow']);
  // Every known key appears exactly once, nothing is lost.
  assert.equal(out.length, RAIL_ORDER_KEYS.length);
  assert.deepEqual([...out].sort(), [...RAIL_ORDER_KEYS].sort());
});

test('normalizeRailOrder restricts to availableKeys and appends missing ones', () => {
  const available = ['apis', 'docs', 'teams'];
  const out = normalizeRailOrder(['teams', 'apis'], available);
  assert.deepEqual(out, ['teams', 'apis', 'docs']);
});

test('orderIndexMap assigns a position to every key', () => {
  const map = orderIndexMap(['docs', 'apis', 'admin']);
  assert.equal(map.docs, 0);
  assert.equal(map.apis, 1);
  assert.equal(map.admin, 2);
  assert.equal(map.workflow, undefined);
});
