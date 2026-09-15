'use strict';

// HIGH-3 — accepting a send materialises copies into the recipient's org pool,
// so it must honour the same per-plan count gates as a direct create. The
// default harness disables enforcement; this file flips it back on to prove the
// gate fires and that the copy lands once the plan has room.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  psql('UPDATE portal_settings SET restrictions_enforced = true;');
});

after(async () => {
  if (closeApp) await closeApp();
});

async function firstWorkspaceProject(client) {
  const list = await client.api('GET', '/api/workspaces');
  const wsId = list.json.workspaces[0].id;
  const tree = await client.api('GET', `/api/workspaces/${wsId}/content`);
  return { wsId, projectId: tree.json.projects[0].id };
}

test('accepting a send respects the recipient plan limits', async () => {
  const sender = await signupAndLogin(base, 'plan-sender@test.io', 'senderpass123', 'Sender');
  const recipient = await signupAndLogin(base, 'plan-recipient@test.io', 'recvpass123', 'Recipient');

  const from = await firstWorkspaceProject(sender.client);
  const to = await firstWorkspaceProject(recipient.client);

  // Give the source project content so the copy is meaningful.
  const col = await sender.client.api('POST', '/api/collections', {
    projectId: from.projectId,
    name: 'Shared',
  });
  assert.equal(col.status, 201);
  const req = await sender.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.com/ping',
  });
  assert.equal(req.status, 201);

  const sent = await sender.client.api('POST', '/api/sends', {
    recipientEmail: 'plan-recipient@test.io',
    itemType: 'project',
    itemId: from.projectId,
  });
  assert.equal(sent.status, 201);

  // Recipient is on the free plan (1 workspace / 1 project) and already at the
  // project limit, so the copy must be refused.
  const before = await recipient.client.api('GET', `/api/workspaces/${to.wsId}/content`);
  const blocked = await recipient.client.api('POST', `/api/sends/${sent.json.send.id}/accept`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'plan_limit');
  assert.equal(blocked.json.key, 'projects');

  const unchanged = await recipient.client.api('GET', `/api/workspaces/${to.wsId}/content`);
  assert.equal(unchanged.json.projects.length, before.json.projects.length);

  // The send is still pending, so it can be accepted once the recipient has room.
  psql(
    `INSERT INTO subscriptions (user_id, plan_id, status)
     SELECT '${recipient.id}', id, 'ACTIVE' FROM plans WHERE key = 'pro'`
  );

  const accepted = await recipient.client.api('POST', `/api/sends/${sent.json.send.id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.send.status, 'accepted');

  const after = await recipient.client.api('GET', `/api/workspaces/${to.wsId}/content`);
  assert.equal(after.json.projects.length, before.json.projects.length + 1);
});

test('accepting a workspace send is blocked at the workspace limit', async () => {
  const sender = await signupAndLogin(base, 'ws-sender@test.io', 'senderpass123', 'WS Sender');
  const recipient = await signupAndLogin(base, 'ws-recipient@test.io', 'recvpass123', 'WS Recipient');

  const from = await firstWorkspaceProject(sender.client);

  const sent = await sender.client.api('POST', '/api/sends', {
    recipientEmail: 'ws-recipient@test.io',
    itemType: 'workspace',
    itemId: from.wsId,
  });
  assert.equal(sent.status, 201);

  const blocked = await recipient.client.api('POST', `/api/sends/${sent.json.send.id}/accept`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'plan_limit');
  assert.equal(blocked.json.key, 'workspaces');

  const list = await recipient.client.api('GET', '/api/workspaces');
  assert.equal(list.json.workspaces.length, 1);
});
