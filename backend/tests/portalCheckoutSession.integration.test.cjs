'use strict';

// AUTH-4 — portal checkout/resume must stamp createSessionToken with the
// user's session_epoch. Omitting it mints sv=0, which requireAuth rejects
// after a password change (or any epoch bump).

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

test('checkout resume mints a session that matches session_epoch (AUTH-4)', async () => {
  const email = 'auth4-resume@test.io';
  const client = makeClient(portalBase);

  const checkout = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'AUTH4 Buyer', email, password: 'buyerpass123' },
  });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.json.requiresPayment, true);
  assert.equal(checkout.json.account.created, true);

  psql(`UPDATE users SET session_epoch = 3 WHERE lower(email) = '${email}'`);

  const stale = await client.api('GET', '/api/me');
  assert.equal(stale.status, 401);

  const resume = await client.api('POST', '/api/public/checkout/resume', {
    email,
    password: 'buyerpass123',
  });
  assert.equal(resume.status, 200);
  assert.equal(resume.json.ok, true);

  const me = await client.api('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, email);
});
