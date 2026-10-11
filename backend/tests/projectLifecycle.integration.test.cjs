'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let app;
let admin;
let outsider;
let workspaceId;

function scalar(sql) {
  const out = psql(sql);
  const m = /^\s*(\d+)\s*$/m.exec(out);
  return m ? Number(m[1]) : null;
}

async function myWorkspaceId(client) {
  const res = await client.api('GET', '/api/workspaces');
  assert.equal(res.status, 200);
  const ws = res.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(ws, 'found My Workspace');
  return ws.id;
}

async function defaultProjectId(client, wsId) {
  const content = await client.api('GET', `/api/workspaces/${wsId}/content`);
  assert.equal(content.status, 200);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  return project.id;
}

before(async () => {
  app = await startApp();
  // First signup becomes the platform ADMIN; consume that slot so `admin`
  // below is an ordinary user (org admin of their own personal org).
  await signupAndLogin(app.base, 'bootstrap-pl@test.io', 'bootpass123', 'Bootstrap');
  admin = await signupAndLogin(app.base, 'pladmin@test.io', 'adminpass123', 'Project Admin');
  outsider = await signupAndLogin(app.base, 'plout@test.io', 'outpass123', 'Project Outsider');
  workspaceId = await myWorkspaceId(admin.client);
});

after(async () => {
  if (app) await app.close();
});

test('create project validates name and workspace admin role', async () => {
  const blank = await admin.client.api('POST', '/api/projects', { workspaceId, name: '   ' });
  assert.equal(blank.status, 400);

  const noWs = await admin.client.api('POST', '/api/projects', { name: 'No Workspace' });
  assert.equal(noWs.status, 400);

  const created = await admin.client.api('POST', '/api/projects', { workspaceId, name: '  Payments  ' });
  assert.equal(created.status, 201);
  assert.equal(created.json.project.name, 'Payments', 'name is trimmed');
  assert.equal(created.json.project.workspace_id, workspaceId);

  // Unique inside a workspace, case-insensitively.
  const dupe = await admin.client.api('POST', '/api/projects', { workspaceId, name: 'payments' });
  assert.equal(dupe.status, 409);
});

test('non-admin cannot create a project in someone else workspace', async () => {
  const res = await outsider.client.api('POST', '/api/projects', { workspaceId, name: 'Sneaky' });
  assert.equal(res.status, 403);
});

test('workspace manager can create a project', async () => {
  const mgr = await signupAndLogin(app.base, 'plmgr@test.io', 'mgrpass123', 'Project Mgr');
  const wsId = await myWorkspaceId(mgr.client);
  // Personal-org owners are org ADMIN, which getWorkspaceRole treats as
  // workspace ADMIN. Drop that so only the workspace_members row counts.
  psql(`UPDATE organization_members SET role = 'EDITOR' WHERE user_id = '${mgr.id}'`);
  psql(`UPDATE workspace_members SET role = 'MANAGER' WHERE user_id = '${mgr.id}'`);
  const res = await mgr.client.api('POST', '/api/projects', { workspaceId: wsId, name: 'Mgr Project' });
  assert.equal(res.status, 201);
});

test('workspace editor cannot create a project', async () => {
  const editor = await signupAndLogin(app.base, 'pleditor@test.io', 'editpass123', 'Project Editor');
  const wsId = await myWorkspaceId(editor.client);
  psql(`UPDATE organization_members SET role = 'EDITOR' WHERE user_id = '${editor.id}'`);
  psql(`UPDATE workspace_members SET role = 'EDITOR' WHERE user_id = '${editor.id}'`);
  const res = await editor.client.api('POST', '/api/projects', { workspaceId: wsId, name: 'Nope' });
  assert.equal(res.status, 403);
});

