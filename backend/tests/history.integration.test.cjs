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

  const admin = makeClient();
  const adminSignup = await admin.api('POST', '/api/auth/signup', {
    email: 'histadmin@test.io',
    password: 'adminpass123',
    name: 'History Admin',
  });
  assert.equal(adminSignup.status, 201, 'admin signup');
  const dev = makeClient();
  const devSignup = await dev.api('POST', '/api/auth/signup', {
    email: 'histdev@test.io',
    password: 'devpass123',
    name: 'History Dev',
  });
  assert.equal(devSignup.status, 201, 'dev signup');
  globalThis.__adminClient = admin;
  globalThis.__devClient = dev;
  globalThis.__mockBase = `http://127.0.0.1:${mockPort}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  await require('../src/api/db').pool.end();
});

async function createRunnableRequest(client, name, mockBase) {
  const ws = await client.api('GET', '/api/workspaces');
  assert.equal(ws.status, 200);
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(myWs, 'found My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  assert.equal(content.status, 200);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  const col = await client.api('POST', '/api/collections', { projectId: project.id, name: `${name} col` });
  assert.equal(col.status, 201, 'create collection');
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name,
    method: 'GET',
    url: `${mockBase}/history-check`,
  });
  assert.equal(req.status, 201, 'create request');
  const run = await client.api('POST', `/api/requests/${req.json.request.id}/run`);
  assert.equal(run.status, 200, 'run request');
  assert.ok(run.json.runId, 'run produced an id');
  return { requestId: req.json.request.id, runId: run.json.runId };
}

test('each user only ever sees their own run history', async () => {
  const admin = globalThis.__adminClient;
  const dev = globalThis.__devClient;
  const mockBase = globalThis.__mockBase;

  const adminRun = await createRunnableRequest(admin, 'admin-run', mockBase);
  const devRun = await createRunnableRequest(dev, 'dev-run', mockBase);

  const adminHistory = await admin.api('GET', '/api/history');
  assert.equal(adminHistory.status, 200);
  assert.ok(
    adminHistory.json.runs.some((r) => r.name === 'admin-run'),
    'admin sees their own run'
  );
  assert.ok(
    !adminHistory.json.runs.some((r) => r.name === 'dev-run'),
    'admin does NOT see dev run'
  );

  const devHistory = await dev.api('GET', '/api/history');
  assert.equal(devHistory.status, 200);
  assert.ok(
    devHistory.json.runs.some((r) => r.name === 'dev-run'),
    'dev sees their own run'
  );
  assert.ok(
    !devHistory.json.runs.some((r) => r.name === 'admin-run'),
    'dev does NOT see admin run'
  );

  // A user can fetch the detail of their own run (snapshots present)…
  const ownDetail = await admin.api('GET', `/api/history/${adminRun.runId}`);
  assert.equal(ownDetail.status, 200);
  assert.equal(ownDetail.json.run.request_snapshot.method, 'GET');
  assert.match(ownDetail.json.run.request_snapshot.url, /\/history-check$/);
  assert.equal(ownDetail.json.run.response_snapshot.status, 200);
  assert.equal(ownDetail.json.run.status, 'SUCCESS');

  // …but never another user's run detail.
  const cross1 = await admin.api('GET', `/api/history/${devRun.runId}`);
  assert.equal(cross1.status, 404, 'admin cannot read dev run detail');
  const cross2 = await dev.api('GET', `/api/history/${adminRun.runId}`);
  assert.equal(cross2.status, 404, 'dev cannot read admin run detail');
});

test('run history requires authentication', async () => {
  const anonymous = makeClient();
  const res = await anonymous.api('GET', '/api/history');
  assert.equal(res.status, 401);
});
