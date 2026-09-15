'use strict';

// MED-4 — accept and reject share a "respond to a pending send" code path, but
// reject used to run an unconditional UPDATE. A concurrent accept could win the
// guarded status flip (and clone the item), only to be overwritten with
// 'rejected', leaving an orphaned copy behind.
//
// To make the race deterministic the test pins the send row with FOR UPDATE in
// a separate session: both requests read the send as pending and then block on
// their status UPDATE. The accept request is queued first, so once the lock is
// released it commits 'accepted' and the reject request runs against the
// already-accepted row. Pre-fix the reject blindly overwrote it; post-fix the
// `AND status = 'pending'` guard turns it into a 409.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let sender;
let recipient;
let senderProjectId;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  sender = await signupAndLogin(base, 'race-sender@test.io', 'senderpass123', 'Race Sender');
  recipient = await signupAndLogin(base, 'race-recipient@test.io', 'recvpass123', 'Race Recipient');

  const ws = await sender.client.api('GET', '/api/workspaces');
  const tree = await sender.client.api('GET', `/api/workspaces/${ws.json.workspaces[0].id}/content`);
  senderProjectId = tree.json.projects[0].id;
});

after(async () => {
  if (closeApp) await closeApp();
});

async function projectCount(client) {
  const ws = await client.api('GET', '/api/workspaces');
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspaces[0].id}/content`);
  return tree.json.projects.length;
}

async function sendProject() {
  const sent = await sender.client.api('POST', '/api/sends', {
    recipientEmail: 'race-recipient@test.io',
    itemType: 'project',
    itemId: senderProjectId,
  });
  assert.equal(sent.status, 201);
  return sent.json.send.id;
}

function lockClient() {
  return new Client({
    host: '127.0.0.1',
    port: Number(process.env.INTEGRATION_PGPORT || process.env.PGPORT || 5432),
    user: 'postgres',
    password: 'postgres',
    database: process.env.INTEGRATION_PGDATABASE || 'apihub',
  });
}

test('a concurrent reject cannot overwrite an accepted send or orphan its clone', async () => {
  const sendId = await sendProject();
  const before = await projectCount(recipient.client);

  const lock = lockClient();
  await lock.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM sends WHERE id = $1 FOR UPDATE', [sendId]);

  // Accept is dispatched first so it queues on the row lock ahead of reject.
  const acceptP = recipient.client.api('POST', `/api/sends/${sendId}/accept`);
  await sleep(500);
  const rejectP = recipient.client.api('POST', `/api/sends/${sendId}/reject`);
  await sleep(500);
  await lock.query('COMMIT');
  await lock.end();

  const [accept, reject] = await Promise.all([acceptP, rejectP]);
  assert.equal(accept.status, 200, `accept -> ${accept.status} ${JSON.stringify(accept.json)}`);
  assert.equal(reject.status, 409, `reject -> ${reject.status} ${JSON.stringify(reject.json)}`);

  const outbox = await sender.client.api('GET', '/api/sends/outbox');
  const send = outbox.json.sends.find((s) => s.id === sendId);
  assert.equal(send.status, 'accepted');
  assert.ok(send.acceptedPath, 'accepted send must keep its accepted path');
  assert.equal(await projectCount(recipient.client), before + 1, 'exactly one clone must exist');
});

test('a send already accepted cannot be flipped to rejected', async () => {
  const sendId = await sendProject();
  const accepted = await recipient.client.api('POST', `/api/sends/${sendId}/accept`);
  assert.equal(accepted.status, 200);

  const again = await recipient.client.api('POST', `/api/sends/${sendId}/reject`);
  assert.equal(again.status, 409);

  const outbox = await sender.client.api('GET', '/api/sends/outbox');
  const send = outbox.json.sends.find((s) => s.id === sendId);
  assert.equal(send.status, 'accepted');
  assert.ok(send.acceptedPath);
});
