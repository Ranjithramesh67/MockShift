'use strict';

// Self-service signup must never bypass plan selection in a real deployment.
//
// Accounts are provisioned with a plan through the Portal A plans/checkout
// flow, so the main-app /signup form is a gateway to the plans page unless the
// direct path is explicitly enabled for automated test/dev runs
// (ALLOW_SELF_SIGNUP=1) — and even then it must stay closed under
// NODE_ENV=production so a stray env var cannot open signup on a live site.
//
// Regression: the deployed app served signup-status {open:true} with
// ALLOW_SELF_SIGNUP=1 set alongside NODE_ENV=production, so "Create account"
// created a user and dropped them straight into the app with no plan.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
const originalNodeEnv = process.env.NODE_ENV;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (closeApp) await closeApp();
});

test('signup is open for the empty-database bootstrap only', async () => {
  const client = makeClient(base);
  const status = await client.api('GET', '/api/auth/signup-status');
  assert.equal(status.status, 200);
  assert.equal(status.json.open, true);

  // The very first account is the platform ADMIN bootstrap and is allowed.
  const boot = await signupAndLogin(base, 'gate-boot@test.io', 'bootpass123', 'Boot');
  assert.ok(boot.id);
});

test('direct signup needs the test opt-in and stays closed in production', async () => {
  const client = makeClient(base);

  // Opt-in without NODE_ENV=production (the automated test/dev case): open.
  delete process.env.NODE_ENV;
  process.env.ALLOW_SELF_SIGNUP = '1';
  const open = await client.api('GET', '/api/auth/signup-status');
  assert.equal(open.status, 200);
  assert.equal(open.json.open, true);

  const created = await client.api('POST', '/api/auth/signup', {
    email: 'gate-dev@test.io',
    password: 'devpass123',
    name: 'Dev',
  });
  assert.equal(created.status, 201);

  // Same opt-in under NODE_ENV=production: the plans gateway wins.
  process.env.NODE_ENV = 'production';
  const closed = await client.api('GET', '/api/auth/signup-status');
  assert.equal(closed.status, 200);
  assert.equal(closed.json.open, false);

  const blocked = await client.api('POST', '/api/auth/signup', {
    email: 'gate-prod@test.io',
    password: 'prodpass123',
    name: 'Prod',
  });
  assert.equal(blocked.status, 403);
  assert.match(blocked.json.error, /plan/i);
});
