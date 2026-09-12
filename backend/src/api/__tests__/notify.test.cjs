'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupeRecipients } = require('../notify');

test('dedupeRecipients removes the actor, falsy values and duplicates', () => {
  assert.deepEqual(dedupeRecipients(['a', 'b', 'a', null, 'a', undefined], 'a'), ['b']);
});

test('dedupeRecipients keeps order of first appearance', () => {
  assert.deepEqual(dedupeRecipients(['c', 'b', 'c'], null), ['c', 'b']);
});
