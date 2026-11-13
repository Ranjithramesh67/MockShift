'use strict';

// PORTAL-2 — POST /api/public/checkout must not insert a second PENDING order
// while one is already open. HIGH-4 made confirm race-safe; create still
// multiplied PENDING rows so two confirms could both settle.

if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;
if (process.env.INTEGRATION_PGDATABASE) process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE;

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

test('a second checkout reuses the open PENDING order (PORTAL-2)', async () => {
  const email = 'portal2-pending@test.io';
  const client = makeClient(portalBase);

  const first = await client.api('POST', '/api/public/checkout', {
    planKey: 'starter',
    billingCycle: 'MONTHLY',
    account: { name: 'Pending Buyer', email, password: 'pendingpass123' },
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.requiresPayment, true);
  const orderId = first.json.order.id;

  const second = await client.api('POST', '/api/public/checkout', {
    planKey: 'pro',
    billingCycle: 'MONTHLY',
  });
  assert.equal(second.status, 409, JSON.stringify(second.json));
  assert.equal(second.json.code, 'pending_payment');
  assert.equal(second.json.order.id, orderId);

  const pending = scalar(
    `SELECT count(*) FROM orders o
       JOIN users u ON u.id = o.user_id
      WHERE u.email = '${email}' AND o.status = 'PENDING'`
  );
  assert.equal(pending, 1);
});
