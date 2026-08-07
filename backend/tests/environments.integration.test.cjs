'use strict';

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

let server;
let base;
let mockUpstream;

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
    res.end(JSON.stringify({ url: req.url, echoed: true }));
  });
  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));
  const mockPort = mockUpstream.address().port;

  process.env.PGDATABASE = 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // Seed: sign up an admin, then point BASE_URL at the in-test mock upstream.
  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', { email: 'envadmin@test.io', password: 'adminpass123', name: 'Env Admin' });
  assert.equal(signup.status, 201);
  globalThis.__adminClient = admin;
  globalThis.__mockBase = `http://127.0.0.1:${mockPort}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  await require('../src/api/db').pool.end();
});

async function createWorkspace(client, name) {
  const res = await client.api('POST', '/api/workspaces', { name });
  assert.equal(res.status, 201, `create workspace ${name}: ${JSON.stringify(res.json)}`);
  return res.json.workspace.id;
}

test('environments CRUD and active switching', async () => {
  const admin = globalThis.__adminClient;
  const workspaceId = await createWorkspace(admin, 'Env Workspace');

  const listEmpty = await admin.api('GET', `/api/workspaces/${workspaceId}/environments`);
  assert.equal(listEmpty.status, 200);
  assert.deepEqual(listEmpty.json.environments, []);

  const staging = await admin.api('POST', `/api/workspaces/${workspaceId}/environments`, { name: 'Staging', makeActive: true });
  assert.equal(staging.status, 201);
  assert.equal(staging.json.environment.is_active, true);
  const stagingId = staging.json.environment.id;

  const prod = await admin.api('POST', `/api/workspaces/${workspaceId}/environments`, { name: 'Prod' });
  assert.equal(prod.status, 201);
  assert.equal(prod.json.environment.is_active, false);
  const prodId = prod.json.environment.id;

  // Only one active at a time.
  const activate = await admin.api('PATCH', `/api/environments/${prodId}`, { isActive: true });
  assert.equal(activate.status, 200);
  assert.equal(activate.json.environment.is_active, true);

  const list = await admin.api('GET', `/api/workspaces/${workspaceId}/environments`);
  const byName = Object.fromEntries(list.json.environments.map((e) => [e.name, e.is_active]));
  assert.deepEqual(byName, { Staging: false, Prod: true });

  // Rename.
  const rename = await admin.api('PATCH', `/api/environments/${prodId}`, { name: 'Production' });
  assert.equal(rename.status, 200);
  assert.equal(rename.json.environment.name, 'Production');

  // Delete.
  const del = await admin.api('DELETE', `/api/environments/${stagingId}`);
  assert.equal(del.status, 200);
  const afterDelete = await admin.api('GET', `/api/workspaces/${workspaceId}/environments`);
  assert.equal(afterDelete.json.environments.length, 1);
  assert.equal(afterDelete.json.environments[0].name, 'Production');

  globalThis.__envWorkspaceId = workspaceId;
  globalThis.__envProdId = prodId;
});

test('environment variables: plaintext and secrets round-trip', async () => {
  const admin = globalThis.__adminClient;
  const prodId = globalThis.__envProdId;
  const mockBase = globalThis.__mockBase;

  const plain = await admin.api('POST', `/api/environments/${prodId}/variables`, {
    key: 'BASE_URL',
    value: mockBase,
    isSecret: false,
  });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.variable.value, mockBase);

  const secret = await admin.api('POST', `/api/environments/${prodId}/variables`, {
    key: 'API_TOKEN',
    value: 's3cr3t-tok',
    isSecret: true,
  });
  assert.equal(secret.status, 201);
  assert.equal(secret.json.variable.is_secret, true);

  // The owner can read the decrypted secret back.
  const list = await admin.api('GET', `/api/environments/${prodId}/variables`);
  assert.equal(list.status, 200);
  const byKey = Object.fromEntries(list.json.variables.map((v) => [v.key, v]));
  assert.equal(byKey.BASE_URL.value, mockBase);
  assert.equal(byKey.API_TOKEN.value, 's3cr3t-tok');
  assert.equal(byKey.API_TOKEN.is_secret, true);

  // Upsert by key (same key, new value) instead of duplicating.
  const upsert = await admin.api('POST', `/api/environments/${prodId}/variables`, {
    key: 'BASE_URL',
    value: `${mockBase}/v2`,
    isSecret: false,
  });
  assert.equal(upsert.status, 201);
  const afterUpsert = await admin.api('GET', `/api/environments/${prodId}/variables`);
  assert.equal(afterUpsert.json.variables.filter((v) => v.key === 'BASE_URL').length, 1);
  assert.equal(afterUpsert.json.variables.find((v) => v.key === 'BASE_URL').value, `${mockBase}/v2`);

  const del = await admin.api('DELETE', `/api/environments/${prodId}/variables/${byKey.API_TOKEN.id}`);
  assert.equal(del.status, 200);
  const afterDel = await admin.api('GET', `/api/environments/${prodId}/variables`);
  assert.ok(!afterDel.json.variables.some((v) => v.key === 'API_TOKEN'));
});

test('{{var}} substitution in a request uses the ACTIVE environment', async () => {
  const admin = globalThis.__adminClient;
  const workspaceId = globalThis.__envWorkspaceId;
  const mockBase = globalThis.__mockBase;

  // Ensure BASE_URL in the active (Prod/Production) env points at the mock.
  const prodId = globalThis.__envProdId;
  await admin.api('POST', `/api/environments/${prodId}/variables`, { key: 'BASE_URL', value: mockBase, isSecret: false });

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Env Collection' });
  const collectionId = col.json.collection.id;

  const req = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Env URL',
    method: 'GET',
    url: '{{BASE_URL}}/posts?limit=5',
  });
  const requestId = req.json.request.id;

  const run = await admin.api('POST', `/api/requests/${requestId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');
  assert.equal(run.json.httpStatus, 200);
  assert.equal(run.json.requestSnapshot.url, `${mockBase}/posts?limit=5`);
});

