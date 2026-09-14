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
  assert.equal(put.json.request.collection_id, user.collectionId);

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

test('rollback restores an earlier snapshot and records a rollback revision', async () => {
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId,
    name: 'Rollback me',
    method: 'GET',
    url: 'https://example.com/v1',
  });
  const id = req.json.request.id;
  await user.client.api('PUT', `/api/requests/${id}`, { url: 'https://example.com/v2' });

  const list = await user.client.api('GET', `/api/requests/${id}/revisions`);
  const v1 = list.json.revisions.find((r) => r.revisionNumber === 1);

  const rb = await user.client.api('POST', `/api/requests/${id}/revisions/${v1.id}/rollback`);
  assert.equal(rb.status, 200);
  assert.equal(rb.json.revision.changeKind, 'rollback');
  assert.equal(rb.json.revision.rolledBackFrom, v1.id);

  const after = await user.client.api('GET', `/api/requests/${id}`);
  assert.equal(after.json.request.url, 'https://example.com/v1');

  const list2 = await user.client.api('GET', `/api/requests/${id}/revisions`);
  assert.equal(list2.json.revisions.length, 3);
  assert.equal(list2.json.revisions[0].changeKind, 'rollback');
  const fields = list2.json.revisions[0].changedFields;
  assert.deepEqual(fields.find((f) => f.field === 'url'), {
    field: 'url',
    from: 'https://example.com/v2',
    to: 'https://example.com/v1',
  });
});

test('rolling back to an unknown revision returns 404', async () => {
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId,
    name: 'Bad rollback',
    method: 'GET',
    url: 'https://example.com/x',
  });
  const res = await user.client.api(
    'POST',
    `/api/requests/${req.json.request.id}/revisions/00000000-0000-0000-0000-000000000000/rollback`
  );
  assert.equal(res.status, 404);
});

test('a revision from a different request cannot be rolled back onto this request', async () => {
  const a = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId, name: 'A', method: 'GET', url: 'https://example.com/a',
  });
  const b = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId, name: 'B', method: 'GET', url: 'https://example.com/b',
  });
  const listA = await user.client.api('GET', `/api/requests/${a.json.request.id}/revisions`);
  const revA = listA.json.revisions[0].id;
  const res = await user.client.api('POST', `/api/requests/${b.json.request.id}/revisions/${revA}/rollback`);
  assert.equal(res.status, 404);
});
