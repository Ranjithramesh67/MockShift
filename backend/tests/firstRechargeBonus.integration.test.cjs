'use strict';

// MED-7 — the first-recharge bonus was computed before the payment transaction
// (and outside any lock). Two different PENDING orders for the same customer
// finalised concurrently both saw "no prior paid order" and both granted the
// plan trial bonus. The bonus is now computed inside the transaction under a
// per-user advisory lock, so exactly one order can be the "first recharge".

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient } = require('./support/harness.cjs');

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

  const second = await client.api('POST', '/api/public/checkout', {
    planKey: 'pro',
    billingCycle: 'MONTHLY',
  });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.equal(second.json.requiresPayment, true);

  const [one, two] = await Promise.all([
    client.api('POST', `/api/public/checkout/${first.json.order.id}/confirm`),
    client.api('POST', `/api/public/checkout/${second.json.order.id}/confirm`),
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
