'use strict';

// MED-2 — GET /api/workspaces/:id/teams used to expose which teams a workspace
// is shared to any authenticated caller. It now requires workspace membership.

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

test('workspace team list is member-only', async () => {
  const owner = await signupAndLogin(base, 'wt-owner@test.io', 'ownerpass123', 'Owner');
  const stranger = await signupAndLogin(base, 'wt-stranger@test.io', 'strangerpass123', 'Stranger');

  const ws = await owner.client.api('POST', '/api/workspaces', { name: 'Team WS' });
  const wsId = ws.json.workspace.id;

  const mine = await owner.client.api('GET', `/api/workspaces/${wsId}/teams`);
  assert.equal(mine.status, 200);
  assert.ok(Array.isArray(mine.json.teams));

  const foreign = await stranger.client.api('GET', `/api/workspaces/${wsId}/teams`);
  assert.equal(foreign.status, 403);
});
