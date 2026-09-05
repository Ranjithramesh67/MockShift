'use strict';

// Integration tests for the duplicate endpoints POST /api/requests/:requestId/duplicate
// and POST /api/folders/:folderId/duplicate: a request is deep-copied into its
// folder with all editor state verbatim, and a folder is deep-copied together
// with its whole subtree (nested folders + contained requests), re-parenting
// the copies to the NEW copied folder ids. Copies never keep the source name:
// sibling names are auto-uniquified ("X (copy)", "X (copy) 2", ...) for
// requests within a folder and folders within a parent, case-insensitively.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

function psqlScalar(sql) {
  const out = execFileSync(
    'psql',
    ['-t', '-A', '-c', sql],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
  return out.trim();
}

let server;
let base;
let mockUpstream;
let projectId;
let admin;
let collectionId;

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
  return { api };
}

before(async () => {
  psqlReset();
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-f', path.join(ROOT, 'db', 'migrations', file)], {
      env: PGENV,
      stdio: 'pipe',
    });
  }

  mockUpstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, method: req.method, echoed: true }));
  });
  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));

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
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'dupadmin@test.io',
    password: 'adminpass123',
    name: 'Dup Admin',
  });
  assert.equal(signup.status, 201, 'admin signup');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  projectId = content.json.projects.find((p) => p.name === 'Default Project').id;

  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Dup Col' });
  assert.equal(col.status, 201, 'create collection');
  collectionId = col.json.collection.id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  const { shutdownWorkflows } = require('../src/api/workflowService');
  await shutdownWorkflows();
  await require('../src/api/db').pool.end();
});

test('duplicate a request copies it into the same folder with verbatim state', async () => {
  const folder = await admin.api('POST', '/api/folders', { collectionId, name: 'Req Folder' });
  assert.equal(folder.status, 201, 'create folder');
  const folderId = folder.json.folder.id;

  const req = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Get Users',
    method: 'GET',
    url: 'https://api.example.com/users',
    apiType: 'REST',
    folderId,
  });
  assert.equal(req.status, 201, 'create request');
  const requestId = req.json.request.id;

  const beforeCount = Number(
    psqlScalar(`SELECT count(*) FROM api_requests WHERE folder_id = '${folderId}'`)
  );

  const dup = await admin.api('POST', `/api/requests/${requestId}/duplicate`);
  assert.equal(dup.status, 201, 'duplicate request');
  const copy = dup.json.request;
  assert.notEqual(copy.id, requestId, 'new id differs');
  assert.equal(copy.name, 'Get Users (copy)', 'copy gets the (copy) suffix');
  assert.equal(copy.method, 'GET', 'same method');
  assert.equal(copy.url, 'https://api.example.com/users', 'same url');
  assert.equal(copy.api_type, 'REST', 'same api_type');
  assert.equal(copy.collection_id, collectionId, 'same collection');
  assert.equal(copy.folder_id, folderId, 'same folder');

  // A second duplicate bumps the suffix instead of duplicating the name.
  const dup2 = await admin.api('POST', `/api/requests/${requestId}/duplicate`);
  assert.equal(dup2.status, 201, 'duplicate request again');
  assert.equal(dup2.json.request.name, 'Get Users (copy) 2', 'second copy increments the suffix');

  const afterCount = Number(
    psqlScalar(`SELECT count(*) FROM api_requests WHERE folder_id = '${folderId}'`)
  );
  assert.equal(afterCount, beforeCount + 2, 'request count in folder incremented by two');
});

