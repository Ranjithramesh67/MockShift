'use strict';

// Platform superadmin + org analytics endpoints, and the platform-admin
// entitlement bypass. See db/migrations/060_creator_attribution.sql.

// db.js reads PGPORT; harness.cjs reads INTEGRATION_PGPORT. Mirror so the app
// pool and the psql migrations target the same scratch instance.
if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let admin; // first-ever user -> global users.role = 'ADMIN'
let outsider; // plain org user
let adminOrgId;
let adminWorkspaceId;
let outsiderWorkspaceId;
let mockServerId;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  // First-ever signup consumes the bootstrap platform-ADMIN slot.
  admin = await signupAndLogin(base, 'sa-admin@gmail.com', 'adminpass123', 'Platform Admin');
  outsider = await signupAndLogin(base, 'sa-outsider@yahoo.com', 'outpass123', 'Outsider');

  const adminOrgs = await admin.client.api('GET', '/api/orgs');
  assert.equal(adminOrgs.status, 200);
  adminOrgId = adminOrgs.json.organizations[0].id;

  const adminWs = await admin.client.api('GET', '/api/workspaces');
  adminWorkspaceId = (adminWs.json.workspaces || [])[0].id;

  const outsiderWs = await outsider.client.api('GET', '/api/workspaces');
  outsiderWorkspaceId = (outsiderWs.json.workspaces || [])[0].id;

  // Attribution: admin creates a collection and a mock server.
  const col = await admin.client.api('POST', '/api/collections', {
    workspaceId: adminWorkspaceId,
    name: `SA Collection ${Date.now()}`,
  });
  assert.equal(col.status, 201);

  const projects = await admin.client.api('GET', '/api/projects');
  const projectId = (projects.json.projects || []).find((p) => p.workspace_id === adminWorkspaceId)?.id;
  assert.ok(projectId, 'admin should have a project in their workspace');

  const mock = await admin.client.api('POST', `/api/projects/${projectId}/mock-server`, {
    name: 'SA Mock',
  });
  assert.equal(mock.status, 201);
  mockServerId = mock.json.mockServer.id;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('platform overview is readable by a global admin', async () => {
  const res = await admin.client.api('GET', '/api/platform/overview');
  assert.equal(res.status, 200);
  assert.equal(res.json.scope, 'all');
  assert.ok(res.json.counts.organizations >= 2);
  assert.ok(res.json.counts.collections >= 1);
  assert.ok(res.json.counts.mock_servers >= 1);
});

test('platform organizations lists every org with counts', async () => {
  const res = await admin.client.api('GET', '/api/platform/organizations');
  assert.equal(res.status, 200);
  const org = res.json.organizations.find((o) => o.id === adminOrgId);
  assert.ok(org, 'admin org must be listed');
  assert.ok(org.projects >= 1);
  assert.ok(org.collections >= 1);
  assert.ok(org.mock_servers >= 1);
});

test('platform mock-servers lists all servers with their creator', async () => {
  const res = await admin.client.api('GET', '/api/platform/mock-servers?active=true');
  assert.equal(res.status, 200);
  const server = res.json.mockServers.find((s) => s.id === mockServerId);
  assert.ok(server, 'created mock server must be listed');
  assert.equal(server.created_by, admin.id);
  assert.equal(server.created_by_name, 'Platform Admin');
  assert.equal(server.organization_id, adminOrgId);
});

test('platform endpoints are forbidden to a non-admin', async () => {
  for (const path of ['/api/platform/overview', '/api/platform/organizations', '/api/platform/mock-servers']) {
    const res = await outsider.client.api('GET', path);
    assert.equal(res.status, 403, `${path} must be 403`);
  }
});

test('org analytics summary is readable by a global admin', async () => {
  const res = await admin.client.api('GET', `/api/orgs/${adminOrgId}/analytics`);
  assert.equal(res.status, 200);
  assert.equal(res.json.orgId, adminOrgId);
  assert.ok(res.json.summary.collections >= 1);
  assert.ok(res.json.summary.mock_servers >= 1);
  assert.ok(Array.isArray(res.json.mostTriggered));
  assert.ok(Array.isArray(res.json.runTrend));
});

test('org analytics member leaderboard credits the creator', async () => {
  const res = await admin.client.api('GET', `/api/orgs/${adminOrgId}/analytics/members`);
  assert.equal(res.status, 200);
  const me = res.json.members.find((m) => m.user_id === admin.id);
  assert.ok(me, 'admin must appear in the leaderboard');
  assert.ok(me.collections_created >= 1);
  assert.ok(me.mock_servers_created >= 1);
  assert.ok(me.workspaces_created >= 1);

  // The leaderboard must be scoped to the requested org: a user from another
  // org must never leak in, and the row count must match the summary members.
  assert.ok(
    res.json.members.every((m) => m.user_id !== outsider.id),
    'members from other orgs must not appear'
  );
  const summary = await admin.client.api('GET', `/api/orgs/${adminOrgId}/analytics`);
  assert.equal(res.json.members.length, summary.json.summary.members);
});

test('org analytics is forbidden to a non-member', async () => {
  const res = await outsider.client.api('GET', `/api/orgs/${adminOrgId}/analytics`);
  assert.equal(res.status, 403);
});

test('platform admin bypasses plan limits while a free user does not', async () => {
  // Re-enable enforcement (the harness disables it globally by default).
  psql('UPDATE portal_settings SET restrictions_enforced = true;');
  try {
    const freeLimit = await outsider.client.api('POST', '/api/workspaces', {
      organizationId: (await outsider.client.api('GET', '/api/orgs')).json.organizations[0].id,
      name: `Outsider Over Limit ${Date.now()}`,
    });
    assert.equal(freeLimit.status, 403);
    assert.equal(freeLimit.json.code, 'plan_limit');

    const adminSecond = await admin.client.api('POST', '/api/workspaces', {
      organizationId: adminOrgId,
      name: `Admin Over Limit ${Date.now()}`,
    });
    assert.equal(adminSecond.status, 201);
  } finally {
    psql('UPDATE portal_settings SET restrictions_enforced = false;');
  }
});
