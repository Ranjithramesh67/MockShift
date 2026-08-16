'use strict';

// Integration tests for the duplicate endpoints POST /api/requests/:requestId/duplicate
// and POST /api/folders/:folderId/duplicate: a request is deep-copied into its
// folder with all editor state verbatim, and a folder is deep-copied together
// with its whole subtree (nested folders + contained requests), re-parenting
// the copies to the NEW copied folder ids.

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
  assert.equal(copy.name, 'Get Users', 'same name');
  assert.equal(copy.method, 'GET', 'same method');
  assert.equal(copy.url, 'https://api.example.com/users', 'same url');
  assert.equal(copy.api_type, 'REST', 'same api_type');
  assert.equal(copy.collection_id, collectionId, 'same collection');
  assert.equal(copy.folder_id, folderId, 'same folder');

  const afterCount = Number(
    psqlScalar(`SELECT count(*) FROM api_requests WHERE folder_id = '${folderId}'`)
  );
  assert.equal(afterCount, beforeCount + 1, 'request count in folder incremented by one');
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

  const newRoot = dup.json.folders.find((f) => f.name === 'Root Dir');
  assert.ok(newRoot, 'new root folder present');
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
