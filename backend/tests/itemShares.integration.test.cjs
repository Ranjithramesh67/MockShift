'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, makeClient } = require('./support/harness.cjs');

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

async function seedTree(client) {
  const ws = await client.api('POST', '/api/workspaces', { name: 'Tree WS' });
  const workspaceId = ws.json.workspace.id;
  const tree = await client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Shared Collection' });
  const collectionId = col.json.collection.id;
  const folder = await client.api('POST', '/api/folders', {
    collectionId,
    name: 'Shared Folder',
  });
  const folderId = folder.json.folder.id;
  const req = await client.api('POST', '/api/requests', {
    collectionId,
    folderId,
    name: 'Shared Request',
    method: 'GET',
    url: 'https://example.com/shared',
  });
  assert.equal(req.status, 201);
  const requestId = req.json.request.id;
  const updated = await client.api('PUT', `/api/requests/${requestId}`, {
    headers: [{ key: 'Authorization', value: 'Bearer top-secret', enabled: true }],
  });
  assert.equal(updated.status, 200);
  return { workspaceId, projectId, collectionId, folderId, requestId };
}

test('collection, folder and workspace share links are login-gated and plan-free', async () => {
  const owner = await signupAndLogin(base, 'owner@item-shares1.io', 'ownerpass123', 'Owner');
  const { workspaceId, collectionId, folderId } = await seedTree(owner.client);

  const viewer = await signupAndLogin(base, 'viewer@item-shares2.io', 'viewerpass123', 'Viewer');

  for (const [itemType, itemId] of [
    ['collection', collectionId],
    ['folder', folderId],
    ['workspace', workspaceId],
  ]) {
    const created = await owner.client.api('POST', '/api/shares', { itemType, itemId });
    assert.equal(created.status, 201, `create ${itemType} share`);
    const { token, itemType: echoed } = created.json.share;
    assert.equal(echoed, itemType);
    assert.ok(token);

    const anon = makeClient(base);
    const anonRead = await anon.api('GET', `/api/shares/${token}`);
    assert.equal(anonRead.status, 401, `${itemType} requires login`);

    const read = await viewer.client.api('GET', `/api/shares/${token}`);
    assert.equal(read.status, 200);
    assert.equal(read.json.share.itemType, itemType);
    assert.ok(Array.isArray(read.json.share.item.projects));
    const projects = read.json.share.item.projects;
    assert.equal(projects.length, 1);
    const collections = projects[0].collections;
    assert.equal(collections.length, 1);
    assert.equal(collections[0].name, 'Shared Collection');
    // Credentials are redacted in the tree.
    const folderReq = collections[0].folders[0].requests[0];
    assert.equal(folderReq.name, 'Shared Request');
    assert.equal(
      folderReq.headers.find((h) => h.key === 'Authorization').value,
      '\u00abredacted\u00bb'
    );
  }
});

test('a non-editor outside the workspace cannot create a share link', async () => {
  const owner = await signupAndLogin(base, 'owner2@item-shares3.io', 'ownerpass123', 'Owner Two');
  const { collectionId } = await seedTree(owner.client);
  const stranger = await signupAndLogin(base, 'stranger@item-shares4.io', 'strangerpass123', 'Stranger');

  const denied = await stranger.client.api('POST', '/api/shares', {
    itemType: 'collection',
    itemId: collectionId,
  });
  assert.equal(denied.status, 403);
});
