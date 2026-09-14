'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { subscriptionChip, daysUntil, normalizeStatus } = require('../subscription');

const NOW = Date.parse('2026-09-14T12:00:00Z');

function sub(overrides = {}) {
  return {
    status: 'ACTIVE',
    plan: { key: 'pro', name: 'Pro', currency: 'USD', id: 'p' },
    current_period_end: '2027-01-01T00:00:00Z',
    trial_ends_at: null,
    cancel_at_period_end: false,
    ...overrides,
  };
}

test('daysUntil rounds up and tolerates bad input', () => {
  assert.equal(daysUntil('2026-09-24T12:00:00Z', NOW), 10);
  assert.equal(daysUntil('2026-09-15T00:00:00Z', NOW), 1);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('not-a-date', NOW), null);
});

test('normalizeStatus uppercases and defaults to empty', () => {
  assert.equal(normalizeStatus('active'), 'ACTIVE');
  assert.equal(normalizeStatus(undefined), '');
});

test('no subscription renders a muted Free chip', () => {
  const chip = subscriptionChip(null, { now: NOW });
  assert.equal(chip.label, 'Free');
  assert.equal(chip.tone, 'muted');
  assert.equal(chip.urgent, false);
});

test('a healthy active plan is not urgent', () => {
  const chip = subscriptionChip(sub(), { now: NOW });
  assert.equal(chip.label, 'Pro');
  assert.equal(chip.tone, 'ok');
  assert.equal(chip.urgent, false);
});

test('an upcoming renewal inside the window is urgent', () => {
  const chip = subscriptionChip(sub({ current_period_end: '2026-09-18T12:00:00Z' }), { now: NOW });
  assert.equal(chip.urgent, true);
  assert.match(chip.title, /renews in 4 day/);
});

test('a scheduled cancellation is urgent and mentions the end', () => {
  const chip = subscriptionChip(
    sub({ cancel_at_period_end: true, current_period_end: '2026-10-01T00:00:00Z' }),
    { now: NOW }
  );
  assert.equal(chip.urgent, true);
  assert.equal(chip.label, 'Pro');
  assert.match(chip.title, /renew to keep access/);
});

test('past-due plans are urgent with a payment warning', () => {
  const chip = subscriptionChip(sub({ status: 'PAST_DUE' }), { now: NOW });
  assert.equal(chip.tone, 'warn');
  assert.equal(chip.urgent, true);
  assert.match(chip.title, /payment issue/);
});

test('a trial nearing its end is urgent', () => {
  const chip = subscriptionChip(
    sub({ status: 'TRIALING', trial_ends_at: '2026-09-16T12:00:00Z' }),
    { now: NOW }
  );
  assert.equal(chip.urgent, true);
  assert.match(chip.title, /trial ends in 2 day/);
});
