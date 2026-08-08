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
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Demo-Header': 'demo-value',
    });
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

  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'shareadmin@test.io',
    password: 'adminpass123',
    name: 'Share Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__adminClient = admin;
  globalThis.__mockBase = `http://127.0.0.1:${mockPort}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  await require('../src/api/db').pool.end();
});

async function createRequestWithRun(client, mockBase, name, urlPath) {
  const ws = await client.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  const col = await client.api('POST', '/api/collections', { projectId: project.id, name: `${name} col` });
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name,
    method: 'GET',
    url: `${mockBase}${urlPath}`,
  });
  assert.equal(req.status, 201, 'create request');
  await client.api('PUT', `/api/requests/${req.json.request.id}`, {
    headers: [
      { key: 'X-Demo', value: 'hello', enabled: true },
      { key: 'Authorization', value: 'Bearer super-secret-token', enabled: true },
    ],
  });
  const run = await client.api('POST', `/api/requests/${req.json.request.id}/run`);
  assert.equal(run.status, 200, 'run request');
  return { requestId: req.json.request.id, runId: run.json.runId };
}

test('create, read publicly (redacted), and revoke a share link', async () => {
  const admin = globalThis.__adminClient;
  const mockBase = globalThis.__mockBase;
  const { requestId } = await createRequestWithRun(admin, mockBase, 'Shareable', '/share-check');

  // Anonymous client has no session cookie.
  const anon = makeClient();

  // Create the share (idempotent).
  const created = await admin.api('POST', `/api/requests/${requestId}/share`);
  assert.equal(created.status, 201);
  assert.ok(created.json.share.token, 'has a token');
  const token = created.json.share.token;

  const again = await admin.api('POST', `/api/requests/${requestId}/share`);
  assert.equal(again.status, 201);
  assert.equal(again.json.share.token, token, 'idempotent per request');

  // Read it WITHOUT authentication.
  const read = await anon.api('GET', `/api/shares/${token}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.share.request.name, 'Shareable');
  assert.equal(read.json.share.request.method, 'GET');
  assert.ok(read.json.share.request.url.includes('/share-check'));
  // Sensitive header value redacted on the public view.
  const authHeader = read.json.share.request.headers.find((h) => h.key === 'Authorization');
  assert.equal(authHeader.value, '••••••••');
  const demoHeader = read.json.share.request.headers.find((h) => h.key === 'X-Demo');
  assert.equal(demoHeader.value, 'hello');
  // Last run response present.
  assert.equal(read.json.share.lastRun.status, 200);
  assert.ok(read.json.share.lastRun.durationMs !== undefined);
  assert.equal(read.json.share.lastRun.bodyEncoding, 'text');

  // Bad token -> 404.
  const missing = await anon.api('GET', '/api/shares/00000000-0000-0000-0000-000000000000');
  assert.equal(missing.status, 404);

  // Revoke.
  const revoked = await admin.api('DELETE', `/api/shares/${token}`);
  assert.equal(revoked.status, 200);
  const afterRevoke = await anon.api('GET', `/api/shares/${token}`);
  assert.equal(afterRevoke.status, 404);
});

test('non-editor cannot create a share link', async () => {
  const admin = globalThis.__adminClient;
  const mockBase = globalThis.__mockBase;
  const dev = makeClient();
  const signup = await dev.api('POST', '/api/auth/signup', {
    email: 'sharedev@test.io',
    password: 'devpass123',
    name: 'Share Dev',
  });
  assert.equal(signup.status, 201);

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  const col = await admin.api('POST', '/api/collections', { projectId: project.id, name: 'Private col' });
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Private',
    method: 'GET',
    url: `${mockBase}/private`,
  });

  const denied = await dev.api('POST', `/api/requests/${req.json.request.id}/share`);
  assert.equal(denied.status, 403);
});
