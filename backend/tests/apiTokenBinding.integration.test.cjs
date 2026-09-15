'use strict';

// Regression tests for HIGH-2: a project- or workspace-bound API token must
// not be usable against resources outside its binding. Before the fix the
// binding columns were stored but never consulted, so a bound token worked
// against any project/workspace in the same organization.

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

async function bearer(method, path, token, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function issueBoundToken(client, binding) {
  const res = await client.api('POST', '/api/tokens', {
    name: `bound-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    scopes: ['write'],
    ...binding,
  });
  assert.equal(res.status, 201, `issue bound token: ${JSON.stringify(res.json)}`);
  return res.json.token;
}

async function defaultProject(client) {
  const ws = await client.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const tree = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  return { workspaceId: myWs.id, projectId: tree.json.projects[0].id };
}

async function extraWorkspace(client, name) {
  const ws = await client.api('POST', '/api/workspaces', { name });
  assert.equal(ws.status, 201);
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  return { workspaceId: ws.json.workspace.id, projectId: tree.json.projects[0].id };
}

test('a project-bound token only works inside its project', async () => {
  const owner = await signupAndLogin(base, 'bind-project@test.io', 'bindpass123', 'Binder');
  const inside = await defaultProject(owner.client);
  const outside = await extraWorkspace(owner.client, 'Other WS');
  const token = await issueBoundToken(owner.client, { projectId: inside.projectId });

  const ok = await bearer('POST', '/api/collections', token, { projectId: inside.projectId, name: 'Inside' });
  assert.equal(ok.status, 201, `inside project should be allowed; got ${ok.status} ${JSON.stringify(ok.json)}`);

  const denied = await bearer('POST', '/api/collections', token, { projectId: outside.projectId, name: 'Outside' });
  assert.equal(denied.status, 403, `outside project must be denied; got ${denied.status}`);
});

test('a workspace-bound token only works inside its workspace', async () => {
  const owner = await signupAndLogin(base, 'bind-workspace@test.io', 'bindpass123', 'Binder');
  const inside = await extraWorkspace(owner.client, 'Bound WS');
  const outside = await defaultProject(owner.client);
  const token = await issueBoundToken(owner.client, { workspaceId: inside.workspaceId });

  const ok = await bearer('POST', '/api/collections', token, { projectId: inside.projectId, name: 'Inside' });
  assert.equal(ok.status, 201, `inside workspace should be allowed; got ${ok.status} ${JSON.stringify(ok.json)}`);

  const denied = await bearer('POST', '/api/collections', token, { projectId: outside.projectId, name: 'Outside' });
  assert.equal(denied.status, 403, `outside workspace must be denied; got ${denied.status}`);
});
