'use strict';

// Integration tests for the authenticated global search endpoint:
//   - GET /api/search returns only entities the caller can read
//   - results for features disabled via configurable menus are omitted
//   - blank queries are rejected with 400

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let admin;
let userA;
let userB;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  // First signup becomes the platform ADMIN (bootstrap), needed to toggle menus.
  admin = await signupAndLogin(base, 'search-admin@test.io', 'searchadmin123', 'Search Admin');
  userA = await signupAndLogin(base, 'search-a@test.io', 'searchapass123', 'Search A');
  userB = await signupAndLogin(base, 'search-b@test.io', 'searchbpass123', 'Search B');

  const ws = await userA.client.api('POST', '/api/workspaces', { name: 'Searchable WS' });
  assert.equal(ws.status, 201, `workspace A failed: ${JSON.stringify(ws.json)}`);
  const content = await userA.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  assert.equal(content.status, 200);
  const projectId = content.json.projects[0].id;

  const col = await userA.client.api('POST', '/api/collections', {
    projectId,
    name: 'Search collection',
  });
  assert.equal(col.status, 201, `collection failed: ${JSON.stringify(col.json)}`);

  const req = await userA.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Get user',
    method: 'GET',
    url: 'https://example.com/users',
  });
  assert.equal(req.status, 201, `request failed: ${JSON.stringify(req.json)}`);

  const secret = await userB.client.api('POST', '/api/workspaces', { name: 'Secret WS' });
  assert.equal(secret.status, 201, `workspace B failed: ${JSON.stringify(secret.json)}`);
});

after(async () => {
  if (closeApp) await closeApp();
});

test('search returns only entities the caller can read', async () => {
  const res = await userA.client.api('GET', '/api/search?q=search');
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const names = (res.json.results || []).map((r) => r.name);
  assert.ok(names.includes('Searchable WS'), `expected own workspace in ${JSON.stringify(names)}`);
  assert.ok(!names.includes('Secret WS'), `leaked another org's workspace: ${JSON.stringify(names)}`);
  assert.ok(
    res.json.results.every((r) => typeof r.rank === 'number'),
    'every result must carry a numeric rank'
  );
  assert.ok(
    res.json.results.some((r) => r.type === 'workspace' && r.name === 'Searchable WS'),
    'workspace result should be typed'
  );

  const secret = await userA.client.api('GET', '/api/search?q=secret');
  assert.equal(secret.status, 200, JSON.stringify(secret.json));
  assert.equal(
    secret.json.results.length,
    0,
    `expected no results for another org's workspace, got ${JSON.stringify(secret.json.results)}`
  );
  assert.deepEqual(secret.json.groups, {});
});

test('search omits results for disabled menus but keeps unrelated ones', async () => {
  const ws = await userA.client.api('POST', '/api/workspaces', { name: 'Latency WS' });
  assert.equal(ws.status, 201, `latency workspace failed: ${JSON.stringify(ws.json)}`);
  const orgId = ws.json.workspace.organization_id;
  const content = await userA.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  assert.equal(content.status, 200);
  const projectId = content.json.projects[0].id;

  const col = await userA.client.api('POST', '/api/collections', {
    projectId,
    name: 'Latency collection',
  });
  assert.equal(col.status, 201, `latency collection failed: ${JSON.stringify(col.json)}`);

  const req = await userA.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping request',
    method: 'GET',
    url: 'https://example.com/ping',
  });
  assert.equal(req.status, 201, `latency request failed: ${JSON.stringify(req.json)}`);

  const monitor = await userA.client.api('POST', '/api/monitors', {
    projectId,
    name: 'Latency probe',
    targetType: 'REQUEST',
    requestId: req.json.request.id,
    scheduleCron: '* * * * *',
  });
  assert.equal(monitor.status, 201, `monitor create failed: ${JSON.stringify(monitor.json)}`);

  // Sanity check: the monitor is searchable while the menu is enabled.
  const before = await userA.client.api('GET', '/api/search?q=latency');
  assert.equal(before.status, 200, JSON.stringify(before.json));
  assert.ok(
    before.json.results.some((r) => r.type === 'monitor' && r.name === 'Latency probe'),
    `monitor missing before disable: ${JSON.stringify(before.json.results)}`
  );

  const disable = await admin.client.api('PUT', '/api/admin/menus', {
    menuKey: 'monitors',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(disable.status, 200, `menu disable failed: ${JSON.stringify(disable.json)}`);

  const disabled = await userA.client.api('GET', '/api/search?q=latency');
  assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
  assert.ok(
    !disabled.json.results.some((r) => r.type === 'monitor'),
    `disabled monitor leaked: ${JSON.stringify(disabled.json.results)}`
  );
  // A disabled feature menu must not remove unrelated (workspace/apis) results.
  assert.ok(
    disabled.json.results.some((r) => r.type === 'workspace' && r.name === 'Latency WS'),
    `unrelated workspace missing after disable: ${JSON.stringify(disabled.json.results)}`
  );
});

test('search rejects blank queries with 400', async () => {
  const blank = await userA.client.api('GET', '/api/search?q=');
  assert.equal(blank.status, 400);
  const missing = await userA.client.api('GET', '/api/search');
  assert.equal(missing.status, 400);
});
