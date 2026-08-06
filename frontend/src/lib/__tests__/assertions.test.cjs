'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertionCounts, allAssertionsPassed } = require('../assertions');

const ok = { id: 'a', passed: true, message: 'x' };
const bad = { id: 'b', passed: false, message: 'y' };

test('assertionCounts counts passed and failed', () => {
  assert.deepEqual(assertionCounts([ok, bad, ok]), { total: 3, passed: 2, failed: 1 });
});

test('assertionCounts handles empty and null results', () => {
  assert.deepEqual(assertionCounts([]), { total: 0, passed: 0, failed: 0 });
  assert.deepEqual(assertionCounts(null), { total: 0, passed: 0, failed: 0 });
  assert.deepEqual(assertionCounts(undefined), { total: 0, passed: 0, failed: 0 });
});

test('allAssertionsPassed requires at least one assertion and all passing', () => {
  assert.equal(allAssertionsPassed([ok, ok]), true);
  assert.equal(allAssertionsPassed([ok, bad]), false);
  assert.equal(allAssertionsPassed([]), false);
  assert.equal(allAssertionsPassed(null), false);
});
