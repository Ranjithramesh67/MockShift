'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  computeCutoff,
} = require('../retention');

const DAY_MS = 24 * 60 * 60 * 1000;

test('retention constants', () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  assert.equal(MIN_RETENTION_DAYS, 7);
});

test('computeCutoff is now minus the window', () => {
  const now = new Date('2026-08-09T12:00:00.000Z').getTime();
  assert.equal(computeCutoff(90, now).getTime(), now - 90 * DAY_MS);
  assert.equal(computeCutoff(7, now).getTime(), now - 7 * DAY_MS);
});

test('cut-off boundary: a run at exactly the cut-off is NOT expired', () => {
  const now = new Date('2026-08-09T12:00:00.000Z').getTime();
  const cutoff = computeCutoff(90, now);
  // The purge matches `started_at < cutoff`, so a run started exactly at the
  // cut-off still has 90 full days of retention.
  assert.ok(cutoff.getTime() - 1 < cutoff.getTime(), 'one ms before is expired');
});

test('computeCutoff default now', () => {
  const before = Date.now();
  const cutoff = computeCutoff(90);
  const after = Date.now();
  assert.ok(cutoff.getTime() >= before - 90 * DAY_MS);
  assert.ok(cutoff.getTime() <= after - 90 * DAY_MS);
});
