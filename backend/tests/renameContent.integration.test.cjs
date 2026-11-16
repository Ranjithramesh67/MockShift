'use strict';

// Collection rename (PUT) and workspace rename (PATCH) — EDITOR+ for
// collections, workspace ADMIN for workspaces. Blank names rejected.

if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let app;
let owner;
let stranger;
let workspaceId;
let projectId;
let collectionId;

before(async () => {
  app = await startApp();
  owner = await signupAndLogin(app.base, 'rename-owner@test.io', 'ownerpass123', 'Rename Owner');
  stranger = await signupAndLogin(app.base, 'rename-stranger@test.io', 'strangerpass123', 'Rename Stranger');

  const wsList = await owner.client.api('GET', '/api/workspaces');
  assert.equal(wsList.status, 200);
  const ws = wsList.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(ws);
  workspaceId = ws.id;

  const content = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(content.status, 200);
  projectId = content.json.projects[0].id;

  const col = await owner.client.api('POST', '/api/collections', { projectId, name: 'Original Col' });
  assert.equal(col.status, 201);
  collectionId = col.json.collection.id;
});

after(async () => {
  if (app) await app.close();
});

test('PUT /api/collections/:id renames a collection', async () => {
  const res = await owner.client.api('PUT', `/api/collections/${collectionId}`, { name: 'Renamed Col' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.collection.id, collectionId);
  assert.equal(res.json.collection.name, 'Renamed Col');

  const content = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const names = (content.json.collections || []).map((c) => c.name);
  assert.ok(names.includes('Renamed Col'));
  assert.ok(!names.includes('Original Col'));
});

test('PUT /api/collections/:id rejects a blank name', async () => {
  const res = await owner.client.api('PUT', `/api/collections/${collectionId}`, { name: '   ' });
  assert.equal(res.status, 400);
});

test('PUT /api/collections/:id is denied to an outsider', async () => {
  const res = await stranger.client.api('PUT', `/api/collections/${collectionId}`, { name: 'Hijacked' });
  assert.ok(res.status === 403 || res.status === 404);
});

test('PATCH /api/workspaces/:id renames a workspace', async () => {
  const created = await owner.client.api('POST', '/api/workspaces', { name: 'Rename Target' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.workspace.id;

  const res = await owner.client.api('PATCH', `/api/workspaces/${id}`, { name: 'Renamed Workspace' });
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const list = await owner.client.api('GET', '/api/workspaces');
  const names = (list.json.workspaces || []).map((w) => w.name);
  assert.ok(names.includes('Renamed Workspace'));
  assert.ok(!names.includes('Rename Target'));
});

test('PATCH /api/workspaces/:id rejects a blank name', async () => {
  const res = await owner.client.api('PATCH', `/api/workspaces/${workspaceId}`, { name: '  ' });
  assert.equal(res.status, 400);
});

test('PATCH /api/workspaces/:id is denied to an outsider', async () => {
  const res = await stranger.client.api('PATCH', `/api/workspaces/${workspaceId}`, { name: 'Stolen' });
  assert.ok(res.status === 403 || res.status === 404);
});
