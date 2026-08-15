'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlReset() {
  return execFileSync(
    'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-c', 'DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public'],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
}

let server;
let base;

function makeClient() {
  let cookie = '';
  async function api(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api, get cookie() { return cookie; } };
}

async function signup(client, email, password, name) {
  const res = await client.api('POST', '/api/auth/signup', { email, password, name });
  assert.equal(res.status, 201, `${email} signup`);
}

async function defaultProjectId(client) {
  const ws = await client.api('GET', '/api/workspaces');
  assert.equal(ws.status, 200);
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(myWs, 'found My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  assert.equal(content.status, 200);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  return project.id;
}

let admin;
let outsider;
let projectId;
let collectionId;
let rootFolderId;
let childFolderId;
let leafFolderId;
let requestInFolderId;
let requestRootId;

before(async () => {
  psqlReset();
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-f', path.join(ROOT, 'db', 'migrations', file)], {
      env: PGENV,
      stdio: 'pipe',
    });
  }

  process.env.PGDATABASE = 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  await signup(admin, 'fldadmin@test.io', 'adminpass123', 'Folder Admin');
  projectId = await defaultProjectId(admin);

  outsider = makeClient();
  await signup(outsider, 'fldout@test.io', 'outpass123', 'Folder Outsider');

  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Folder Tree' });
  assert.equal(col.status, 201);
  collectionId = col.json.collection.id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

test('create nested folders root -> child -> leaf', async () => {
  const root = await admin.api('POST', '/api/folders', { collectionId, name: 'Payments' });
  assert.equal(root.status, 201);
  rootFolderId = root.json.folder.id;
  assert.equal(root.json.folder.parent_id, null);

  const child = await admin.api('POST', '/api/folders', { collectionId, parentId: rootFolderId, name: 'Refunds' });
  assert.equal(child.status, 201);
  childFolderId = child.json.folder.id;
  assert.equal(child.json.folder.parent_id, rootFolderId);

  const leaf = await admin.api('POST', '/api/folders', { collectionId, parentId: childFolderId, name: 'Legacy' });
  assert.equal(leaf.status, 201);
  leafFolderId = leaf.json.folder.id;
  assert.equal(leaf.json.folder.parent_id, childFolderId);

  const tree = await admin.api('GET', '/api/workspaces');
  const myWs = tree.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const folders = content.json.folders.filter((f) => f.collection_id === collectionId);
  assert.equal(folders.length, 3);
  assert.equal(folders.find((f) => f.id === rootFolderId).parent_id, null);
  assert.equal(folders.find((f) => f.id === childFolderId).parent_id, rootFolderId);
  assert.equal(folders.find((f) => f.id === leafFolderId).parent_id, childFolderId);
});

test('requests can be placed in folders and fall back to root on folder delete', async () => {
  const inFolder = await admin.api('POST', '/api/requests', {
    collectionId,
    folderId: childFolderId,
    name: 'Refund lookup',
    method: 'GET',
    url: 'http://127.0.0.1:3999/refunds/:id',
    apiType: 'REST',
  });
  assert.equal(inFolder.status, 201);
  assert.equal(inFolder.json.request.folder_id, childFolderId);
  requestInFolderId = inFolder.json.request.id;

  const atRoot = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Health',
    method: 'GET',
    url: 'http://127.0.0.1:3999/health',
    apiType: 'REST',
  });
  assert.equal(atRoot.status, 201);
  assert.equal(atRoot.json.request.folder_id, null);
  requestRootId = atRoot.json.request.id;

  // Moving a request into a folder from another collection is rejected.
  const otherCol = await admin.api('POST', '/api/collections', { projectId, name: 'Other' });
  const otherRequest = await admin.api('POST', '/api/requests', {
    collectionId: otherCol.json.collection.id,
    name: 'X',
    method: 'GET',
    url: 'http://x',
    apiType: 'REST',
  });
  const badMove = await admin.api('PUT', `/api/requests/${otherRequest.json.request.id}`, { folderId: childFolderId });
  assert.equal(badMove.status, 400);

  // Delete the leaf folder; it had no requests, so nothing changes.
  await admin.api('DELETE', `/api/folders/${leafFolderId}`);
  // Delete child folder; its request falls back to the collection root.
  await admin.api('DELETE', `/api/folders/${childFolderId}`);
  const fresh = await admin.api('GET', `/api/requests/${requestInFolderId}`);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.request.folderId, null, 'request fell back to collection root');
});

test('cycle prevention rejects moving a folder inside its own descendant', async () => {
  // Payments (root) -> Refunds (child, deleted above) ... rebuild quickly:
  const rebuild = await admin.api('POST', '/api/folders', { collectionId, parentId: rootFolderId, name: 'Refunds2' });
  const ref2 = rebuild.json.folder.id;
  const deep = await admin.api('POST', '/api/folders', { collectionId, parentId: ref2, name: 'Deep' });
  const deepId = deep.json.folder.id;

  // Moving Payments inside Deep would create a cycle -> 400.
  const cycle = await admin.api('PUT', `/api/folders/${rootFolderId}`, { parentId: deepId });
  assert.equal(cycle.status, 400);
  assert.match(cycle.json.error, /inside itself/i);

  // Moving Payments into itself is also rejected.
  const self = await admin.api('PUT', `/api/folders/${rootFolderId}`, { parentId: rootFolderId });
  assert.equal(self.status, 400);

  // Moving Deep into Payments is valid (Payments is an ancestor, not a child).
  const valid = await admin.api('PUT', `/api/folders/${deepId}`, { parentId: rootFolderId });
  assert.equal(valid.status, 200);
  assert.equal(valid.json.folder.parent_id, rootFolderId);
});

