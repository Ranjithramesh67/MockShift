'use strict';

// Integration tests for the event-driven automation triggers (ON_REQUEST /
// ON_RUN_FAILURE) and the richer failure notifications (payload + link in-app,
// optional external webhook delivery).

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

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await predicate();
    if (last) return last;
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

let admin;
let projectId;

async function createRequestInProject(name, url) {
  const col = await admin.api('POST', '/api/collections', { projectId, name: `${name} col` });
  assert.equal(col.status, 201, 'create collection');
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name,
    method: 'GET',
    url,
  });
  assert.equal(req.status, 201, 'create request');
  return req.json.request;
}

async function createWorkflow(name, requestId) {
  const wf = await admin.api('POST', '/api/workflows', {
    projectId,
    name,
    definition: {
      steps: [{ id: 'step-1', label: `Call ${name}`, requestId, onFailure: 'abort' }],
    },
  });
  assert.equal(wf.status, 201, `create workflow ${name}`);
  return wf.json.workflow;
}

async function workflowRuns(workflowId) {
  const res = await admin.api('GET', `/api/workflows/${workflowId}/runs?limit=50`);
  assert.equal(res.status, 200, 'list workflow runs');
  return res.json.runs;
}

async function waitForRun(workflowId, predicate, label) {
  return waitFor(async () => {
    const runs = await workflowRuns(workflowId);
    return runs.find(predicate) || null;
  }, { label });
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

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'evtadmin@test.io',
    password: 'adminpass123',
    name: 'Event Admin',
  });
  assert.equal(signup.status, 201, 'admin signup');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  projectId = content.json.projects.find((p) => p.name === 'Default Project').id;

  globalThis.__mockBase = `http://127.0.0.1:${mockPort}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  const { shutdownWorkflows } = require('../src/api/workflowService');
  await shutdownWorkflows();
  await require('../src/api/db').pool.end();
});

test('automation creation stores and validates the new trigger types', async () => {
  const watched = await createRequestInProject('evt-watch', `${globalThis.__mockBase}/evt-watch`);
  const wf = await createWorkflow('evt-wf', watched.id);

  const onReq = await admin.api('POST', '/api/automations', {
    name: 'On Request A',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_REQUEST',
    eventRequestId: watched.id,
    notifyOnFailure: true,
  });
  assert.equal(onReq.status, 201, 'create ON_REQUEST automation');
  assert.equal(onReq.json.automation.triggerType, 'ON_REQUEST');
  assert.equal(onReq.json.automation.eventRequestId, watched.id);

  const onFail = await admin.api('POST', '/api/automations', {
    name: 'On Failure B',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_RUN_FAILURE',
    sourceWorkflowId: wf.id,
    notifyWebhookUrl: 'https://example.invalid/hook',
  });
  assert.equal(onFail.status, 201, 'create ON_RUN_FAILURE automation');
  assert.equal(onFail.json.automation.triggerType, 'ON_RUN_FAILURE');
  assert.equal(onFail.json.automation.sourceWorkflowId, wf.id);
  assert.equal(onFail.json.automation.notifyWebhookUrl, 'https://example.invalid/hook');

  const badTrigger = await admin.api('POST', '/api/automations', {
    name: 'Bad',
    projectId,
    workflowId: wf.id,
    triggerType: 'EVERY_MINUTE',
  });
  assert.equal(badTrigger.status, 400, 'unknown trigger rejected');

  const foreign = await admin.api('POST', '/api/automations', {
    name: 'Foreign',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_REQUEST',
    eventRequestId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(foreign.status, 400, 'foreign watched request rejected');

  const badUrl = await admin.api('POST', '/api/automations', {
    name: 'Bad URL',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_RUN_FAILURE',
    notifyWebhookUrl: 'not-a-url',
  });
  assert.equal(badUrl.status, 400, 'bad notify webhook URL rejected');
});

test('ON_REQUEST automation fires its workflow when the watched request runs', async () => {
  const watched = await createRequestInProject('evt-onreq', `${globalThis.__mockBase}/evt-onreq`);
  const wf = await createWorkflow('evt-onreq-wf', watched.id);
  const onReq = await admin.api('POST', '/api/automations', {
    name: 'OnReq Fires',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_REQUEST',
    eventRequestId: watched.id,
  });
  assert.equal(onReq.status, 201);

  const run = await admin.api('POST', `/api/requests/${watched.id}/run`);
  assert.equal(run.status, 200, 'run watched request');
  assert.equal(run.json.runStatus, 'SUCCESS');

  const found = await waitForRun(
    wf.id,
    (r) => r.trigger === 'ON_REQUEST',
    'ON_REQUEST workflow run'
  );
  assert.ok(found, 'a workflow run triggered by ON_REQUEST exists');
});

test('ON_RUN_FAILURE automation fires its workflow when a request run fails', async () => {
  const okRequest = await createRequestInProject('evt-ok', `${globalThis.__mockBase}/evt-ok`);
  const failing = await createRequestInProject('evt-fail', 'http://127.0.0.1:1/nope');
  const wf = await createWorkflow('evt-fail-wf', okRequest.id);
  const onFail = await admin.api('POST', '/api/automations', {
    name: 'OnFail Fires',
    projectId,
    workflowId: wf.id,
    triggerType: 'ON_RUN_FAILURE',
  });
  assert.equal(onFail.status, 201);

  const run = await admin.api('POST', `/api/requests/${failing.id}/run`);
  assert.equal(run.status, 200, 'run failing request');
  assert.equal(run.json.runStatus, 'FAILED');

  const found = await waitForRun(
    wf.id,
    (r) => r.trigger === 'ON_RUN_FAILURE',
    'ON_RUN_FAILURE workflow run'
  );
  assert.ok(found, 'a workflow run triggered by ON_RUN_FAILURE exists');
});

test('failed workflow runs produce richer notifications + external webhook delivery', async () => {
  const received = [];
  const capture = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => capture.listen(0, '127.0.0.1', resolve));
  const captureBase = `http://127.0.0.1:${capture.address().port}/hook`;

  const failingRequest = await createRequestInProject('evt-wf-fail', 'http://127.0.0.1:1/nope');
  const wf = await createWorkflow('evt-wf-fail-wf', failingRequest.id);

  const automation = await admin.api('POST', '/api/automations', {
    name: 'Webhook On Fail',
    projectId,
    workflowId: wf.id,
    triggerType: 'WEBHOOK',
    notifyOnFailure: true,
    notifyWebhookUrl: captureBase,
  });
  assert.equal(automation.status, 201, 'create webhook automation');
  const token = automation.json.automation.webhookToken;

  const trig = await admin.api('POST', `/api/webhooks/${token}`, {});
  assert.equal(trig.status, 202, 'webhook trigger accepted');

  const failedRun = await waitForRun(wf.id, (r) => r.status === 'FAILED', 'workflow run FAILED');
  assert.ok(failedRun, 'the webhook workflow run failed');

  await waitFor(
    () => received.length > 0,
    { label: 'webhook notification received', timeoutMs: 10000 }
  );
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.event, 'run_failed');
  assert.equal(payload.runId, failedRun.id);
  assert.equal(payload.automation.name, 'Webhook On Fail');
  assert.equal(payload.workflow, 'evt-wf-fail-wf');

  const notifs = await admin.api('GET', '/api/notifications');
  assert.equal(notifs.status, 200);
  const richer = notifs.json.notifications.find((n) => n.title.includes('Webhook On Fail'));
  assert.ok(richer, 'in-app failure notification created');
  assert.ok(richer.payload, 'notification carries structured payload');
  assert.equal(richer.payload.runId, failedRun.id);
  assert.equal(richer.link, '/automations');

  await new Promise((r) => capture.close(r));
});
