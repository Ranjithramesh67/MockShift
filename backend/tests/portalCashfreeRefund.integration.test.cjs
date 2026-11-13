'use strict';

// PORTAL-3 — POST /api/subscribers/orders/:id/refund must call Cashfree
// before voiding the local invoice. Ledger-only refunds leave the capture
// at the PSP.

if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;
if (process.env.INTEGRATION_PGDATABASE) process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');
const cashfree = require('../../portal/backend/src/cashfree');

const APP_ID = 'test-app-id';
const SECRET = 'test-secret-key';

let mainApp;
let portalServer;
let portalBase;
let transportCalls;

function installTransport(handler) {
  transportCalls = [];
  cashfree.setTransportForTest(async (url, options) => {
    transportCalls.push({ url, method: options.method || 'GET', body: options.body || null });
    if (handler) return handler(url, options);
    return {
      ok: true,
      status: 200,
      json: async () => ({ refund_id: 'rf_ok', refund_status: 'SUCCESS' }),
    };
  });
}

before(async () => {
  process.env.CASHFREE_APP_ID = APP_ID;
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_ENV = 'sandbox';
  installTransport();

  mainApp = await startApp();
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;
});

after(async () => {
  cashfree.resetTransportForTest();
  delete process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_SECRET_KEY;
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (mainApp) await mainApp.close();
});

async function paidCashfreeOrder(email) {
  const client = makeClient(portalBase);
  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Cf Refund Buyer', email, password: 'refundbuyer123' },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  const confirm = await client.api('POST', `/api/public/checkout/${checkout.json.order.id}/confirm`);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  const orderId = checkout.json.order.id;
  const merchantRef = `cfref-${orderId.slice(0, 8)}`;
  psql(
    `UPDATE orders
        SET gateway_provider = 'CASHFREE',
            gateway_reference = '${merchantRef}',
            gateway_status = 'SUCCEEDED'
      WHERE id = '${orderId}'`
  );
  return { orderId, merchantRef, subscriptionId: confirm.json.subscription.id };
}

async function adminPortalClient(email) {
  await signupAndLogin(mainApp.base, email, 'portaladmin123', 'Portal Admin');
  psql(`UPDATE users SET role = 'ADMIN' WHERE email = '${email}'`);
  const client = makeClient(portalBase);
  const login = await client.api('POST', '/api/auth/login', { email, password: 'portaladmin123' });
  assert.equal(login.status, 200, `admin portal login: ${login.status} ${JSON.stringify(login.json)}`);
  return client;
}

test('refunding a Cashfree order calls the PSP then voids locally (PORTAL-3)', async () => {
  const { orderId, merchantRef, subscriptionId } = await paidCashfreeOrder('cf-refund@test.io');
  const admin = await adminPortalClient('portal-cf-refund-admin@test.io');
  transportCalls = [];

  const refund = await admin.api('POST', `/api/subscribers/orders/${orderId}/refund`);
  assert.equal(refund.status, 200, JSON.stringify(refund.json));
  assert.equal(refund.json.cancelledSubscriptionId, subscriptionId);

  const refundCall = transportCalls.find((c) => /\/refunds/.test(c.url) && c.method === 'POST');
  assert.ok(refundCall, `expected a Cashfree refund POST, got ${JSON.stringify(transportCalls)}`);
  assert.ok(refundCall.url.includes(encodeURIComponent(merchantRef)) || refundCall.url.includes(merchantRef));
  const body = JSON.parse(refundCall.body);
  assert.equal(Number(body.refund_amount), 99);

  assert.equal(
    psql(`SELECT status FROM orders WHERE id = '${orderId}'`).match(/REFUNDED/) ? 'REFUNDED' : 'OTHER',
    'REFUNDED'
  );
});

test('a Cashfree refund failure leaves the local order PAID', async () => {
  installTransport(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ message: 'Refund not allowed' }),
  }));
  const { orderId } = await paidCashfreeOrder('cf-refund-fail@test.io');
  const admin = await adminPortalClient('portal-cf-refund-fail-admin@test.io');

  const refund = await admin.api('POST', `/api/subscribers/orders/${orderId}/refund`);
  assert.equal(refund.status, 502, JSON.stringify(refund.json));
  assert.match(String(refund.json.error || ''), /Refund not allowed|gateway/i);

  assert.ok(psql(`SELECT status FROM orders WHERE id = '${orderId}'`).includes('PAID'));
});
