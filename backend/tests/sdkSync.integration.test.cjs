'use strict';

// Round 5 — apihub-sdk route sync integration test.
// Boots a minimal app with auth + tokens + sdk routers, creates a bound token,
// and exercises idempotent sync (create then update, no duplicates).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DBNAME = process.env.INTEGRATION_PGDATABASE || 'apihub_sdk_test';
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: DBNAME,
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-c', sql], {
    env: PGENV, stdio: 'pipe', encoding: 'utf8',
  });
}
function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-f', file], {
    env: PGENV, stdio: 'pipe', encoding: 'utf8',
  });
}

let server;
let base;
let admin;
let apiKey;
let projectId;
let workspaceId;

function makeClient() {
  let cookie = '';
  async function api(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
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
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  }
  return { api };
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = DBNAME;
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const express = require('express');
  server = await new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api/auth', require('../src/api/routes/auth'));
    app.use('/api/workspaces', require('../src/api/routes/workspaces'));
    app.use('/api', require('../src/api/routes/content'));
    app.use('/api/tokens', require('../src/api/routes/tokens'));
    app.use('/api/sdk', require('../src/api/routes/sdk'));
    app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message || 'Internal server error' }));
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'sdkadmin@test.io', password: 'adminpass123', name: 'SDK Admin',
  });
  assert.equal(signup.status, 201);
  const ws = await admin.api('GET', '/api/workspaces');
  workspaceId = ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
  const content = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  projectId = content.json.projects.find((p) => p.can_access).id;

  const token = await admin.api('POST', '/api/tokens', {
    name: 'SDK key', scopes: ['sdk'], projectId,
  });
  assert.equal(token.status, 201);
  apiKey = token.json.token;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

const MANIFEST = {
  source: 'express',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  folders: [
    { key: 'Users', name: 'Users', parent: null },
    { key: 'Users/Admin', name: 'Admin', parent: 'Users' },
  ],
  requests: [
    { key: 'GET /health', name: 'Health', method: 'GET', path: '/health' },
    { key: 'GET /users/:id', name: 'Get user', method: 'GET', path: '/users/:id', folder: 'Users' },
    {
      key: 'DELETE /users/:id', name: 'Delete user', method: 'DELETE', path: '/users/:id',
      folder: 'Users/Admin', assertions: [{ id: 'a1', type: 'status', operator: 'eq', expected: '204' }],
    },
  ],
};

function syncRequest(body) {
  return admin.api('POST', '/api/sdk/sync', body, { Authorization: `Bearer ${apiKey}` });
}

test('sync rejects missing Bearer token', async () => {
  const res = await admin.api('POST', '/api/sdk/sync', MANIFEST);
  assert.equal(res.status, 401);
});

test('sync creates a collection, nested folders and requests', async () => {
  const res = await syncRequest(MANIFEST);
  assert.equal(res.status, 201);
  assert.equal(res.json.summary.requests.created, 3);
  assert.equal(res.json.summary.folders.created, 2);
  assert.equal(res.json.collectionId, res.json.summary.collectionId);

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collections = tree.json.collections.filter((c) => c.project_id === projectId && c.name === 'Backend');
  assert.equal(collections.length, 1);
  const folderNames = tree.json.folders.filter((f) => f.collection_id === collections[0].id).map((f) => f.name).sort();
  assert.deepEqual(folderNames, ['Admin', 'Users']);
  const reqs = tree.json.requests.filter((r) => r.collection_id === collections[0].id);
  assert.equal(reqs.length, 3);
});

test('re-sync updates in place without duplicating', async () => {
  const updated = JSON.parse(JSON.stringify(MANIFEST));
  updated.requests[0].name = 'Health probe';
  const res = await syncRequest(updated);
  assert.equal(res.status, 201);
  assert.equal(res.json.summary.requests.created, 0);
  assert.equal(res.json.summary.requests.updated, 3);
  assert.equal(res.json.summary.folders.created, 0);

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collections = tree.json.collections.filter((c) => c.project_id === projectId && c.name === 'Backend');
  const reqs = tree.json.requests.filter((r) => r.collection_id === collections[0].id);
  assert.equal(reqs.length, 3);
  assert.ok(reqs.some((r) => r.name === 'Health probe'));
});

test('assertions and target URL are persisted', async () => {
  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collection = tree.json.collections.find((c) => c.project_id === projectId && c.name === 'Backend');
  const req = tree.json.requests.find((r) => r.collection_id === collection.id && r.name === 'Health probe');
  const detail = await admin.api('GET', `/api/requests/${req.id}`);
  assert.equal(detail.json.request.url, 'http://localhost:4000/health');
  const del = tree.json.requests.find((r) => r.collection_id === collection.id && r.method === 'DELETE');
  const delDetail = await admin.api('GET', `/api/requests/${del.id}`);
  assert.equal(delDetail.json.request.assertions.length, 1);
  assert.equal(delDetail.json.request.assertions[0].expected, '204');
});

test('a project-bound key cannot sync into another project', async () => {
  const other = await admin.api('POST', '/api/workspaces', { name: `Other ${Date.now()}` });
  const otherProject = (await admin.api('GET', `/api/workspaces/${other.json.workspace.id}/content`)).json.projects[0].id;
  const res = await syncRequest({ ...MANIFEST, collection: 'Elsewhere', projectId: otherProject });
  // Binding wins: content still lands in the bound project, not otherProject.
  assert.equal(res.status, 201);
  const tree = await admin.api('GET', `/api/workspaces/${other.json.workspace.id}/content`);
  assert.equal(tree.json.collections.length, 0);
});

test('token create validates and returns project binding', async () => {
  const bad = await admin.api('POST', '/api/tokens', {
    name: 'Bad binding', scopes: ['sdk'], projectId: 'not-a-uuid',
  });
  assert.equal(bad.status, 400);

  const blank = await admin.api('POST', '/api/tokens', { name: 'Blank', scopes: ['sdk'], projectId: '   ' });
  assert.equal(blank.status, 400);

  const both = await admin.api('POST', '/api/tokens', {
    name: 'Both', scopes: ['sdk'], projectId, workspaceId,
  });
  assert.equal(both.status, 400);

  const listed = await admin.api('GET', '/api/tokens');
  const key = listed.json.tokens.find((t) => t.name === 'SDK key');
  assert.equal(key.projectId, projectId);
  assert.equal(key.workspaceId, null);
  assert.ok(key.scopes.includes('sdk'));
});

test('a key without the sdk/write scope cannot sync', async () => {
  const readToken = await admin.api('POST', '/api/tokens', { name: 'Read only', scopes: ['read'], projectId });
  const res = await admin.api('POST', '/api/sdk/sync', MANIFEST, {
    Authorization: `Bearer ${readToken.json.token}`,
  });
  assert.equal(res.status, 403);
});
