'use strict';

// Manual onboarding — a portal MANAGER can create a subscriber account (and
// optionally grant a plan) without waiting for self-service signup, and can
// grant a plan to an existing user that has no active subscription.

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

function planId(key) {
  const out = psql(`SELECT id FROM plans WHERE key = '${key}'`);
  const match = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!match) throw new Error(`plan ${key} not found`);
  return match[0];
}

function scalar(sql) {
  const match = psql(sql).match(/^\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : NaN;
}

async function managerPortalClient(email) {
  await signupAndLogin(mainApp.base, email, 'portaladmin123', 'Portal Manager');
  psql(`UPDATE users SET role = 'MANAGER' WHERE email = '${email}'`);
  const client = makeClient(portalBase);
  const login = await client.api('POST', '/api/auth/login', {
    email,
    password: 'portaladmin123',
  });
  assert.equal(
    login.status,
    200,
    `portal login: ${login.status} ${JSON.stringify(login.json)}`
  );
  return client;
}

test('manager creates a subscriber without a plan and gets a one-time password', async () => {
  const manager = await managerPortalClient('portal-create-manager@test.io');
  const res = await manager.api('POST', '/api/subscribers', {
    name: 'Manual Onboard',
    email: 'manual-onboard@test.io',
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.user.role, 'EDITOR');
  assert.equal(res.json.user.email, 'manual-onboard@test.io');
  assert.equal(res.json.subscription, null);
  assert.ok(res.json.temporaryPassword, 'temporaryPassword must be returned');

  const login = await makeClient(mainApp.base).api('POST', '/api/auth/login', {
    email: 'manual-onboard@test.io',
    password: res.json.temporaryPassword,
  });
  assert.equal(login.status, 200, 'generated password must work for app login');
  assert.equal(
    scalar(`SELECT count(*) FROM audit_log WHERE action = 'subscribers.create' AND target_ref = 'manual-onboard@test.io'`),
    1
  );
});

test('manager creates a subscriber with a plan; trial plan starts TRIALING', async () => {
  const manager = await managerPortalClient('portal-create-plan-manager@test.io');
  const res = await manager.api('POST', '/api/subscribers', {
    name: 'Plan Buyer',
    email: 'manual-plan@test.io',
    password: 'chosenpass123',
    planId: planId('starter'),
    billingCycle: 'MONTHLY',
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.temporaryPassword, undefined);
  assert.equal(res.json.subscription.status, 'TRIALING');
  assert.equal(res.json.subscription.billing_cycle, 'MONTHLY');
  assert.equal(res.json.subscription.plan.key, 'starter');
});

test('creating a duplicate email returns 409', async () => {
  const manager = await managerPortalClient('portal-create-dup-manager@test.io');
  const first = await manager.api('POST', '/api/subscribers', {
    name: 'Dup One',
    email: 'manual-dup@test.io',
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await manager.api('POST', '/api/subscribers', {
    name: 'Dup Two',
    email: 'MANUAL-DUP@test.io',
  });
  assert.equal(second.status, 409, JSON.stringify(second.json));
});

test('privileged roles and short passwords are rejected', async () => {
  const manager = await managerPortalClient('portal-create-validate-manager@test.io');
  const badRole = await manager.api('POST', '/api/subscribers', {
    name: 'Bad Role',
    email: 'manual-badrole@test.io',
    role: 'ADMIN',
  });
  assert.equal(badRole.status, 400, JSON.stringify(badRole.json));

  const shortPw = await manager.api('POST', '/api/subscribers', {
    name: 'Short Pw',
    email: 'manual-shortpw@test.io',
    password: 'short',
  });
  assert.equal(shortPw.status, 400, JSON.stringify(shortPw.json));
});

test('manager grants a plan to an existing user, then a second grant is a 409', async () => {
  const manager = await managerPortalClient('portal-grant-manager@test.io');
  const { id } = await signupAndLogin(mainApp.base, 'manual-grant@test.io', 'grantuser123', 'Grant User');

  const grant = await manager.api('POST', `/api/subscribers/${id}/subscriptions`, {
    planId: planId('free'),
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.json));
  assert.equal(grant.json.subscription.status, 'ACTIVE');
  assert.equal(grant.json.subscription.plan.key, 'free');

  const again = await manager.api('POST', `/api/subscribers/${id}/subscriptions`, {
    planId: planId('pro'),
  });
  assert.equal(again.status, 409, JSON.stringify(again.json));
});

test('portal VIEWER cannot create or grant', async () => {
  const viewer = await makeClient(portalBase);
  await signupAndLogin(mainApp.base, 'portal-reader@test.io', 'readerpass123', 'Portal Reader');
  psql(`UPDATE users SET role = 'VIEWER' WHERE email = 'portal-reader@test.io'`);
  const login = await viewer.api('POST', '/api/auth/login', {
    email: 'portal-reader@test.io',
    password: 'readerpass123',
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));

  const create = await viewer.api('POST', '/api/subscribers', {
    name: 'Nope',
    email: 'manual-nope@test.io',
  });
  assert.equal(create.status, 403, JSON.stringify(create.json));
});

test('non-portal role (EDITOR) is denied portal access entirely', async () => {
  const { client } = await signupAndLogin(mainApp.base, 'portal-editor@test.io', 'editorpass123', 'Portal Editor');
  // Reuse the app session cookie against the portal (same auth secret).
  const portalClient = makeClient(portalBase, client.cookie);
  const create = await portalClient.api('POST', '/api/subscribers', {
    name: 'Nope',
    email: 'manual-editor-nope@test.io',
  });
  assert.equal(create.status, 403, JSON.stringify(create.json));
});
