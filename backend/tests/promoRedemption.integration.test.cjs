'use strict';

// Promo-code redemption at self-service checkout (migration 055).
//
// Covers: the /checkout/quote preview, a percent discount persisted on the
// order (subtotal / discount_amount / promo_code), use-count reservation,
// idempotent settle via the mock confirm path, a 100%-off code activating for
// free, and the rejection reasons (unknown, exhausted, wrong plan).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');

let portalServer;
let portalBase;
let closeApp;

before(async () => {
  const app = await startApp();
  closeApp = app.close;
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;

  // Bootstrap the platform ADMIN so checkout-created customers are regular
  // (gate-eligible) EDITOR users.
  await signupAndLogin(app.base, 'promo-admin@test.io', 'adminpass123', 'Promo Admin');

  psql(`
    INSERT INTO promo_codes (code, description, discount_type, discount_value, currency)
    VALUES ('SAVE20', '20% off', 'PERCENT', 20, 'INR'),
           ('FLAT50', 'Flat 50', 'FIXED', 50, 'INR'),
           ('FREE100', 'Free month', 'PERCENT', 100, 'INR');
    INSERT INTO promo_codes (code, discount_type, discount_value, currency, max_uses, used_count)
    VALUES ('ONCEONLY', 'FIXED', 10, 'INR', 1, 0);
    INSERT INTO promo_codes (code, discount_type, discount_value, currency, plan_id)
    VALUES ('PROONLY', 'PERCENT', 10, 'INR', (SELECT id FROM plans WHERE key = 'pro'));
  `);
});

after(async () => {
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (closeApp) await closeApp();
});

function number(v) {
  return Number(v);
}

// `psql -q -c` still prints a header + "(N rows)" footer; take the first data
// line and trim it.
function scalar(sql) {
  const lines = psql(sql)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^-+$/.test(line));
  return lines[1];
}

async function checkoutGuest(email, promoCode) {
  const client = makeClient(portalBase);
  const res = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Promo Customer', email, password: 'customerpass123' },
    ...(promoCode ? { promoCode } : {}),
  });
  return { client, res };
}

test('quote previews a percent discount without consuming the code', async () => {
  const client = makeClient(portalBase);
  const before = scalar(`SELECT used_count FROM promo_codes WHERE code = 'SAVE20';`);

  const res = await client.api('POST', '/api/public/checkout/quote', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    promoCode: 'SAVE20',
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(number(res.json.base), 99);
  assert.equal(number(res.json.discount), 19.8);
  assert.equal(number(res.json.total), 79.2);
  assert.equal(res.json.promo.code, 'SAVE20');
  assert.equal(res.json.requiresPayment, true);

  const after = scalar(`SELECT used_count FROM promo_codes WHERE code = 'SAVE20';`);
  assert.equal(after, before, 'quote must not reserve the code');
});

test('paid checkout persists the discount and reserves one use', async () => {
  const { res } = await checkoutGuest('promo-save20@test.io', 'SAVE20');
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.requiresPayment, true);
  assert.equal(number(res.json.order.amount), 79.2);
  assert.equal(number(res.json.order.subtotal), 99);
  assert.equal(number(res.json.order.discount_amount), 19.8);
  assert.equal(res.json.order.promo_code, 'SAVE20');
  assert.equal(res.json.promo.code, 'SAVE20');

  const used = scalar(`SELECT used_count FROM promo_codes WHERE code = 'SAVE20';`);
  assert.equal(Number(used), 1);
});

test('fixed discount and confirm settle the discounted order', async () => {
  const { client, res } = await checkoutGuest('promo-flat50@test.io', 'FLAT50');
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(number(res.json.order.amount), 49);
  assert.equal(number(res.json.order.discount_amount), 50);

  const orderId = res.json.order.id;
  const confirm = await client.api('POST', `/api/public/checkout/${orderId}/confirm`, {});
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.subscription.status, 'ACTIVE');
  // The gateway is handed orders.amount, so the discounted total must survive
  // finalization unchanged.
  assert.equal(number(confirm.json.order.amount), 49);
  assert.equal(confirm.json.order.promo_code, 'FLAT50');
});

test('a 100%-off code activates the plan for free', async () => {
  const { res } = await checkoutGuest('promo-free100@test.io', 'FREE100');
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.requiresPayment, false);
  assert.equal(res.json.subscription.status, 'ACTIVE');
  assert.equal(res.json.promo.code, 'FREE100');

  const used = scalar(`SELECT used_count FROM promo_codes WHERE code = 'FREE100';`);
  assert.equal(Number(used), 1, 'a fully discounted checkout still consumes the code');
});

test('unknown, exhausted and wrong-plan codes are rejected', async () => {
  const unknown = await checkoutGuest('promo-unknown@test.io', 'NOPE');
  assert.equal(unknown.res.status, 400, JSON.stringify(unknown.res.json));
  assert.equal(unknown.res.json.code, 'promo_not_found');

  // ONCEONLY has max_uses = 1 — the first use succeeds, the second is refused.
  const first = await checkoutGuest('promo-once-a@test.io', 'ONCEONLY');
  assert.equal(first.res.status, 201, JSON.stringify(first.res.json));
  const second = await checkoutGuest('promo-once-b@test.io', 'ONCEONLY');
  assert.equal(second.res.status, 400, JSON.stringify(second.res.json));
  assert.equal(second.res.json.code, 'promo_exhausted');

  const mismatch = await checkoutGuest('promo-mismatch@test.io', 'PROONLY');
  assert.equal(mismatch.res.status, 400, JSON.stringify(mismatch.res.json));
  assert.equal(mismatch.res.json.code, 'promo_plan_mismatch');
});
