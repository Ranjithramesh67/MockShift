'use strict';

// LOW-1 — blank/whitespace-only names must be rejected instead of being
// silently stored as an empty string.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.close();
});

test('blank names are rejected on create and rename', async () => {
  const owner = await signupAndLogin(app.base, 'blank-name@test.io', 'blankname123', 'Blank Name');
  const workspaces = await owner.client.api('GET', '/api/workspaces');
  const workspaceId = workspaces.json.workspaces[0].id;
  const content = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = content.json.projects[0].id;

  const col = await owner.client.api('POST', '/api/collections', { projectId, name: 'Collection' });
  assert.equal(col.status, 201);
  const collectionId = col.json.collection.id;

  for (const name of ['', '   ']) {
    const res = await owner.client.api('POST', '/api/requests', { collectionId, name });
    assert.equal(res.status, 400, `POST /requests name=${JSON.stringify(name)}`);
  }

  const created = await owner.client.api('POST', '/api/requests', { collectionId, name: 'Valid' });
  assert.equal(created.status, 201);
  const requestId = created.json.request.id;

  const renamed = await owner.client.api('PUT', `/api/requests/${requestId}`, { name: '  ' });
  assert.equal(renamed.status, 400, 'rename to blank');

  const badCollection = await owner.client.api('POST', '/api/collections', { projectId, name: '  ' });
  assert.equal(badCollection.status, 400, 'blank collection name');

  const badFolder = await owner.client.api('POST', '/api/folders', { collectionId, name: '' });
  assert.equal(badFolder.status, 400, 'blank folder name');

  const kept = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.ok(
    kept.json.requests.every((r) => r.name.trim() !== ''),
    'no blank request names may be persisted'
  );
});
