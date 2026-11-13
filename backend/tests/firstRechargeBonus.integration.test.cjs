'use strict';

// MED-7 — the first-recharge bonus was computed before the payment transaction
// (and outside any lock). Two different PENDING orders for the same customer
// finalised concurrently both saw "no prior paid order" and both granted the
// plan trial bonus. The bonus is now computed inside the transaction under a
// per-user advisory lock, so exactly one order can be the "first recharge".

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, psql } = require('./support/harness.cjs');

let closeApp;
let portalServer;
let portalBase;

before(async () => {
  const app = await startApp();
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

test('only one of two concurrent first recharges receives the trial bonus', async () => {
  const email = 'first-recharge@test.io';
  const client = makeClient(portalBase);

  const first = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'First Recharge', email, password: 'firstrecharge123' },
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.requiresPayment, true);

  // Checkout refuses a second PENDING row (PORTAL-2). Seed one so two
  // already-open orders can still race on confirm and prove the bonus lock.
  const secondId = psql(
    `WITH buyer AS (
       SELECT id FROM users WHERE lower(email) = 'first-recharge@test.io'
     ),
     pro AS (
       SELECT id FROM plans WHERE key = 'pro'
     ),
     inserted AS (
       INSERT INTO orders (user_id, plan_id, amount, subtotal, discount_amount, currency, billing_cycle, status)
       SELECT buyer.id, pro.id, 299, 299, 0, 'INR', 'MONTHLY', 'PENDING'
         FROM buyer, pro
       RETURNING id, user_id, amount, currency
     )
     INSERT INTO invoices (order_id, user_id, number, amount, currency, status)
     SELECT id, user_id, 'INV-2026-FRB2', amount, currency, 'DRAFT' FROM inserted
     RETURNING order_id`
  ).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.ok(secondId, 'second PENDING order id');

  const [one, two] = await Promise.all([
    client.api('POST', `/api/public/checkout/${first.json.order.id}/confirm`),
    client.api('POST', `/api/public/checkout/${secondId[0]}/confirm`),
  ]);
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.equal(two.status, 200, JSON.stringify(two.json));

  const awarded = [one.json.bonus.days, two.json.bonus.days].sort((a, b) => a - b);
  assert.deepEqual(awarded, [0, 14], `exactly one order may be the first recharge, got ${JSON.stringify(awarded)}`);
  assert.equal(
    [one.json.bonus.firstRecharge, two.json.bonus.firstRecharge].filter(Boolean).length,
    1
  );
});
