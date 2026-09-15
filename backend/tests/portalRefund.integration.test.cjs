'use strict';

// MED-8 — refunding an order used to leave the subscription it created ACTIVE,
// so a refunded customer kept paid entitlements. The refund now cancels
// order.subscription_id in the same transaction and locks the order row FOR
// UPDATE so concurrent refunds settle once.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');

let mainApp;
let portalServer;
let portalBase;

before(async () => {
  mainApp = await startApp();
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;
});

after(async () => {
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (mainApp) await mainApp.close();
});

function scalar(sql) {
  const match = psql(sql).match(/^\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : NaN;
}

async function paidOrderWithSubscription(email) {
  const client = makeClient(portalBase);
  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Refund Buyer', email, password: 'refundbuyer123' },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  return { orderId: checkout.json.order.id, subscriptionId: confirm.json.subscription.id };
}

async function adminPortalClient(email) {
  await signupAndLogin(mainApp.base, email, 'portaladmin123', 'Portal Admin');
  psql(`UPDATE users SET role = 'ADMIN' WHERE email = '${email}'`);
  const client = makeClient(portalBase);
  const login = await client.api('POST', '/api/auth/login', { email, password: 'portaladmin123' });
  assert.equal(login.status, 200, `admin portal login: ${login.status} ${JSON.stringify(login.json)}`);
  return client;
}

test('refunding a paid order cancels its subscription and voids its invoice', async () => {
  const { orderId, subscriptionId } = await paidOrderWithSubscription('refund-cancel@test.io');
  const admin = await adminPortalClient('portal-refund-admin@test.io');

  const refund = await admin.api('POST', `/api/subscribers/orders/${orderId}/refund`);
  assert.equal(refund.status, 200, JSON.stringify(refund.json));
  assert.equal(refund.json.cancelledSubscriptionId, subscriptionId);

  assert.equal(
    scalar(`SELECT count(*) FROM orders WHERE id = '${orderId}' AND status = 'REFUNDED'`),
    1
  );
  assert.equal(
    scalar(`SELECT count(*) FROM invoices WHERE order_id = '${orderId}' AND status = 'VOID'`),
    1
  );
  assert.equal(
    scalar(`SELECT count(*) FROM subscriptions WHERE id = '${subscriptionId}' AND status = 'CANCELLED'`),
    1
  );
});

test('concurrent refunds settle once (second gets 409)', async () => {
  const { orderId } = await paidOrderWithSubscription('refund-race@test.io');
  const admin = await adminPortalClient('portal-refund-race-admin@test.io');

  const results = await Promise.all([
    admin.api('POST', `/api/subscribers/orders/${orderId}/refund`),
    admin.api('POST', `/api/subscribers/orders/${orderId}/refund`),
  ]);
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], `expected one refund to win, got ${JSON.stringify(statuses)}`);

  const audits = scalar(
    `SELECT count(*) FROM audit_log WHERE action = 'orders.refund' AND target_id::text = '${orderId}'`
  );
  assert.equal(audits, 1, 'only the winning refund must be audited');
});
