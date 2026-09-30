'use strict';

// Bug 4/5 — Workspace access must distinguish a per-person grant from a team
// share:
//   * an owner can add a specific person (workspace_members), independent of
//     any team;
//   * sharing the workspace with a team grants every current member;
//   * the effective role comes from the team SHARE role (workspace_teams.role),
//     not the member's role inside the team.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;

let owner;
let alice;
let bob;
let carol;
let stranger;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  owner = await signupAndLogin(base, 'wm-owner@test.io', 'ownerpass123', 'WM Owner');
  alice = await signupAndLogin(base, 'wm-alice@test.io', 'alicepass123', 'WM Alice');
  bob = await signupAndLogin(base, 'wm-bob@test.io', 'bobpass123', 'WM Bob');
  carol = await signupAndLogin(base, 'wm-carol@test.io', 'carolpass123', 'WM Carol');
  stranger = await signupAndLogin(base, 'wm-stranger@test.io', 'strangerpass123', 'WM Stranger');
});

after(async () => {
  if (closeApp) await closeApp();
});

async function makePrivateWorkspace(name) {
  const res = await owner.client.api('POST', '/api/workspaces', { name, visibility: 'PRIVATE' });
  assert.equal(res.status, 201, `create workspace: ${JSON.stringify(res.json)}`);
  return res.json.workspace.id;
}

async function visibleWorkspace(client, wsId) {
  const res = await client.api('GET', '/api/workspaces');
  assert.equal(res.status, 200);
  return (res.json.workspaces || []).find((w) => w.id === wsId);
}

test('owner can grant one specific person access, independent of teams', async () => {
  const wsId = await makePrivateWorkspace('WM Individual');

  assert.equal(await visibleWorkspace(alice.client, wsId), undefined, 'alice has no access yet');

  const add = await owner.client.api('POST', `/api/workspaces/${wsId}/members`, {
    email: 'wm-alice@test.io',
    role: 'EDITOR',
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));

  const list = await owner.client.api('GET', `/api/workspaces/${wsId}/members`);
  assert.equal(list.status, 200);
  assert.ok(
    list.json.members.some((m) => m.user_id === alice.id && m.role === 'EDITOR'),
    'alice listed as a direct member with the granted role'
  );

  const aliceWs = await visibleWorkspace(alice.client, wsId);
  assert.ok(aliceWs, 'alice now sees the individually shared workspace');
  assert.equal(aliceWs.role, 'EDITOR');
  assert.equal((await alice.client.api('GET', `/api/workspaces/${wsId}/content`)).status, 200);

  assert.equal(await visibleWorkspace(bob.client, wsId), undefined, 'bob was not added');

  const del = await owner.client.api('DELETE', `/api/workspaces/${wsId}/members/${alice.id}`);
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(await visibleWorkspace(alice.client, wsId), undefined, 'access revoked on removal');
  assert.equal((await alice.client.api('GET', `/api/workspaces/${wsId}/content`)).status, 403);
});

test('individual member management requires workspace admin', async () => {
  const wsId = await makePrivateWorkspace('WM Admin Guard');
  await owner.client.api('POST', `/api/workspaces/${wsId}/members`, {
    email: 'wm-carol@test.io',
    role: 'VIEWER',
  });

  const denied = await carol.client.api('POST', `/api/workspaces/${wsId}/members`, {
    email: 'wm-bob@test.io',
    role: 'EDITOR',
  });
  assert.equal(denied.status, 403, 'a VIEWER cannot add members');

  const list = await stranger.client.api('GET', `/api/workspaces/${wsId}/members`);
  assert.equal(list.status, 403, 'a non-member cannot list members');
});

test('team share grants every member and uses the team share role', async () => {
  const wsId = await makePrivateWorkspace('WM Team');

  const team = await owner.client.api('POST', '/api/teams', { name: 'WM Team A' });
  assert.equal(team.status, 201, JSON.stringify(team.json));
  const teamId = team.json.team.id;

  // Both members join the team as VIEWER.
  assert.equal(
    (await owner.client.api('POST', `/api/teams/${teamId}/members`, { email: 'wm-alice@test.io', role: 'VIEWER' })).status,
    201
  );
  assert.equal(
    (await owner.client.api('POST', `/api/teams/${teamId}/members`, { email: 'wm-bob@test.io', role: 'VIEWER' })).status,
    201
  );

  // Share the workspace with the team as EDITOR.
  const share = await owner.client.api('POST', `/api/workspaces/${wsId}/teams`, { teamId, role: 'EDITOR' });
  assert.equal(share.status, 201, JSON.stringify(share.json));

  for (const user of [alice, bob]) {
    const w = await visibleWorkspace(user.client, wsId);
    assert.ok(w, 'every team member sees the team-shared workspace');
    // Effective role must be the SHARE role (EDITOR), not the in-team role (VIEWER).
    assert.equal(w.role, 'EDITOR');
    assert.equal((await user.client.api('GET', `/api/workspaces/${wsId}/content`)).status, 200);
  }

  assert.equal(
    await visibleWorkspace(stranger.client, wsId),
    undefined,
    'a user in neither the team nor a direct grant sees nothing'
  );
});
