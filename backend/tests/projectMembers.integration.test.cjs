'use strict';

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

async function defaultProjectId(client) {
  const list = await client.api('GET', '/api/workspaces');
  assert.equal(list.status, 200);
  const ws = list.json.workspaces[0];
  const tree = await client.api('GET', `/api/workspaces/${ws.id}/content`);
  assert.equal(tree.status, 200);
  return tree.json.projects[0].id;
}

test('default-project owner cannot add or remove themselves', async () => {
  const owner = await signupAndLogin(base, 'pm-owner@test.io', 'ownerpass123', 'Owner');
  const projectId = await defaultProjectId(owner.client);

  const overview = await owner.client.api('GET', `/api/projects/${projectId}/overview`);
  assert.equal(overview.status, 200);
  assert.equal(overview.json.canManage, true);

  const addSelf = await owner.client.api('POST', `/api/projects/${projectId}/members`, {
    userId: owner.id,
    role: 'EDITOR',
  });
  assert.equal(addSelf.status, 400);

  const removeSelf = await owner.client.api(
    'DELETE',
    `/api/projects/${projectId}/members/${owner.id}`
  );
  assert.equal(removeSelf.status, 400);
});

test('the signed-in user is excluded from the add-member picker', async () => {
  const owner = await signupAndLogin(base, 'pm-owner-2@test.io', 'ownerpass123', 'Owner Two');
  const projectId = await defaultProjectId(owner.client);

  const orgUsers = await owner.client.api('GET', `/api/projects/${projectId}/org-users`);
  assert.equal(orgUsers.status, 200);
  assert.ok(!orgUsers.json.users.some((u) => u.id === owner.id));
});

test('a project manager can still add and remove another org member', async () => {
  const owner = await signupAndLogin(base, 'pm-a@corp-members.io', 'ownerpass123', 'Owner A');
  const colleague = await signupAndLogin(
    base,
    'pm-b@corp-members.io',
    'collabpass123',
    'Colleague B'
  );
  const projectId = await defaultProjectId(owner.client);

  const orgUsers = await owner.client.api('GET', `/api/projects/${projectId}/org-users`);
  assert.equal(orgUsers.status, 200);
  assert.ok(orgUsers.json.users.some((u) => u.id === colleague.id));

  const add = await owner.client.api('POST', `/api/projects/${projectId}/members`, {
    userId: colleague.id,
    role: 'VIEWER',
  });
  assert.equal(add.status, 200);

  const remove = await owner.client.api(
    'DELETE',
    `/api/projects/${projectId}/members/${colleague.id}`
  );
  assert.equal(remove.status, 200);
});
