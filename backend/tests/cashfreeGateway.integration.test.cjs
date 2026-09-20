'use strict';

// Real Cashfree gateway + payment login gate.
//
// Covers: a paid checkout order keeps the customer out of the app (login 402,
// app APIs 402) until the provider confirms payment; the Cashfree session
// endpoint hands back a hosted-checkout session; both the status poll and the
// signed webhook settle the order through the same idempotent finalizer and
// re-open the account.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');

// Dummy credentials — the Cashfree client is stubbed via setTransportForTest,
// so no real network call is made and no production secret ever lives here.
const APP_ID = process.env.CASHFREE_TEST_APP_ID || 'test-app-id';
const SECRET = process.env.CASHFREE_TEST_SECRET_KEY || 'test-secret-key';

let base;
let closeApp;
let portalServer;
let portalBase;
const cashfree = require('../../portal/backend/src/cashfree');

const remoteOrders = new Map();
let transportCalls;

function installTransport() {
  transportCalls = [];
  cashfree.setTransportForTest(async (url, options) => {
    transportCalls.push({ url, options });
    const parsed = JSON.parse(options.body || '{}');
    if ((options.method || 'GET') === 'POST' && /\/orders$/.test(url)) {
      const cf = { cf_order_id: `cf_${parsed.order_id.slice(0, 8)}`, payment_session_id: `ps_${parsed.order_id.slice(0, 8)}`, order_status: 'ACTIVE' };
      remoteOrders.set(parsed.order_id, cf);
      remoteOrders.set(cf.cf_order_id, cf);
      return { ok: true, status: 200, json: async () => cf };
    }
    if (/\/orders\//.test(url)) {
      const id = decodeURIComponent(url.split('/orders/')[1]);
      const cf = remoteOrders.get(id) || { cf_order_id: `cf_${id.slice(0, 8)}`, order_status: 'ACTIVE' };
      return { ok: true, status: 200, json: async () => cf };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
  });
}

before(async () => {
  process.env.CASHFREE_APP_ID = APP_ID;
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_ENV = 'sandbox';
  installTransport();

  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;

  // Bootstrap the platform ADMIN so the customer created by checkout is a
  // regular (gate-eligible) user.
  await signupAndLogin(base, 'cf-admin@test.io', 'adminpass123', 'CF Admin');
});

after(async () => {
  cashfree.resetTransportForTest();
  delete process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_SECRET_KEY;
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (closeApp) await closeApp();
});

async function createUnpaidCustomer(email) {
  const client = makeClient(portalBase);
  const res = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Cash Customer', email, password: 'customerpass123' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.requiresPayment, true);
  return { client, orderId: res.json.order.id };
}
test('unpaid checkout customer is refused login and app access', async () => {
  const { client: portalClient } = await createUnpaidCustomer('cf-unpaid@test.io');
  const appClient = makeClient(base, portalClient.cookie);

  const login = await appClient.api('POST', '/api/auth/login', {
    email: 'cf-unpaid@test.io',
    password: 'customerpass123',
  });
  assert.equal(login.status, 402);
  assert.equal(login.json.code, 'payment_required');
  assert.ok(login.json.order_id, 'the pending order id is returned');

  // Identity + payment endpoints stay reachable (allowlist) even though the
  // session belongs to an unpaid customer.
  const me = await appClient.api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.payment_required, true);
  assert.equal(me.json.pending_order.id, login.json.order_id);

  // A regular app API is blocked for the unpaid session.
  const teams = await appClient.api('GET', '/api/teams');
  assert.equal(teams.status, 402);
  assert.equal(teams.json.code, 'payment_required');
});

test('cashfree session bootstrap returns a hosted checkout session', async () => {
  const { client, orderId } = await createUnpaidCustomer('cf-session@test.io');
  const session = await client.api('POST', `/api/public/gateway/cashfree/${orderId}/session`);
  assert.equal(session.status, 200, JSON.stringify(session.json));
  assert.equal(session.json.provider, 'CASHFREE');
  assert.equal(session.json.mode, 'sandbox');
  assert.match(session.json.payment_session_id, /^ps_/);

  // The order now carries the provider ids.
  const status = await client.api('GET', `/api/public/gateway/cashfree/${orderId}/status`);
  assert.equal(status.status, 200);
  assert.equal(status.json.order.gateway.provider, 'CASHFREE');
});

test('status poll finalizes a provider-paid order and re-opens the account', async () => {
  const { client: portalClient, orderId } = await createUnpaidCustomer('cf-poll@test.io');
  await portalClient.api('POST', `/api/public/gateway/cashfree/${orderId}/session`);

  // Provider reports PAID on the next poll.
  for (const cf of remoteOrders.values()) cf.order_status = 'PAID';

  const status = await portalClient.api('GET', `/api/public/gateway/cashfree/${orderId}/status`);
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.order.status, 'PAID');
  assert.ok(status.json.subscription, 'an active subscription was created');

  const appClient = makeClient(base, portalClient.cookie);
  const login = await appClient.api('POST', '/api/auth/login', {
    email: 'cf-poll@test.io',
    password: 'customerpass123',
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));

  const teams = await appClient.api('GET', '/api/teams');
  assert.equal(teams.status, 200);
});

test('signed webhook finalizes the order; bad signatures are rejected', async () => {
  const { orderId } = await createUnpaidCustomer('cf-hook@test.io');
  const payload = {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: { order: { order_id: orderId, order_status: 'PAID' }, payment: { payment_status: 'SUCCESS' } },
  };
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', SECRET).update(`${timestamp}${raw}`).digest('base64');

  const anon = makeClient(portalBase);
  const bad = await anon.api('POST', '/api/public/webhooks/cashfree', payload, {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': 'not-a-signature',
  });
  assert.equal(bad.status, 401);

  const ok = await anon.api('POST', '/api/public/webhooks/cashfree', payload, {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': signature,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.order.status, 'PAID');
  assert.ok(ok.json.subscription);

  // Replay is idempotent (no second subscription).
  const replay = await anon.api('POST', '/api/public/webhooks/cashfree', payload, {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': signature,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.alreadyProcessed, true);
});

test('the gate is a no-op when payment_gate_required is false', async () => {
  const { client: portalClient } = await createUnpaidCustomer('cf-off@test.io');
  const appClient = makeClient(base, portalClient.cookie);

  psql('UPDATE portal_settings SET payment_gate_required = false;');
  try {
    const login = await appClient.api('POST', '/api/auth/login', {
      email: 'cf-off@test.io',
      password: 'customerpass123',
    });
    assert.equal(login.status, 200, JSON.stringify(login.json));

    const teams = await appClient.api('GET', '/api/teams');
    assert.equal(teams.status, 200);
  } finally {
    psql('UPDATE portal_settings SET payment_gate_required = true;');
  }
});
