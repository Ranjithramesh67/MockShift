'use strict';

// DB-2 — a project can own several workspaces (057/058), but access fell back
// to the single legacy `projects.workspace_id` mirror. A member of a
// non-primary workspace was therefore denied the project unless they were also
// a project member. Access must derive from any workspace under the project.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

async function defaultWorkspaceAndProject(client) {
  const list = await client.api('GET', '/api/workspaces');
  assert.equal(list.status, 200);
  const workspace = list.json.workspaces[0];
  const tree = await client.api('GET', `/api/workspaces/${workspace.id}/content`);
  assert.equal(tree.status, 200);
  assert.equal(tree.json.projects.length, 1);
  return { workspace, project: tree.json.projects[0] };
}

async function secondWorkspace(owner, projectId, name) {
  const created = await owner.client.api('POST', `/api/projects/${projectId}/workspaces`, {
    name,
    visibility: 'PRIVATE',
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.workspace.id;
}

async function collectionInWorkspace(owner, projectId, workspaceId, name) {
  const collection = await owner.client.api('POST', '/api/collections', {
    projectId,
    workspaceId,
    name,
  });
  assert.equal(collection.status, 201, JSON.stringify(collection.json));
  return collection.json.collection.id;
}

function bearer(method, path, token, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  });
}

test('a member of a non-primary project workspace can read the project', async () => {
  const owner = await signupAndLogin(base, 'db2-owner@test.io', 'ownerpass123', 'Owner');
  const member = await signupAndLogin(base, 'db2-member@test.io', 'memberpass123', 'Member');

  const { project } = await defaultWorkspaceAndProject(owner.client);

  // Second workspace under the same project. The project's legacy
  // `workspace_id` mirror keeps pointing at the original workspace.
  const secondWorkspaceId = await secondWorkspace(owner, project.id, 'Second Workspace');

  const granted = await owner.client.api('POST', `/api/workspaces/${secondWorkspaceId}/members`, {
    userId: member.id,
    role: 'VIEWER',
  });
  assert.equal(granted.status, 201);

  // The member can read their own (non-primary) workspace …
  const ownTree = await member.client.api('GET', `/api/workspaces/${secondWorkspaceId}/content`);
  assert.equal(ownTree.status, 200);

  // … and therefore the project that owns it.
  const projectTree = await member.client.api('GET', `/api/projects/${project.id}/content`);
  assert.equal(projectTree.status, 200, JSON.stringify(projectTree.json));
  assert.ok(
    projectTree.json.workspaces.some((w) => w.id === secondWorkspaceId),
    'project content lists the member workspace'
  );

  // The project picker must surface the project too, flagged as accessible.
  const projects = await member.client.api('GET', '/api/projects');
  assert.equal(projects.status, 200);
  const row = projects.json.projects.find((p) => p.id === project.id);
  assert.ok(row, 'project appears in the global project list');
  assert.equal(row.can_access, true);
});

test('workspace membership does not leak a sibling workspace', async () => {
  const owner = await signupAndLogin(base, 'db2-owner2@test.io', 'ownerpass123', 'Owner Two');
  const member = await signupAndLogin(base, 'db2-member2@test.io', 'memberpass123', 'Member Two');

  const { workspace: primary, project } = await defaultWorkspaceAndProject(owner.client);
  const siblingId = await secondWorkspace(owner, project.id, 'Sibling Workspace');
  assert.equal(
    (await owner.client.api('POST', `/api/workspaces/${siblingId}/members`, {
      userId: member.id,
      role: 'VIEWER',
    })).status,
    201
  );

  // Project access flows through the sibling, but the primary workspace stays closed.
  const primaryTree = await member.client.api('GET', `/api/workspaces/${primary.id}/content`);
  assert.equal(primaryTree.status, 403);
});

test('the active environment of a non-primary workspace is used for runs', async () => {
  const owner = await signupAndLogin(base, 'db2-env-owner@test.io', 'ownerpass123', 'Env Owner');
  const member = await signupAndLogin(base, 'db2-env-member@test.io', 'memberpass123', 'Env Member');

  const { project } = await defaultWorkspaceAndProject(owner.client);
  const workspaceId = await secondWorkspace(owner, project.id, 'Env Workspace');
  const collectionId = await collectionInWorkspace(owner, project.id, workspaceId, 'Env Collection');

  const request = await owner.client.api('POST', '/api/requests', {
    collectionId,
    name: 'Uses workspace env',
    method: 'GET',
    url: 'http://127.0.0.1:1/{{segment}}',
  });
  assert.equal(request.status, 201, JSON.stringify(request.json));
  const requestId = request.json.request.id;

  const environment = await owner.client.api('POST', `/api/workspaces/${workspaceId}/environments`, {
    name: 'Workspace Env',
    makeActive: true,
  });
  assert.equal(environment.status, 201, JSON.stringify(environment.json));
  const variable = await owner.client.api(
    'POST',
    `/api/environments/${environment.json.environment.id}/variables`,
    { key: 'segment', value: 'resolved' }
  );
  assert.equal(variable.status, 201, JSON.stringify(variable.json));

  const granted = await owner.client.api('POST', `/api/workspaces/${workspaceId}/members`, {
    userId: member.id,
    role: 'EDITOR',
  });
  assert.equal(granted.status, 201);

  const run = await member.client.api('POST', `/api/requests/${requestId}/run`, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.requestSnapshot.url, 'http://127.0.0.1:1/resolved');
});

test('a workspace-bound token can run a request in that workspace', async () => {
  const owner = await signupAndLogin(base, 'db2-token-owner@test.io', 'ownerpass123', 'Token Owner');
  const { project } = await defaultWorkspaceAndProject(owner.client);
  const workspaceId = await secondWorkspace(owner, project.id, 'Token Workspace');
  const collectionId = await collectionInWorkspace(owner, project.id, workspaceId, 'Token Collection');

  const request = await owner.client.api('POST', '/api/requests', {
    collectionId,
    name: 'Token request',
    method: 'GET',
    url: 'http://127.0.0.1:1/token',
  });
  assert.equal(request.status, 201, JSON.stringify(request.json));

  const token = await owner.client.api('POST', '/api/tokens', {
    name: 'workspace-bound-run',
    scopes: ['runs'],
    workspaceId,
  });
  assert.equal(token.status, 201, JSON.stringify(token.json));

  const run = await bearer('POST', `/api/requests/${request.json.request.id}/run`, token.json.token, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));
});

test('a project-bound token keeps its project context on workspace paths', async () => {
  const owner = await signupAndLogin(base, 'db2-scope-owner@test.io', 'ownerpass123', 'Scope Owner');
  const { project } = await defaultWorkspaceAndProject(owner.client);
  const workspaceId = await secondWorkspace(owner, project.id, 'Scoped Workspace');
  const otherWorkspaceId = await secondWorkspace(owner, project.id, 'Other Scoped Workspace');

  const token = await owner.client.api('POST', '/api/tokens', {
    name: 'project-bound-read',
    scopes: ['read'],
    projectId: project.id,
  });
  assert.equal(token.status, 201, JSON.stringify(token.json));

  const allowed = await bearer('GET', `/api/workspaces/${workspaceId}/content`, token.json.token);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));

  // The sibling workspace belongs to the same project, so a project-bound
  // token may target it; an unbound check would make this a 403 purely from
  // the path resolver, not from the binding rule.
  const sibling = await bearer('GET', `/api/workspaces/${otherWorkspaceId}/content`, token.json.token);
  assert.equal(sibling.status, 200, JSON.stringify(sibling.json));
});
