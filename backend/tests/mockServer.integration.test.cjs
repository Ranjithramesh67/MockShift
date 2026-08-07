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

let admin;
let projectId;

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
  await signup(admin, 'mockadmin@test.io', 'adminpass123', 'Mock Admin');
  projectId = await defaultProjectId(admin);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

test('mock server CRUD + public dispatch', async () => {
  // No mock server yet.
  const empty = await admin.api('GET', `/api/projects/${projectId}/mock-server`);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.mockServer, null);

  // Create one (idempotent upsert on project_id).
  const created = await admin.api('POST', `/api/projects/${projectId}/mock-server`, { name: 'E2E Mock' });
  assert.equal(created.status, 201);
  assert.ok(created.json.mockServer.id, 'has id');
  assert.equal(created.json.mockServer.enabled, true);
  const serverId = created.json.mockServer.id;

  const again = await admin.api('POST', `/api/projects/${projectId}/mock-server`, { name: 'E2E Mock v2' });
  assert.equal(again.status, 201);
  assert.equal(again.json.mockServer.id, serverId, 'same server (upsert)');
  assert.equal(again.json.mockServer.name, 'E2E Mock v2');

  // Routes: static + param.
  const route1 = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'GET',
    path: '/posts',
    status: 200,
    headers: { 'x-mock': 'true' },
    body: JSON.stringify({ ok: true, source: 'mock' }),
    delayMs: 0,
  });
  assert.equal(route1.status, 201, 'create route1');
  const route1Id = route1.json.route.id;

  const route2 = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'GET',
    path: '/users/:id',
    status: 200,
    headers: {},
    body: JSON.stringify({ userId: '{{id}}' }),
  });
  assert.equal(route2.status, 201, 'create route2');
  const route2Id = route2.json.route.id;

  const listRoutes = await admin.api('GET', `/api/mock-servers/${serverId}/routes`);
  assert.equal(listRoutes.status, 200);
  assert.equal(listRoutes.json.routes.length, 2);

  // Dispatch: static route (no auth required).
  const postsRes = await fetch(`${base}/mock/${projectId}/posts`);
  assert.equal(postsRes.status, 200);
  assert.equal(postsRes.headers.get('x-mock'), 'true');
  const postsBody = await postsRes.json();
  assert.deepEqual(postsBody, { ok: true, source: 'mock' });

  // Dispatch: param route substitutes {{id}}.
  const userRes = await fetch(`${base}/mock/${projectId}/users/42`);
  assert.equal(userRes.status, 200);
  const userBody = await userRes.json();
  assert.deepEqual(userBody, { userId: '42' });

  // Dispatch: method mismatch / no route -> 404.
  const postRes = await fetch(`${base}/mock/${projectId}/posts`, { method: 'POST' });
  assert.equal(postRes.status, 404);
  const missingRes = await fetch(`${base}/mock/${projectId}/nope`);
  assert.equal(missingRes.status, 404);

  // Update route.
  const updated = await admin.api('PATCH', `/api/mock-routes/${route1Id}`, { status: 201, body: JSON.stringify({ ok: true, created: true }) });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.route.status, 201);

  // Disable the server -> dispatch 404.
  const disabled = await admin.api('PATCH', `/api/mock-servers/${serverId}`, { enabled: false });
  assert.equal(disabled.status, 200);
  const disabledRes = await fetch(`${base}/mock/${projectId}/posts`);
  assert.equal(disabledRes.status, 404);

  await admin.api('PATCH', `/api/mock-servers/${serverId}`, { enabled: true });

  // Delete a route, then the server.
  const delRoute = await admin.api('DELETE', `/api/mock-routes/${route2Id}`);
  assert.equal(delRoute.status, 200);
  const delServer = await admin.api('DELETE', `/api/mock-servers/${serverId}`);
  assert.equal(delServer.status, 200);
  const goneRes = await fetch(`${base}/mock/${projectId}/posts`);
  assert.equal(goneRes.status, 404);
});

test('mock server access is project-scoped', async () => {
  const dev = makeClient();
  await signup(dev, 'mockdev@test.io', 'devpass123', 'Mock Dev');

  // Dev has no access to admin's Default Project -> cannot create a mock server.
  const createAsDev = await dev.api('POST', `/api/projects/${projectId}/mock-server`, { name: 'nope' });
  assert.equal(createAsDev.status, 403);

  // Dev can create for their own workspace/project.
  const devProjectId = await defaultProjectId(dev);
  const created = await dev.api('POST', `/api/projects/${devProjectId}/mock-server`, { name: 'Dev Mock' });
  assert.equal(created.status, 201);

  // Dev cannot read admin's server.
  const readAdmin = await dev.api('GET', `/api/projects/${projectId}/mock-server`);
  assert.equal(readAdmin.status, 403);
});

test('mock server validation rejects bad input', async () => {
  const created = await admin.api('POST', `/api/projects/${projectId}/mock-server`, { name: 'Val Mock' });
  const serverId = created.json.mockServer.id;

  const badMethod = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'BREW',
    path: '/x',
  });
  assert.equal(badMethod.status, 400);

  const badPath = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'GET',
    path: 'nope',
  });
  assert.equal(badPath.status, 400);

  const badStatus = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'GET',
    path: '/x',
    status: 42,
  });
  assert.equal(badStatus.status, 400);

  const badHeaders = await admin.api('POST', `/api/mock-servers/${serverId}/routes`, {
    method: 'GET',
    path: '/x',
    headers: ['a', 'b'],
  });
  assert.equal(badHeaders.status, 400);
});
