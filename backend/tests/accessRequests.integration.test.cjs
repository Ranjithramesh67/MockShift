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

test('workspace access request notifies reviewers and is reviewable', async () => {
  const wsManager = await signupAndLogin(base, 'ws-manager@test.io', 'wsmanagerpass123', 'WS Manager');
  const wsOutsider = await signupAndLogin(base, 'ws-outsider@test.io', 'wsoutsiderpass123', 'WS Outsider');

  const ws = await wsManager.client.api('POST', '/api/workspaces', { name: 'WS AR' });
  assert.equal(ws.status, 201);
  const workspaceId = ws.json.workspace.id;

  const created = await wsOutsider.client.api('POST', '/api/docs/workspace-access-requests', {
    workspaceId,
    reason: 'need',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.request.id;

  const reviewerNotes = await wsManager.client.api('GET', '/api/notifications');
  assert.equal(reviewerNotes.status, 200);
  assert.ok(reviewerNotes.json.notifications.some((n) => /workspace access request/i.test(n.title)));

  const list = await wsManager.client.api(
    'GET',
    `/api/docs/workspace-access-requests?workspaceId=${workspaceId}`
  );
  assert.equal(list.status, 200);
  const pending = list.json.requests.find((r) => r.id === requestId);
  assert.ok(pending);
  assert.equal(pending.status, 'PENDING');

  const review = await wsManager.client.api(
    'POST',
    `/api/docs/workspace-access-requests/${requestId}/review`,
    { approve: true }
  );
  assert.equal(review.status, 200);
  assert.equal(review.json.status, 'APPROVED');

  const requesterNotes = await wsOutsider.client.api('GET', '/api/notifications');
  assert.equal(requesterNotes.status, 200);
  assert.ok(requesterNotes.json.notifications.some((n) => /access granted/i.test(n.title)));

  const content = await wsOutsider.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(content.status, 200);
});

test('workspace access request can be cancelled by its creator only', async () => {
  const wsManager = await signupAndLogin(base, 'ws-mgr-cancel@test.io', 'wsmgrcancel123', 'WS Mgr Cancel');
  const wsCancel = await signupAndLogin(base, 'ws-cancel@test.io', 'wscancelpass123', 'WS Cancel');
  const wsOther = await signupAndLogin(base, 'ws-other@test.io', 'wsotherpass123', 'WS Other');

  const ws = await wsManager.client.api('POST', '/api/workspaces', { name: 'WS AR 2' });
  assert.equal(ws.status, 201);
  const workspaceId = ws.json.workspace.id;

  const created = await wsCancel.client.api('POST', '/api/docs/workspace-access-requests', {
    workspaceId,
    reason: 'let me in',
  });
  assert.equal(created.status, 201);
  const requestId = created.json.request.id;

  const strangerCancel = await wsOther.client.api(
    'POST',
    `/api/docs/workspace-access-requests/${requestId}/cancel`
  );
  assert.equal(strangerCancel.status, 404);

  const cancel = await wsCancel.client.api(
    'POST',
    `/api/docs/workspace-access-requests/${requestId}/cancel`
  );
  assert.equal(cancel.status, 200);

  const mine = await wsCancel.client.api('GET', '/api/docs/workspace-access-requests?mine=1');
  assert.equal(mine.status, 200);
  assert.equal(mine.json.requests.find((r) => r.id === requestId).status, 'CANCELLED');
});
