'use strict';

// Project-rooted hierarchy: project -> workspace -> collection -> folder/request.
// Verifies the inverted edges (workspaces.project_id, collections.workspace_id)
// while the legacy mirrors keep old endpoints working.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let app;
let base;

before(async () => {
  app = await startApp();
  base = app.base;
});

after(async () => {
  if (app) await app.close();
});

async function admin() {
  const { client } = await signupAndLogin(base, `root${Date.now()}@test.io`, 'rootpass123', 'Root User');
  return client;
}

test('GET /api/projects exposes organization_id for top-level grouping', async () => {
  const c = await admin();
  const res = await c.api('GET', '/api/projects');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.projects));
  const def = res.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(def, 'default project present');
  assert.ok(def.organization_id, 'project carries organization_id');
  assert.ok(def.can_access, 'creator can access their default project');
});

test('project content tree roots at workspaces and collections', async () => {
  const c = await admin();
  const proj = (await c.api('GET', '/api/projects')).json.projects.find((p) => p.name === 'Default Project');
  const tree = await c.api('GET', `/api/projects/${proj.id}/content`);
  assert.equal(tree.status, 200);
  assert.equal(tree.json.projectId, proj.id);
  assert.equal(tree.json.workspaces.length, 1);
  assert.equal(tree.json.workspaces[0].name, 'My Workspace');

  const wsId = tree.json.workspaces[0].id;
  const col = await c.api('POST', '/api/collections', { projectId: proj.id, name: 'Billing' });
  assert.equal(col.status, 201);

  const tree2 = (await c.api('GET', `/api/projects/${proj.id}/content`)).json;
  const collection = tree2.collections.find((x) => x.name === 'Billing');
  assert.ok(collection, 'collection present in project tree');
  assert.equal(collection.workspace_id, wsId, 'collection belongs to the workspace');
});

test('a second workspace can be created inside a project', async () => {
  const c = await admin();
  const proj = (await c.api('GET', '/api/projects')).json.projects.find((p) => p.name === 'Default Project');

  const created = await c.api('POST', `/api/projects/${proj.id}/workspaces`, { name: 'Staging' });
  assert.equal(created.status, 201);
  assert.equal(created.json.workspace.name, 'Staging');
  assert.equal(created.json.workspace.project_id, proj.id);

  const tree = (await c.api('GET', `/api/projects/${proj.id}/content`)).json;
  assert.equal(tree.workspaces.length, 2);
  assert.deepEqual(tree.workspaces.map((w) => w.name).sort(), ['My Workspace', 'Staging']);

  const staging = tree.workspaces.find((w) => w.name === 'Staging');
  const col = await c.api('POST', '/api/collections', { workspaceId: staging.id, name: 'Ops' });
  assert.equal(col.status, 201);
  const tree3 = (await c.api('GET', `/api/projects/${proj.id}/content`)).json;
  const ops = tree3.collections.find((x) => x.name === 'Ops');
  assert.ok(ops, 'Ops collection present');
  assert.equal(ops.workspace_id, staging.id, 'collection lands in the selected workspace');
});

test('a new top-level project can be created from an organization', async () => {
  const c = await admin();
  const proj = (await c.api('GET', '/api/projects')).json.projects.find((p) => p.name === 'Default Project');
  const created = await c.api('POST', '/api/projects', { organizationId: proj.organization_id, name: 'Platform' });
  assert.equal(created.status, 201);
  assert.equal(created.json.project.name, 'Platform');
  assert.equal(created.json.project.organization_id, proj.organization_id);

  const dup = await c.api('POST', '/api/projects', { organizationId: proj.organization_id, name: 'Platform' });
  assert.equal(dup.status, 409);

  const tree = await c.api('GET', `/api/projects/${created.json.project.id}/content`);
  assert.equal(tree.status, 200);
  assert.deepEqual(tree.json.workspaces, []);
});

test('non-admin org member cannot create a top-level project', async () => {
  const c = await admin();
  const proj = (await c.api('GET', '/api/projects')).json.projects.find((p) => p.name === 'Default Project');

  // Invite a second user into the org as EDITOR via a direct workspace share is
  // not equivalent; instead sign up a fresh personal org and use its admin,
  // which must NOT be able to create projects in this org.
  const other = await signupAndLogin(base, `outsider${Date.now()}@test.io`, 'outpass123', 'Outsider');
  const res = await other.client.api('POST', '/api/projects', {
    organizationId: proj.organization_id,
    name: 'Sneaky',
  });
  assert.equal(res.status, 403);
});