test('renaming and cross-collection parent moves are validated', async () => {
  const renamed = await admin.api('PUT', `/api/folders/${rootFolderId}`, { name: 'Payments V2' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.folder.name, 'Payments V2');

  const empty = await admin.api('PUT', `/api/folders/${rootFolderId}`, { name: '   ' });
  assert.equal(empty.status, 400);

  const otherCol = await admin.api('POST', '/api/collections', { projectId, name: 'Other 2' });
  const otherFolder = await admin.api('POST', '/api/folders', { collectionId: otherCol.json.collection.id, name: 'Elsewhere' });
  const cross = await admin.api('PUT', `/api/folders/${rootFolderId}`, { parentId: otherFolder.json.folder.id });
  assert.equal(cross.status, 400);
  assert.match(cross.json.error, /same collection/i);
});

test('outsiders cannot create folders', async () => {
  const res = await outsider.api('POST', '/api/folders', { collectionId, name: 'Sneaky' });
  assert.equal(res.status, 403);
});

test('export emits folders + folderSourceId, import round-trips them', async () => {
  // Re-place the Refund lookup request inside the root folder for a clean export.
  const moved = await admin.api('PUT', `/api/requests/${requestInFolderId}`, { folderId: rootFolderId });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.request.folder_id, rootFolderId);

  const exported = await admin.api('GET', `/api/collections/${collectionId}/export`);
  assert.equal(exported.status, 200);
  const c = exported.json.collection;
  assert.ok(Array.isArray(c.folders), 'export carries folders array');
  assert.equal(c.folders.length, 3); // Payments V2, Refunds2, Deep
  const payments = c.folders.find((f) => f.name === 'Payments V2');
  assert.ok(payments.sourceId, 'folder has sourceId');
  assert.equal(payments.parentSourceId, null, 'root folder has null parent');
  const deep = c.folders.find((f) => f.name === 'Deep');
  assert.equal(deep.parentSourceId, payments.sourceId, 'nested folder references root sourceId');

  const inFolder = c.requests.find((r) => r.name === 'Refund lookup');
  assert.equal(inFolder.folderSourceId, payments.sourceId, 'request references folder sourceId');
  const atRoot = c.requests.find((r) => r.name === 'Health');
  assert.equal(atRoot.folderSourceId, null, 'root request has no folderSourceId');

  const res = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Folder Import',
    collection: c,
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.collection.name, 'Folder Import');

  const fresh = await admin.api('GET', `/api/collections/${res.json.collection.id}/export`);
  const fc = fresh.json.collection;
  assert.equal(fc.folders.length, 3);
  const fPayments = fc.folders.find((f) => f.name === 'Payments V2');
  const fDeep = fc.folders.find((f) => f.name === 'Deep');
  assert.notEqual(fDeep.parentSourceId, null);
  assert.equal(fDeep.parentSourceId, fPayments.sourceId, 'nesting preserved after import');

  const fReq = fc.requests.find((r) => r.name === 'Refund lookup');
  assert.equal(fReq.folderSourceId, fPayments.sourceId, 'request re-linked into imported folder');
});

test('import rejects folders with missing parents or cycles', async () => {
  const badParent = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Bad Parent',
    collection: {
      format: 'api-hub-collection',
      version: 1,
      name: 'Bad Parent',
      folders: [
        { sourceId: 'a', parentSourceId: 'missing', name: 'Child' },
      ],
      requests: [],
    },
  });
  assert.equal(badParent.status, 400);
  assert.match(badParent.json.error, /missing parent/i);

  const cyclic = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Cyclic',
    collection: {
      format: 'api-hub-collection',
      version: 1,
      name: 'Cyclic',
      folders: [
        { sourceId: 'a', parentSourceId: 'b', name: 'A' },
        { sourceId: 'b', parentSourceId: 'a', name: 'B' },
      ],
      requests: [],
    },
  });
  assert.equal(cyclic.status, 400);
  assert.match(cyclic.json.error, /cycle/i);
});

test('folder delete cascades descendants in the DB', async () => {
  // Rebuild a small tree, then delete the root; both child folders vanish.
  const r = await admin.api('POST', '/api/folders', { collectionId, name: 'Temp' });
  const tempId = r.json.folder.id;
  const c1 = await admin.api('POST', '/api/folders', { collectionId, parentId: tempId, name: 'C1' });
  const c2 = await admin.api('POST', '/api/folders', { collectionId, parentId: c1.json.folder.id, name: 'C2' });

  const del = await admin.api('DELETE', `/api/folders/${tempId}`);
  assert.equal(del.status, 200);

  const gone1 = await admin.api('GET', '/api/workspaces');
  const myWs = gone1.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const ids = new Set(content.json.folders.map((f) => f.id));
  assert.ok(!ids.has(tempId), 'root folder deleted');
  assert.ok(!ids.has(c1.json.folder.id), 'child folder cascaded');
  assert.ok(!ids.has(c2.json.folder.id), 'grandchild folder cascaded');
});
