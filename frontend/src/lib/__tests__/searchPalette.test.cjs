'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupLabel, takeTop } = require('../searchPalette.js');

test('groupLabel maps types to human labels', () => {
  assert.equal(groupLabel('request'), 'Requests');
  assert.equal(groupLabel('mockScenario'), 'Mock scenarios');
  assert.equal(groupLabel('unknown'), 'Other');
});

test('takeTop limits and preserves order', () => {
  assert.deepEqual(takeTop([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(takeTop(null, 2), []);
});
