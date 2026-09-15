'use strict';

// MED-3 — malformed client input used to bubble up as a raw 500 with the
// Postgres error text ("invalid input syntax for type uuid ...", "LIMIT must
// not be negative"). These tests pin the hardened contract: client mistakes get
// a 400 (or 200 with a clamped page size) and the response never leaks DB
// internals.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, makeClient } = require('./support/harness.cjs');

let app;
let client;
let projectId;

const LEAK = /invalid input syntax|must not be negative|syntax for type|pg_|relation "|\bSELECT\b|\bFROM\b/i;

function assertNoLeak(res, label) {
  assert.ok(res.status < 500, `${label}: expected <500, got ${res.status} ${JSON.stringify(res.json)}`);
  const body = JSON.stringify(res.json || {});
  assert.ok(!LEAK.test(body), `${label}: response leaked DB internals: ${body}`);
}

before(async () => {
  app = await startApp();
  const auth = await signupAndLogin(app.base, 'validate@test.io', 'validatepass123', 'Validate');
  client = auth.client;

  const ws = await client.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  projectId = content.json.projects.find((p) => p.name === 'Default Project').id;
});

after(async () => {
  const { shutdownWorkflows } = require('../src/api/workflowService');
  await shutdownWorkflows();
  if (app) await app.close();
});

test('negative limit is clamped instead of raising a 500', async () => {
  const history = await client.api('GET', '/api/history?limit=-1');
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.json.runs));

  const notifications = await client.api('GET', '/api/notifications?limit=-1');
  assert.equal(notifications.status, 200);
  assert.ok(Array.isArray(notifications.json.notifications));
});

test('invalid cron is rejected with 400 and valid cron is accepted', async () => {
  const col = await client.api('POST', '/api/collections', { projectId, name: 'cron col' });
  assert.equal(col.status, 201);
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'cron req',
    method: 'GET',
    url: 'https://example.com/',
  });
  assert.equal(req.status, 201);
  const wf = await client.api('POST', '/api/workflows', {
    projectId,
    name: 'cron wf',
    definition: { steps: [{ id: 'step-1', label: 'call', requestId: req.json.request.id, onFailure: 'abort' }] },
  });
  assert.equal(wf.status, 201);

  const bad = await client.api('POST', '/api/automations', {
    name: 'bad cron',
    projectId,
    workflowId: wf.json.workflow.id,
    triggerType: 'SCHEDULE',
    scheduleCron: 'not a cron',
  });
  assert.equal(bad.status, 400);
  assertNoLeak(bad, 'invalid cron');

  const good = await client.api('POST', '/api/automations', {
    name: 'good cron',
    projectId,
    workflowId: wf.json.workflow.id,
    triggerType: 'SCHEDULE',
    scheduleCron: '*/5 * * * *',
  });
  assert.equal(good.status, 201);

  const runs = await client.api('GET', `/api/automations/${good.json.automation.id}/runs?limit=-5`);
  assert.equal(runs.status, 200);
  assert.ok(Array.isArray(runs.json.runs));
});

test('non-uuid identifiers return 400 without leaking Postgres errors', async () => {
  const cases = [
    ['POST', '/api/monitors', { projectId: 'not-a-uuid', name: 'bad monitor' }, 400],
    ['GET', '/api/workspaces/not-a-uuid/content', undefined, 400],
    ['POST', '/api/sends/not-a-uuid/accept', undefined, 400],
    ['GET', '/api/environments/not-a-uuid/variables', undefined, 400],
  ];
  for (const [method, url, body, expected] of cases) {
    const res = await client.api(method, url, body);
    assertNoLeak(res, `${method} ${url}`);
    assert.equal(res.status, expected, `${method} ${url} -> ${res.status} ${JSON.stringify(res.json)}`);
  }
});

test('authenticated non-member does not get raw DB errors from bad ids', async () => {
  const other = makeClient(app.base);
  const res = await other.api('GET', '/api/workspaces/not-a-uuid/content');
  assert.ok(res.status < 500);
});
