'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, makeClient } = require('./support/harness.cjs');

let app;
let user;

before(async () => {
  app = await startApp();
  user = await signupAndLogin(app.base, 'history@example.com', 'password12');
  const ws = await user.client.api('POST', '/api/workspaces', { name: 'History WS' });
  const content = await user.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = content.json.projects[0].id;
  const col = await user.client.api('POST', '/api/collections', { projectId, name: 'History collection' });
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Tracked',
    method: 'GET',
    url: 'https://example.com/a',
  });
  user.projectId = projectId;
  user.collectionId = col.json.collection.id;
  user.requestId = req.json.request.id;
});

after(async () => {
  if (app) await app.close();
});

test('creating a request records a create revision by its author', async () => {
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.status, 200);
  assert.equal(res.json.revisions.length, 1);
  const [first] = res.json.revisions;
  assert.equal(first.changeKind, 'create');
  assert.equal(first.revisionNumber, 1);
  assert.equal(first.createdBy.id, user.id);
  assert.deepEqual(first.changedFields, []);
});

test('updating a request records an update revision with a field diff', async () => {
  const put = await user.client.api('PUT', `/api/requests/${user.requestId}`, {
    url: 'https://example.com/b',
    headers: [{ key: 'X-Test', value: '1', enabled: true }],
  });
  assert.equal(put.status, 200);

  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.json.revisions[0].changeKind, 'update');
  assert.equal(res.json.revisions[0].revisionNumber, 2);
  const fields = res.json.revisions[0].changedFields;
  const url = fields.find((f) => f.field === 'url');
  assert.deepEqual(url, { field: 'url', from: 'https://example.com/a', to: 'https://example.com/b' });
  assert.ok(fields.some((f) => f.field === 'headers'));
});

test('a no-op save records no revision', async () => {
  await user.client.api('PUT', `/api/requests/${user.requestId}`, { url: 'https://example.com/b' });
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.json.revisions.length, 2);
});

test('revision detail returns the stored snapshot', async () => {
  const list = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  const createId = list.json.revisions.find((r) => r.changeKind === 'create').id;
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions/${createId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.revision.snapshot.url, 'https://example.com/a');
});

test('a non-member cannot read another project history', async () => {
  const outsider = await signupAndLogin(app.base, 'outsider@example.com', 'password12');
  const res = await outsider.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.status, 403);
});

test('a viewer may read but not roll back', async () => {
  const viewer = await signupAndLogin(app.base, 'viewer@example.com', 'password12');
  await user.client.api('POST', `/api/projects/${user.projectId}/members`, {
    userId: viewer.id,
    role: 'VIEWER',
  });
  const list = await viewer.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(list.status, 200);
  const revId = list.json.revisions[0].id;
  const rollback = await viewer.client.api('POST', `/api/requests/${user.requestId}/revisions/${revId}/rollback`);
  assert.equal(rollback.status, 403);
});

test('unknown request ids return 404', async () => {
  const res = await user.client.api('GET', '/api/requests/00000000-0000-0000-0000-000000000000/revisions');
  assert.equal(res.status, 404);
});
