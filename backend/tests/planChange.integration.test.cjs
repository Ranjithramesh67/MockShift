'use strict';

// Plan-change rules (migration 054).
//
// Covers the product rules for changing a plan:
//   - a customer with an active plan cannot recharge a same/lower-priced plan
//     without cancelling first (409 cancel_required);
//   - after a scheduled cancellation, a lower plan is queued (SCHEDULED) and
//     starts only when the current period ends (no refund);
//   - an upgrade activates immediately and is charged only the prorated
//     difference for the remaining paid days (bonus validity excluded);
//   - the queued plan is promoted to ACTIVE once its start date arrives.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let portalServer;
let portalBase;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;
});

after(async () => {
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (closeApp) await closeApp();
});

function scalar(sql) {
  const match = psql(sql).match(/^\s*([\d.]+)\s*$/m);
  return match ? match[1] : null;
}

// psql `-q -c` prints a header, a separator, then the value on line 3.
function textOf(sql) {
  const lines = psql(sql).split('\n');
  return lines[2] ? lines[2].trim() : null;
}

// Buy and confirm a plan for a fresh customer; returns the portal client and
// the active subscription id.
async function buyPlan(email, planKey) {
  const client = makeClient(portalBase);
  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey,
    billingCycle: 'MONTHLY',
    account: { name: 'Plan Buyer', email, password: 'planbuyer123' },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  return { client, subscriptionId: confirm.json.subscription.id };
}

test('a same/lower-priced recharge is refused until the active plan is cancelled', async () => {
  const { client } = await buyPlan('pc-block@test.io', 'pro');

  const lower = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
  });
  assert.equal(lower.status, 409, JSON.stringify(lower.json));
  assert.equal(lower.json.code, 'cancel_required');
  assert.match(lower.json.error, /cancel/i);

  // No order was created for the refused change.
  assert.equal(scalar(`SELECT count(*) FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'pc-block@test.io')`), '1');
});

test('after cancelling, a lower plan is queued and promoted when the period ends', async () => {
  const email = 'pc-queue@test.io';
  const { client, subscriptionId } = await buyPlan(email, 'pro');

  const cancelled = await client.api('POST', '/api/public/account/cancel', { subscriptionId });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.subscription.cancel_at_period_end, true);

  // The lower plan is now allowed and paid for up front.
  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  assert.equal(checkout.json.order.amount, '99.00');

  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.subscription.status, 'SCHEDULED');
  assert.equal(confirm.json.subscription.plan.key, 'starter');

  // The current plan keeps running until the period end.
  assert.equal(textOf(`SELECT status FROM subscriptions WHERE id = '${subscriptionId}'`), 'ACTIVE');

  // Force time to elapse: the current plan's paid period ends and the queued
  // plan's start arrives. Reading the overview promotes lazily.
  const scheduledId = confirm.json.subscription.id;
  psql(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = '${subscriptionId}'`);
  psql(`UPDATE subscriptions SET current_period_start = now() - interval '30 seconds' WHERE id = '${scheduledId}'`);
  const overview = await client.api('GET', '/api/public/account/overview');
  assert.equal(overview.status, 200, JSON.stringify(overview.json));
  assert.equal(overview.json.current.plan.key, 'starter');
  assert.equal(overview.json.current.status, 'ACTIVE');
  assert.equal(overview.json.scheduled, null);
  assert.equal(textOf(`SELECT status FROM subscriptions WHERE id = '${subscriptionId}'`), 'CANCELLED');
});

test('an upgrade is prorated to the remaining paid days and activates immediately', async () => {
  const email = 'pc-upgrade@test.io';
  const { client, subscriptionId } = await buyPlan(email, 'pro');

  // Make the current period deterministic: started 3 days ago (27 of 30 paid
  // days remain once the 14-day bonus is excluded). Monthly pro = 299, team =
  // 799, so the prorated charge is 500 * 27/30 = 450.
  psql(
    `UPDATE subscriptions
        SET current_period_start = now() - interval '3 days',
            current_period_end = now() - interval '3 days' + interval '1 month' + interval '14 days'
      WHERE id = '${subscriptionId}'`
  );

  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'team',
    billingCycle: 'MONTHLY',
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  assert.equal(checkout.json.order.plan_key, 'team');

  // Prorated: strictly less than the full 799 and well under the (299+799)
  // range — the exact value depends on the calendar month length.
  const amount = Number(checkout.json.order.amount);
  assert.ok(amount > 400 && amount < 500, `expected a prorated ~450, got ${amount}`);

  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.subscription.plan.key, 'team');
  assert.equal(confirm.json.subscription.status, 'ACTIVE');

  // The old plan is superseded immediately (no refund of the unused period).
  assert.equal(textOf(`SELECT status FROM subscriptions WHERE id = '${subscriptionId}'`), 'CANCELLED');
});

test('an upgrade is charged the full price (not mistaken for a downgrade) when just days remain', async () => {
  const { client, subscriptionId } = await buyPlan('pc-late@test.io', 'pro');

  // Only 2 paid days left: 500 * 2/30 ≈ 33.33 — far below the 299 pro price.
  // Direction must still be decided from the full price (team > pro).
  psql(
    `UPDATE subscriptions
        SET current_period_start = now() - interval '28 days',
            current_period_end = now() - interval '28 days' + interval '1 month' + interval '14 days'
      WHERE id = '${subscriptionId}'`
  );

  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'team',
    billingCycle: 'MONTHLY',
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  const amount = Number(checkout.json.order.amount);
  assert.ok(amount > 0 && amount < 100, `expected a small prorated amount, got ${amount}`);

  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.subscription.plan.key, 'team');
  assert.equal(confirm.json.subscription.status, 'ACTIVE');
});
