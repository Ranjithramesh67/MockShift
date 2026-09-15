'use strict';

// HIGH-4 — POST /api/public/checkout/:orderId/confirm must be race-safe. Two
// concurrent confirms used to read status='PENDING' before either committed,
// then both inserted an ACTIVE subscription. The fix locks the order row
// FOR UPDATE and re-checks status inside the transaction.

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

function scalar(sql) {
  const match = psql(sql).match(/^\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : NaN;
}

test('concurrent checkout confirms settle to a single subscription', async () => {
  const email = 'confirm-race@test.io';
  const client = makeClient(portalBase);

  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Race Buyer', email, password: 'racepass123' },
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.json.requiresPayment, true);
  const orderId = checkout.json.order.id;

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      client.api('POST', `/api/public/checkout/${orderId}/confirm`)
    )
  );
  for (const res of results) {
    assert.equal(res.status, 200);
    assert.equal(res.json.order.id, orderId);
  }

  const activeSubs = scalar(
    `SELECT count(*) FROM subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE u.email = '${email}' AND s.status = 'ACTIVE'`
  );
  assert.equal(activeSubs, 1);

  const paidOrders = scalar(
    `SELECT count(*) FROM orders o
       JOIN users u ON u.id = o.user_id
      WHERE u.email = '${email}' AND o.status = 'PAID'`
  );
  assert.equal(paidOrders, 1);
});