test('non-editor cannot mutate environments', async () => {
  const viewer = makeClient();
  const signup = await viewer.api('POST', '/api/auth/signup', { email: 'envviewer@test.io', password: 'viewerpass123', name: 'Viewer' });
  assert.equal(signup.status, 201);

  const admin = globalThis.__adminClient;
  const workspaceId = globalThis.__envWorkspaceId;
  const prodId = globalThis.__envProdId;

  // Share the workspace so the viewer can read, as a VIEWER.
  const team = await admin.api('POST', '/api/teams', { name: 'Env Viewers' });
  const teamId = team.json.team.id;
  const invite = await admin.api('POST', `/api/teams/${teamId}/members`, { email: 'envviewer@test.io', role: 'VIEWER' });
  assert.equal(invite.status, 201);
  await admin.api('POST', `/api/workspaces/${workspaceId}/teams`, { teamId, role: 'VIEWER' });

  // Viewer can list environments and variables...
  const list = await viewer.api('GET', `/api/workspaces/${workspaceId}/environments`);
  assert.equal(list.status, 200);
  const vars = await viewer.api('GET', `/api/environments/${prodId}/variables`);
  assert.equal(vars.status, 200);

  // ...but cannot create, activate, or write variables.
  const create = await viewer.api('POST', `/api/workspaces/${workspaceId}/environments`, { name: 'Hijack' });
  assert.equal(create.status, 403);
  const activate = await viewer.api('PATCH', `/api/environments/${prodId}`, { isActive: true });
  assert.equal(activate.status, 403);
  const writeVar = await viewer.api('POST', `/api/environments/${prodId}/variables`, { key: 'X', value: 'y', isSecret: false });
  assert.equal(writeVar.status, 403);
});