test('rename enforces uniqueness and manager access', async () => {
  const content = await admin.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const project = content.json.projects.find((p) => p.name === 'Payments');
  assert.ok(project, 'created project is listed');

  // Renaming to itself (same row) is not a conflict.
  const same = await admin.client.api('PATCH', `/api/projects/${project.id}`, { name: 'Payments' });
  assert.equal(same.status, 200);

  const renamed = await admin.client.api('PATCH', `/api/projects/${project.id}`, { name: 'Billing' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.project.name, 'Billing');

  const conflict = await admin.client.api('PATCH', `/api/projects/${project.id}`, { name: 'default project' });
  assert.equal(conflict.status, 409, 'conflicts with the Default Project case-insensitively');

  const blank = await admin.client.api('PATCH', `/api/projects/${project.id}`, { name: '  ' });
  assert.equal(blank.status, 400);

  const outsiderRename = await outsider.client.api('PATCH', `/api/projects/${project.id}`, { name: 'Hijacked' });
  assert.equal(outsiderRename.status, 403);
});

test('a workspace keeps at least one project', async () => {
  const workspaceIdOnlyProject = await myWorkspaceId(outsider.client);
  const onlyProject = await defaultProjectId(outsider.client, workspaceIdOnlyProject);
  const res = await outsider.client.api('DELETE', `/api/projects/${onlyProject}`);
  assert.equal(res.status, 409);
  assert.match(res.json.error, /at least one project/i);
});

test('delete cascades its collections and keeps the rest of the workspace', async () => {
  const workspaceIdOnlyProject = await myWorkspaceId(outsider.client);
  const onlyProject = await defaultProjectId(outsider.client, workspaceIdOnlyProject);

  const created = await outsider.client.api('POST', '/api/projects', {
    workspaceId: workspaceIdOnlyProject,
    name: 'Scratch',
  });
  assert.equal(created.status, 201);
  const scratchId = created.json.project.id;

  const collection = await outsider.client.api('POST', '/api/collections', {
    projectId: scratchId,
    name: 'Temp Collection',
  });
  assert.equal(collection.status, 201);
  assert.equal(scalar(`SELECT count(*) FROM collections WHERE project_id = '${scratchId}'`), 1);

  const removed = await outsider.client.api('DELETE', `/api/projects/${scratchId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.json.ok, true);
  assert.equal(scalar(`SELECT count(*) FROM projects WHERE id = '${scratchId}'`), 0);
  assert.equal(scalar(`SELECT count(*) FROM collections WHERE project_id = '${scratchId}'`), 0, 'collections cascade');

  // The remaining Default Project is untouched and still deletable-blocked.
  const stillThere = await outsider.client.api('GET', `/api/workspaces/${workspaceIdOnlyProject}/content`);
  assert.ok(stillThere.json.projects.some((p) => p.id === onlyProject));
  const lastDelete = await outsider.client.api('DELETE', `/api/projects/${onlyProject}`);
  assert.equal(lastDelete.status, 409);
});

test('deleting a project twice is rejected', async () => {
  const wsId = await myWorkspaceId(outsider.client);
  const created = await outsider.client.api('POST', '/api/projects', {
    workspaceId: wsId,
    name: 'Throwaway',
  });
  const id = created.json.project.id;
  assert.equal((await outsider.client.api('DELETE', `/api/projects/${id}`)).status, 200);
  // Access middleware hides the now-missing project (no existence oracle).
  assert.equal((await outsider.client.api('DELETE', `/api/projects/${id}`)).status, 403);
});

test('GET /api/projects lists the caller projects across workspaces', async () => {
  const res = await admin.client.api('GET', '/api/projects');
  assert.equal(res.status, 200);
  const theirs = res.json.projects.filter((p) => p.workspace_id === workspaceId);
  assert.ok(theirs.length >= 1, 'lists projects in the admin workspace');
  const def = theirs.find((p) => p.name === 'Default Project');
  assert.ok(def, 'includes the Default Project');
  assert.equal(def.can_access, true);
  assert.equal(typeof def.workspace_name, 'string');
});

test('GET /api/projects hides projects from workspaces the caller cannot read', async () => {
  const res = await outsider.client.api('GET', '/api/projects');
  assert.equal(res.status, 200);
  assert.ok(
    !res.json.projects.some((p) => p.workspace_id === workspaceId),
    'outsider does not see another org workspace projects'
  );
});

