'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startApp,
  makeClient,
  signupAndLogin,
} = require('./support/harness.cjs');

let base;
let closeApp;
let manager;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
  manager = await signupAndLogin(base, 'ar-manager@test.io', 'managerpass123', 'Manager');
});

after(async () => {
  if (closeApp) await closeApp();
});

test('project access request notifies reviewers and can be cancelled', async () => {
  const outsider = await signupAndLogin(base, 'ar-outsider@test.io', 'outsiderpass123', 'Outsider');

  const ws = await manager.client.api('POST', '/api/workspaces', { name: 'AR WS' });
  assert.equal(ws.status, 201);
  const wsId = ws.json.workspace.id;

  const tree = await manager.client.api('GET', `/api/workspaces/${wsId}/content`);
  assert.equal(tree.status, 200);
  const projectId = tree.json.projects[0].id;

  const assign = await manager.client.api('POST', `/api/manage/projects/${projectId}/managers`, {
    userId: manager.id,
  });
  assert.equal(assign.status, 200);

  const created = await outsider.client.api('POST', `/api/projects/${projectId}/access-requests`, {
    reason: 'need access',
    role: 'VIEWER',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.accessRequest.id;

  const notes = await manager.client.api('GET', '/api/notifications');
  assert.equal(notes.status, 200);
  assert.ok(notes.json.notifications.some((n) => /access request/i.test(n.title)));

  const cancel = await outsider.client.api(
    'POST',
    `/api/projects/${projectId}/access-requests/${requestId}/cancel`
  );
  assert.equal(cancel.status, 200);

  const mine = await outsider.client.api('GET', '/api/access-requests/mine');
  assert.equal(mine.status, 200);
  assert.equal(mine.json.accessRequests.find((r) => r.id === requestId).status, 'CANCELLED');

  const review = await manager.client.api('POST', `/api/manage/access-requests/${requestId}/review`, {
    approve: true,
  });
  assert.equal(review.status, 409);
});

test('cancel is creator-only and only allowed while pending', async () => {
  const unrelated = await signupAndLogin(base, 'ar-unrelated@test.io', 'unrelatedpass123', 'Unrelated');
  const creator = await signupAndLogin(base, 'ar-creator@test.io', 'creatorpass123', 'Creator');

  const ws = await manager.client.api('POST', '/api/workspaces', { name: 'AR WS 2' });
  assert.equal(ws.status, 201);
  const tree = await manager.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;

  const created = await creator.client.api('POST', `/api/projects/${projectId}/access-requests`, {
    reason: 'let me in',
    role: 'VIEWER',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.accessRequest.id;

  const strangerCancel = await unrelated.client.api(
    'POST',
    `/api/projects/${projectId}/access-requests/${requestId}/cancel`
  );
  assert.equal(strangerCancel.status, 404);

  const review = await manager.client.api('POST', `/api/manage/access-requests/${requestId}/review`, {
    approve: true,
  });
  assert.equal(review.status, 200);

  const cancelReviewed = await creator.client.api(
    'POST',
    `/api/projects/${projectId}/access-requests/${requestId}/cancel`
  );
  assert.equal(cancelReviewed.status, 409);
});
