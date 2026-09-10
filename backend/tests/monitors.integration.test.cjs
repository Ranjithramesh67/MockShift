'use strict';

// E2 — API monitoring & alerting: monitors CRUD, due-schedule execution,
// result recording, failure-threshold alerting (webhook + in-app) and the
// status/history aggregate API. Scaffolding mirrors docsTables.integration.test.cjs.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

let server;
let base;
let targetServer;
let targetBase;
let targetMode = 'ok';
let webhookServer;
let webhookBase;
const webhookHits = [];

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

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  // Throwaway HTTP target whose behaviour flips between 200 and 500.
  targetServer = http.createServer((req, res) => {
    if (targetMode === 'fail') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }
  });
  targetBase = `http://127.0.0.1:${await listen(targetServer)}`;

  // Throwaway webhook receiver; records every alert payload it receives.
  webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      try {
        webhookHits.push(JSON.parse(raw));
      } catch {
        webhookHits.push({ raw });
      }
      res.writeHead(204);
      res.end();
    });
  });
  webhookBase = `http://127.0.0.1:${await listen(webhookServer)}`;

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    // Monitor routes are a coordinator seam in server.js; mount them here so
    // this suite is self-contained. createApp() registers its /api 404 before
    // returning, so move our router ahead of that layer (harmless once the
    // coordinator wires the mount in server.js).
    app.use('/api/monitors', require('../src/api/routes/monitors'));
    const stack = app.router ? app.router.stack : app._router.stack;
    const mounted = stack.pop();
    const notFoundIdx = stack.findIndex((layer) => layer.handle && layer.handle.length === 2 && !layer.route);
    if (notFoundIdx !== -1) stack.splice(notFoundIdx, 0, mounted);
    else stack.push(mounted);
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'monitoradmin@test.io',
    password: 'adminpass123',
    name: 'Monitor Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;

  const ws = await admin.api('GET', '/api/workspaces');
  const wsId = ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
  const tree = await admin.api('GET', `/api/workspaces/${wsId}/content`);
  const project = tree.json.projects.find((p) => p.can_access) || tree.json.projects[0];
  assert.ok(project, 'default project exists');

  const col = await admin.api('POST', '/api/collections', { projectId: project.id, name: 'Monitored' });
  assert.equal(col.status, 201, JSON.stringify(col.json));
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Health check',
    method: 'GET',
    url: `${targetBase}/check`,
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));

  globalThis.__ctx = {
    projectId: project.id,
    collectionId: col.json.collection.id,
    requestId: req.json.request.id,
  };
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (targetServer) await new Promise((r) => targetServer.close(r));
  if (webhookServer) await new Promise((r) => webhookServer.close(r));
  await require('../src/api/db').pool.end();
});

async function createMonitor(overrides = {}) {
  const ctx = globalThis.__ctx;
  const res = await globalThis.__admin.api('POST', '/api/monitors', {
    projectId: ctx.projectId,
    name: 'Check',
    targetType: 'REQUEST',
    requestId: ctx.requestId,
    scheduleCron: '* * * * *',
    ...overrides,
  });
  assert.equal(res.status, 201, `create monitor failed: ${JSON.stringify(res.json)}`);
  return res.json.monitor;
}

test('runDueMonitors executes due enabled monitors and skips disabled ones', async () => {
  const enabled = await createMonitor({ name: 'Due enabled' });
  const disabled = await createMonitor({ name: 'Due disabled', enabled: false });
  targetMode = 'ok';

  const { runDueMonitors } = require('../src/api/monitorRunner');
  const summary = await runDueMonitors({ now: new Date('2026-03-01T12:00:30Z') });
  assert.ok(summary.checked >= 1, 'at least one monitor checked');

  const enabledRes = await globalThis.__admin.api('GET', `/api/monitors/${enabled.id}/results`);
  assert.equal(enabledRes.status, 200);
  assert.equal(enabledRes.json.results.length, 1);
  assert.equal(enabledRes.json.results[0].status, 'PASS');
  assert.equal(enabledRes.json.results[0].httpStatus, 200);
  assert.equal(typeof enabledRes.json.results[0].durationMs, 'number');
  assert.equal(enabledRes.json.aggregate.uptimePct, 100);
  assert.equal(enabledRes.json.aggregate.currentStreak.status, 'UP');
  assert.equal(enabledRes.json.monitor.status, 'UP');

  const disabledRes = await globalThis.__admin.api('GET', `/api/monitors/${disabled.id}/results`);
  assert.equal(disabledRes.json.results.length, 0, 'disabled monitor not executed');
});

