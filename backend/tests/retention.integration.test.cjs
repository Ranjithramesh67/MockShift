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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    email: 'retadmin@test.io',
    password: 'adminpass123',
    name: 'Retention Admin',
  });
  assert.equal(adminSignup.status, 201, 'admin signup');
  const dev = makeClient();
  const devSignup = await dev.api('POST', '/api/auth/signup', {
    email: 'retdev@test.io',
    password: 'devpass123',
    name: 'Retention Dev',
  });
  assert.equal(devSignup.status, 201, 'dev signup');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(myWs, 'found My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  const col = await admin.api('POST', '/api/collections', { projectId: project.id, name: 'retention col' });
  assert.equal(col.status, 201, 'create collection');
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'retention-run',
    method: 'GET',
    url: `http://127.0.0.1:${mockPort}/retention-check`,
  });
  assert.equal(req.status, 201, 'create request');
  const run = await admin.api('POST', `/api/requests/${req.json.request.id}/run`);
  assert.equal(run.status, 200, 'run request');
  assert.ok(run.json.runId, 'run produced an id');

  globalThis.__adminClient = admin;
  globalThis.__devClient = dev;
  globalThis.__workspaceId = myWs.id;
  globalThis.__requestId = req.json.request.id;
  globalThis.__runId = run.json.runId;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  await require('../src/api/db').pool.end();
});

test('settings default to 90 days', async () => {
  const admin = globalThis.__adminClient;
  const wsId = globalThis.__workspaceId;
  const res = await admin.api('GET', `/api/workspaces/${wsId}/settings`);
  assert.equal(res.status, 200);
  assert.equal(res.json.settings.run_history_retention_days, 90);
});

test('retention settings require auth', async () => {
  const anon = makeClient();
  const res = await anon.api('GET', `/api/workspaces/${globalThis.__workspaceId}/settings`);
  assert.equal(res.status, 401);
});

test('non-admin cannot change retention', async () => {
  const dev = globalThis.__devClient;
  const wsId = globalThis.__workspaceId;
  const res = await dev.api('PATCH', `/api/workspaces/${wsId}/settings`, { runHistoryRetentionDays: 30 });
  assert.equal(res.status, 403);
});

test('invalid retention values rejected', async () => {
  const admin = globalThis.__adminClient;
  const wsId = globalThis.__workspaceId;
  const tooSmall = await admin.api('PATCH', `/api/workspaces/${wsId}/settings`, { runHistoryRetentionDays: 1 });
  assert.equal(tooSmall.status, 400);
  const notInt = await admin.api('PATCH', `/api/workspaces/${wsId}/settings`, { runHistoryRetentionDays: 'abc' });
  assert.equal(notInt.status, 400);
});

test('admin can set retention and read it back', async () => {
  const admin = globalThis.__adminClient;
  const wsId = globalThis.__workspaceId;
  const res = await admin.api('PATCH', `/api/workspaces/${wsId}/settings`, { runHistoryRetentionDays: 30 });
  assert.equal(res.status, 200);
  assert.equal(res.json.settings.run_history_retention_days, 30);
  const read = await admin.api('GET', `/api/workspaces/${wsId}/settings`);
  assert.equal(read.json.settings.run_history_retention_days, 30);
});

test('purge nulls expired snapshots but keeps the run row', async () => {
  const admin = globalThis.__adminClient;
  const wsId = globalThis.__workspaceId;
  const runId = globalThis.__runId;

  // Snapshots exist while the run is fresh.
  const fresh = await admin.api('GET', `/api/history/${runId}`);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.run.request_snapshot.method, 'GET');
  assert.equal(fresh.json.run.response_snapshot.status, 200);

  // Backdate the run beyond the 30-day window.
  const db = require('../src/api/db');
  await db.query(`UPDATE run_history SET started_at = now() - interval '40 days', finished_at = now() - interval '40 days' WHERE id = $1`, [runId]);

  const { purgeExpiredRuns } = require('../src/api/retention');
  const result = await purgeExpiredRuns();
  assert.ok(result.rowsAffected >= 1, 'purged at least one run');
  assert.ok(result.detail.some((d) => d.workspaceId === wsId), 'purge attributed to workspace');

  // Aggregate run row survives; snapshots are gone.
  const aged = await admin.api('GET', `/api/history/${runId}`);
  assert.equal(aged.status, 200, 'run row still visible after purge');
  assert.equal(aged.json.run.request_snapshot, null);
  assert.equal(aged.json.run.response_snapshot, null);
  assert.equal(aged.json.run.status, 'SUCCESS', 'status preserved');

  const list = await admin.api('GET', '/api/history');
  assert.ok(list.json.runs.some((r) => r.id === runId), 'run still listed in history');

  // Purge is audit-logged per workspace.
  const { rows } = await db.query(
    `SELECT detail FROM audit_logs WHERE entity_type = 'workspace' AND entity_id = $1 AND action = 'run_history_purge' ORDER BY created_at DESC LIMIT 1`,
    [wsId]
  );
  assert.equal(rows.length, 1, 'purge audit entry exists');
  assert.ok(rows[0].detail.rowsAffected >= 1, 'audit detail has rowsAffected');
  assert.ok(rows[0].detail.cutoff, 'audit detail has cutoff');
});

test('fresh runs keep snapshots after a purge', async () => {
  const admin = globalThis.__adminClient;
  const db = require('../src/api/db');

  // Create a brand-new run (now, inside the 30-day window).
  const run = await admin.api('POST', `/api/requests/${globalThis.__requestId}/run`);
  assert.equal(run.status, 200);
  const freshRunId = run.json.runId;

  const { purgeExpiredRuns } = require('../src/api/retention');
  await purgeExpiredRuns();

  const detail = await admin.api('GET', `/api/history/${freshRunId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.json.run.request_snapshot, 'fresh run still has request snapshot');
  assert.ok(detail.json.run.response_snapshot, 'fresh run still has response snapshot');
});
