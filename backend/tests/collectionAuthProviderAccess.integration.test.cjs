'use strict';

// MED-1 — GET /api/collections/:id/auth-provider used to return the saved auth
// configuration to any authenticated caller who knew the collection id. It now
// requires read access to the owning project.

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

async function makeCollection(client, wsName) {
  const ws = await client.api('POST', '/api/workspaces', { name: wsName });
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Secured' });
  return col.json.collection.id;
}

test('auth-provider read is scoped to collection access', async () => {
  const owner = await signupAndLogin(base, 'ap-owner@test.io', 'ownerpass123', 'Owner');
  const stranger = await signupAndLogin(base, 'ap-stranger@test.io', 'strangerpass123', 'Stranger');
  const collectionId = await makeCollection(owner.client, 'Auth WS');

  const put = await owner.client.api('PUT', `/api/collections/${collectionId}/auth-provider`, {
    authType: 'BEARER_TOKEN',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer',
    tokenPath: 'token',
  });
  assert.equal(put.status, 200);

  const mine = await owner.client.api('GET', `/api/collections/${collectionId}/auth-provider`);
  assert.equal(mine.status, 200);
  assert.equal(mine.json.authProvider.authType, 'BEARER_TOKEN');

  const foreign = await stranger.client.api('GET', `/api/collections/${collectionId}/auth-provider`);
  assert.equal(foreign.status, 403);

  const missing = await owner.client.api(
    'GET',
    '/api/collections/00000000-0000-0000-0000-000000000000/auth-provider'
  );
  assert.equal(missing.status, 404);
});