test('failure threshold fires webhook + in-app alert, recovery fires again', async () => {
  webhookHits.length = 0;
  const monitor = await createMonitor({
    name: 'Flaky endpoint',
    failureThreshold: 2,
    notifyWebhookUrl: `${webhookBase}/alerts`,
  });
  const { runMonitorById } = require('../src/api/monitorRunner');

  targetMode = 'fail';
  const first = await runMonitorById({ monitorId: monitor.id, now: new Date('2026-03-01T13:00:00Z') });
  assert.equal(first.check.passed, false);
  assert.equal(first.alerts.length, 0, 'below threshold: no alert');
  assert.equal(first.monitor.consecutive_failures, 1);
  assert.equal(first.monitor.status, 'DOWN');

  const second = await runMonitorById({ monitorId: monitor.id, now: new Date('2026-03-01T13:01:00Z') });
  assert.equal(second.alerts.length, 1, 'threshold crossed: one alert');
  assert.equal(second.alerts[0].event, 'failed');
  assert.equal(second.monitor.consecutive_failures, 2);
  assert.equal(second.monitor.alerted, true);

  // Webhook got exactly one POST with the failure payload.
  assert.equal(webhookHits.length, 1);
  assert.equal(webhookHits[0].event, 'failed');
  assert.equal(webhookHits[0].monitor.id, monitor.id);
  assert.equal(webhookHits[0].check.passed, false);

  // In-app notification landed for the monitor creator.
  const inbox = await globalThis.__admin.api('GET', '/api/notifications?limit=200');
  const failureNote = inbox.json.notifications.find((n) => n.title.includes('Flaky endpoint'));
  assert.ok(failureNote, 'failure notification present');
  assert.ok(/failed/i.test(failureNote.title));

  // Recovery.
  targetMode = 'ok';
  const third = await runMonitorById({ monitorId: monitor.id, now: new Date('2026-03-01T13:02:00Z') });
  assert.equal(third.check.passed, true);
  assert.equal(third.alerts.length, 1);
  assert.equal(third.alerts[0].event, 'recovered');
  assert.equal(third.monitor.alerted, false);
  assert.equal(third.monitor.status, 'UP');
  assert.equal(webhookHits.length, 2);
  assert.equal(webhookHits[1].event, 'recovered');

  const inbox2 = await globalThis.__admin.api('GET', '/api/notifications?limit=200');
  assert.ok(
    inbox2.json.notifications.some((n) => n.title.includes('Flaky endpoint') && /recovered/i.test(n.title)),
    'recovery notification present'
  );
});

test('results API reports uptime and p95 latency across checks', async () => {
  const monitor = await createMonitor({ name: 'Latency stats' });
  psqlRun(
    `INSERT INTO monitor_results (monitor_id, status, http_status, duration_ms, checked_at)
     SELECT '${monitor.id}',
            CASE WHEN g <= 18 THEN 'PASS' ELSE 'FAIL' END,
            200, g, now() - (g || ' minutes')::interval
       FROM generate_series(1, 20) g;`
  );

  const res = await globalThis.__admin.api('GET', `/api/monitors/${monitor.id}/results?limit=50`);
  assert.equal(res.status, 200);
  assert.equal(res.json.results.length, 20);
  assert.equal(res.json.aggregate.totalChecks, 20);
  assert.equal(res.json.aggregate.passed, 18);
  assert.equal(res.json.aggregate.failed, 2);
  assert.equal(res.json.aggregate.uptimePct, 90);
  // percentile_cont(0.95) over durations 1..20 = 19.05 -> rounded to 19.
  assert.equal(res.json.aggregate.p95DurationMs, 19);
});

test('manual check endpoint runs a monitor and records a result', async () => {
  const monitor = await createMonitor({ name: 'Manual check' });
  targetMode = 'ok';
  const res = await globalThis.__admin.api('POST', `/api/monitors/${monitor.id}/check`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.check.passed, true);
  assert.equal(res.json.monitor.status, 'UP');
  assert.equal(res.json.aggregate.totalChecks, 1);
});

test('create validates cron and target', async () => {
  const bad = await globalThis.__admin.api('POST', '/api/monitors', {
    projectId: globalThis.__ctx.projectId,
    name: 'Bad cron',
    targetType: 'REQUEST',
    requestId: globalThis.__ctx.requestId,
    scheduleCron: 'not a cron',
  });
  assert.equal(bad.status, 400);

  const badTarget = await globalThis.__admin.api('POST', '/api/monitors', {
    projectId: globalThis.__ctx.projectId,
    name: 'Bad target',
    targetType: 'REQUEST',
    requestId: '00000000-0000-0000-0000-000000000000',
    scheduleCron: '* * * * *',
  });
  assert.equal(badTarget.status, 400);
});
