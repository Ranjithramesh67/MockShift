'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupeRecipients, notifyUser } = require('../notify');

test('dedupeRecipients removes the actor, falsy values and duplicates', () => {
  assert.deepEqual(dedupeRecipients(['a', 'b', 'a', null, 'a', undefined], 'a'), ['b']);
});

test('dedupeRecipients keeps order of first appearance', () => {
  assert.deepEqual(dedupeRecipients(['c', 'b', 'c'], null), ['c', 'b']);
});

test('notifyUser does not throw and resolves when called without options', async () => {
  const result = notifyUser();
  assert.ok(result instanceof Promise);
  await assert.doesNotReject(result);
});

test('notifyUser does not throw and resolves when called with null', async () => {
  const result = notifyUser(null);
  assert.ok(result instanceof Promise);
  await assert.doesNotReject(result);
});
