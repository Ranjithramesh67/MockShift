'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

async function makeRequest(client, wsName) {
  const ws = await client.api('POST', '/api/workspaces', { name: wsName });
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', {
    projectId,
    name: 'Outbox',
  });
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.com/ping',
  });
  return req.json.request.id;
}

test('a user can send an item to anyone by exact email', async () => {
  const sender = await signupAndLogin(base, 'zoe@alpha-sends1.io', 'senderpass123', 'Zoe Sender');
  const recipient = await signupAndLogin(
    base,
    'ravi@beta-sends1.io',
    'recipientpass123',
    'Ravi Receiver'
  );
  const requestId = await makeRequest(sender.client, 'Alpha WS');

  // The recipient must NOT already be in a shared org/workspace: the whole
  // point is that email addresses any active user.
  const list = await sender.client.api('GET', '/api/sends/recipients');
  assert.equal(list.status, 200);
  assert.ok(!list.json.recipients.some((r) => r.id === recipient.id));

  const sent = await sender.client.api('POST', '/api/sends', {
    recipientEmail: 'ravi@beta-sends1.io',
    itemType: 'request',
    itemId: requestId,
    message: 'hi',
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.send.recipient.id, recipient.id);

  const inbox = await recipient.client.api('GET', '/api/sends/inbox');
  assert.equal(inbox.status, 200);
  assert.ok(inbox.json.sends.some((s) => s.id === sent.json.send.id));
});

test('sending to yourself by email is rejected', async () => {
  const solo = await signupAndLogin(base, 'solo@gm-sends2.io', 'solopass123', 'Solo');
  const requestId = await makeRequest(solo.client, 'Solo WS');
  const res = await solo.client.api('POST', '/api/sends', {
    recipientEmail: 'solo@gm-sends2.io',
    itemType: 'request',
    itemId: requestId,
  });
  assert.equal(res.status, 400);
});

test('an unknown email is a 404', async () => {
  const sender = await signupAndLogin(base, 'nobody@gm-sends3.io', 'senderpass123', 'Nobody');
  const requestId = await makeRequest(sender.client, 'Nobody WS');
  const res = await sender.client.api('POST', '/api/sends', {
    recipientEmail: 'ghost@nowhere-sends3.io',
    itemType: 'request',
    itemId: requestId,
  });
  assert.equal(res.status, 404);
});
