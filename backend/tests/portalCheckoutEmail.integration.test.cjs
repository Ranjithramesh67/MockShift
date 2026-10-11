'use strict';

// Portal A checkout is the production account-creation path (self-service
// signup is closed), so the buyer is the one who sees the "Please verify your
// email address" banner. Checkout therefore has to mint and mail the link; it
// previously provisioned the account and never sent one.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient } = require('./support/harness.cjs');
const email = require('../src/api/email');

let closeApp;
let portalServer;
let portalBase;
const sent = [];

before(async () => {
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: `checkout-${sent.length}` };
    },
  });
  const app = await startApp();
  closeApp = app.close;
  const { createApp } = require('../../portal/backend/src/server');
  portalServer = await new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  portalBase = `http://127.0.0.1:${portalServer.address().port}`;
});

after(async () => {
  email.resetTransportForTest();
  if (portalServer) await new Promise((resolve) => portalServer.close(resolve));
  if (closeApp) await closeApp();
});

test('checkout emails a verification link the buyer can redeem', async () => {
  const address = 'checkout-verify@test.io';
  const client = makeClient(portalBase);

  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'free',
    billingCycle: 'MONTHLY',
    account: { name: 'Verify Buyer', email: address, password: 'buyerpass123' },
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.json.account.created, true);
  assert.equal(checkout.json.account.emailVerification, 'sent');

  const message = sent.find((m) => m.to === address);
  assert.ok(message, 'verification email was sent to the new buyer');
  const match = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(message.text || '');
  assert.ok(match, `token link not found in: ${message.text}`);

  const verified = await client.api('POST', '/api/auth/verify-email', { token: match[1] });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.ok, true);
});

test('an existing signed-in customer is not re-sent verification mail', async () => {
  const address = 'checkout-returning@test.io';
  const buyer = makeClient(portalBase);
  const first = await buyer.api('POST', '/api/public/checkout', {
    planKey: 'free',
    billingCycle: 'MONTHLY',
    account: { name: 'Returning Buyer', email: address, password: 'buyerpass123' },
  });
  assert.equal(first.status, 201);
  const before = sent.filter((m) => m.to === address).length;

  const again = await buyer.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
  });
  assert.equal(again.status, 201);
  assert.equal(again.json.account.created, false);
  assert.equal(sent.filter((m) => m.to === address).length, before);
});
