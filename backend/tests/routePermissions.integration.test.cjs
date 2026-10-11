'use strict';

// Mirror the harness scratch port onto the app's pool (see iam test note):
// db.js reads PGPORT, harness.cjs reads INTEGRATION_PGPORT.
if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let owner;
let viewer;
let orgId;
let workspaceId;
let collectionId;
let collectionName;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  // Consume the bootstrap platform-ADMIN slot so the actors below are plain
  // org-scoped users and exercise the IAM guards rather than the global bypass.
  await signupAndLogin(base, 'rp-boot@rp-boot.io', 'bootpass123', 'RP Boot');

  // owner creates a fresh org and is its ADMIN; viewer joins the same company
  // domain and would default to EDITOR, so we explicitly downgrade to VIEWER.
  owner = await signupAndLogin(base, 'rp-owner@rp-corp.io', 'ownerpass123', 'RP Owner');
  viewer = await signupAndLogin(base, 'rp-viewer@rp-corp.io', 'viewerpass123', 'RP Viewer');

  const orgs = await owner.client.api('GET', '/api/orgs');
  assert.equal(orgs.status, 200);
  orgId = orgs.json.organizations[0].id;

  const roles = await owner.client.api('GET', `/api/orgs/${orgId}/roles`);
  assert.equal(roles.status, 200);
  const viewerRole = roles.json.roles.find((r) => r.systemKey === 'VIEWER');
  assert.ok(viewerRole, 'VIEWER system role must exist');

  const assigned = await owner.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/${viewer.id}/roles`,
    { roleIds: [viewerRole.id] }
  );
  assert.equal(assigned.status, 200);

  const wsList = await owner.client.api('GET', '/api/workspaces');
  assert.equal(wsList.status, 200);
  const ws = (wsList.json.workspaces || [])[0];
  assert.ok(ws, 'owner should have a provisioned workspace');
  workspaceId = ws.id;

  // Give the viewer read access to the (private) workspace without granting
  // write rights; the IAM guard must still deny mutations.
  psql(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${workspaceId}', '${viewer.id}', 'VIEWER') ON CONFLICT DO NOTHING`
  );

  collectionName = `RP Owner Collection ${Date.now()}`;
  const col = await owner.client.api('POST', '/api/collections', {
    workspaceId,
    name: collectionName,
  });
  assert.equal(col.status, 201);
  collectionId = col.json.collection.id;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('org ADMIN (non-platform) may create a workspace', async () => {
  const res = await owner.client.api('POST', '/api/workspaces', {
    organizationId: orgId,
    name: `RP Owner Second ${Date.now()}`,
  });
  assert.equal(res.status, 201);
});

test('org VIEWER is denied workspace.create with an IAM 403', async () => {
  const res = await viewer.client.api('POST', '/api/workspaces', {
    organizationId: orgId,
    name: 'RP Viewer Workspace',
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'Insufficient permissions');
});

test('org VIEWER is denied workspace.write when creating a collection', async () => {
  const res = await viewer.client.api('POST', '/api/collections', {
    workspaceId,
    name: 'RP Viewer Collection',
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'Insufficient permissions');
});

test('org VIEWER retains read access to workspace content', async () => {
  const res = await viewer.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(res.status, 200);
});

test('collection created by the admin is visible', async () => {
  assert.ok(collectionId);
  const res = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(res.status, 200);
  const names = (res.json.collections || []).map((c) => c.name);
  assert.ok(names.includes(collectionName), `expected ${collectionName} in ${JSON.stringify(names)}`);
});