test('duplicate a folder copies its whole subtree and re-parents copies', async () => {
  const root = await admin.api('POST', '/api/folders', { collectionId, name: 'Root Dir' });
  assert.equal(root.status, 201, 'create root folder');
  const rootId = root.json.folder.id;

  const child = await admin.api('POST', '/api/folders', {
    collectionId,
    name: 'Child Dir',
    parentId: rootId,
  });
  assert.equal(child.status, 201, 'create child folder');
  const childId = child.json.folder.id;

  const req = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Nested Req',
    method: 'POST',
    url: 'https://api.example.com/nested',
    apiType: 'REST',
    folderId: childId,
  });
  assert.equal(req.status, 201, 'create nested request');

  const dup = await admin.api('POST', `/api/folders/${rootId}/duplicate`);
  assert.equal(dup.status, 201, 'duplicate folder');
  assert.equal(dup.json.folders.length, 2, 'root + child folders copied');
  assert.equal(dup.json.requests.length, 1, 'one request copied');

  const newRoot = dup.json.folders.find((f) => f.name === 'Root Dir (copy)');
  assert.ok(newRoot, 'new root folder present with (copy) suffix');
  assert.notEqual(newRoot.id, rootId, 'new root id differs');
  assert.equal(newRoot.collection_id, collectionId, 'new root same collection');
  assert.equal(newRoot.parent_id, null, 'new root parent equals source root parent (null)');

  const newChild = dup.json.folders.find((f) => f.name === 'Child Dir');
  assert.ok(newChild, 'new child folder present');
  assert.notEqual(newChild.id, childId, 'new child id differs');
  assert.equal(newChild.parent_id, newRoot.id, 'child re-parented to the new root copy');

  const copy = dup.json.requests[0];
  assert.equal(copy.name, 'Nested Req', 'same name');
  assert.equal(copy.method, 'POST', 'same method');
  assert.equal(copy.collection_id, collectionId, 'same collection');
  assert.equal(copy.folder_id, newChild.id, 'copied request points at the NEW copied child folder');

  // A second folder duplicate increments the root suffix; interior folders keep
  // their names because they live under a fresh parent scope.
  const dup2 = await admin.api('POST', `/api/folders/${rootId}/duplicate`);
  assert.equal(dup2.status, 201, 'duplicate folder again');
  const newRoot2 = dup2.json.folders.find((f) => f.name === 'Root Dir (copy) 2');
  assert.ok(newRoot2, 'second folder copy increments the suffix');
  assert.equal(newRoot2.parent_id, null, 'second root copy at collection root');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  assert.equal(content.status, 200, 'content tree loaded');
  assert.ok(content.json.folders.some((f) => f.id === newRoot.id), 'tree shows new root');
  assert.ok(content.json.folders.some((f) => f.id === newChild.id), 'tree shows new child');
  assert.ok(content.json.requests.some((r) => r.id === copy.id), 'tree shows copied request');
});

test('duplicate request without write access returns 403', async () => {
  const stranger = makeClient();
  const signup = await stranger.api('POST', '/api/auth/signup', {
    email: 'dupstranger@test.io',
    password: 'strangerpass123',
    name: 'Dup Stranger',
  });
  assert.equal(signup.status, 201, 'stranger signup');

  const req = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Private Req',
    method: 'GET',
    url: 'https://api.example.com/private',
  });
  assert.equal(req.status, 201, 'create private request');
  const requestId = req.json.request.id;

  const res = await stranger.api('POST', `/api/requests/${requestId}/duplicate`);
  assert.equal(res.status, 403);
  assert.match(res.json.error, /Editor, manager or admin access required/);
});

test('create, rename and move auto-uniquify sibling request and folder names', async () => {
  // Folders at the same level: "Scope A", "scope a" (case-insensitive) and a
  // third "Scope A" all auto-uniquify against each other.
  const a1 = await admin.api('POST', '/api/folders', { collectionId, name: 'Scope A' });
  assert.equal(a1.status, 201, 'create first folder');
  assert.equal(a1.json.folder.name, 'Scope A');

  const a2 = await admin.api('POST', '/api/folders', { collectionId, name: 'scope a' });
  assert.equal(a2.status, 201, 'case-only collision');
  assert.equal(a2.json.folder.name, 'scope a (copy)', 'case-insensitive (copy) suffix');

  const a3 = await admin.api('POST', '/api/folders', { collectionId, name: 'Scope A' });
  assert.equal(a3.status, 201, 'third same-name folder');
  assert.equal(a3.json.folder.name, 'Scope A (copy) 2', 'numbered suffix after (copy) is taken');

  // Sub-folder names are scoped to their own parent.
  const sub1 = await admin.api('POST', '/api/folders', { collectionId, name: 'Sub X', parentId: a1.json.folder.id });
  assert.equal(sub1.status, 201);
  const sub2 = await admin.api('POST', '/api/folders', { collectionId, name: 'Sub X', parentId: a1.json.folder.id });
  assert.equal(sub2.status, 201);
  assert.equal(sub2.json.folder.name, 'Sub X (copy)', 'two sub-folders in one folder cannot share a name');
  const subOther = await admin.api('POST', '/api/folders', { collectionId, name: 'Sub X', parentId: a2.json.folder.id });
  assert.equal(subOther.status, 201, 'same sub-folder name under a DIFFERENT parent is allowed');
  assert.equal(subOther.json.folder.name, 'Sub X');

  // Requests collide only inside their own folder.
  const r1 = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Ping', method: 'GET', url: 'https://api.example.com/ping', folderId: a1.json.folder.id,
  });
  assert.equal(r1.status, 201);
  const r2 = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Ping', method: 'GET', url: 'https://api.example.com/ping', folderId: a1.json.folder.id,
  });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.request.name, 'Ping (copy)', 'request sibling name auto-uniquified');
  const rOther = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Ping', method: 'GET', url: 'https://api.example.com/ping', folderId: sub1.json.folder.id,
  });
  assert.equal(rOther.status, 201);
  assert.equal(rOther.json.request.name, 'Ping', 'same request name allowed in another folder');

  // Renaming onto a taken sibling name bumps to a (copy) suffix.
  const house = await admin.api('POST', '/api/folders', { collectionId, name: 'Rename House' });
  assert.equal(house.status, 201);
  const housePing = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Ping', method: 'GET', url: 'https://api.example.com/ping', folderId: house.json.folder.id,
  });
  assert.equal(housePing.status, 201);
  const houseTarget = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Target', method: 'GET', url: 'https://api.example.com/target', folderId: house.json.folder.id,
  });
  assert.equal(houseTarget.status, 201);
  const rename = await admin.api('PUT', `/api/requests/${housePing.json.request.id}`, { name: 'Target' });
  assert.equal(rename.status, 200);
  assert.equal(rename.json.request.name, 'Target (copy)', 'rename into a taken name auto-uniquifies');

  // Moving a request into a folder that has a same-named sibling renames it.
  const dest = await admin.api('POST', '/api/folders', { collectionId, name: 'Move Dest' });
  assert.equal(dest.status, 201);
  const destReq = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Cargo', method: 'GET', url: 'https://api.example.com/cargo', folderId: dest.json.folder.id,
  });
  assert.equal(destReq.status, 201);
  const cargo = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Cargo', method: 'GET', url: 'https://api.example.com/cargo', folderId: sub1.json.folder.id,
  });
  assert.equal(cargo.status, 201);
  const moved = await admin.api('PUT', `/api/requests/${cargo.json.request.id}`, { folderId: dest.json.folder.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.request.name, 'Cargo (copy)', 'moving onto a taken sibling name renames the move');

  // Moving a folder under a parent whose child has the same name renames it.
  const bucket = await admin.api('POST', '/api/folders', { collectionId, name: 'Dup Bucket' });
  assert.equal(bucket.status, 201);
  const existingLeaf = await admin.api('POST', '/api/folders', { collectionId, name: 'Same Leaf', parentId: bucket.json.folder.id });
  assert.equal(existingLeaf.status, 201);
  const carry = await admin.api('POST', '/api/folders', { collectionId, name: 'Same Leaf', parentId: dest.json.folder.id });
  assert.equal(carry.status, 201);
  const movedFolder = await admin.api('PUT', `/api/folders/${carry.json.folder.id}`, { parentId: bucket.json.folder.id });
  assert.equal(movedFolder.status, 200);
  assert.equal(movedFolder.json.folder.name, 'Same Leaf (copy)', 'moving a folder onto a taken sibling name renames it');

  // Root-level request duplicates bump the numeric suffix.
  const rootReq = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Root One', method: 'GET', url: 'https://api.example.com/root',
  });
  assert.equal(rootReq.status, 201);
  const rootCopy = await admin.api('POST', `/api/requests/${rootReq.json.request.id}/duplicate`);
  assert.equal(rootCopy.status, 201);
  assert.equal(rootCopy.json.request.name, 'Root One (copy)');
  const rootCopy2 = await admin.api('POST', `/api/requests/${rootReq.json.request.id}/duplicate`);
  assert.equal(rootCopy2.status, 201);
  assert.equal(rootCopy2.json.request.name, 'Root One (copy) 2');
});
