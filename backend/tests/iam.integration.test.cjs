'use strict';

// The shared harness replays migrations into INTEGRATION_PGPORT, but the app's
// db.js builds its pool from PGPORT. Mirror it (before requiring anything that
// loads db.js) so the app under test targets the scratch cluster rather than
// the dev database on 5432.
if (process.env.INTEGRATION_PGPORT) process.env.PGPORT = process.env.INTEGRATION_PGPORT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');
const { ALL_PERMISSION_KEYS } = require('../src/api/permissions');

let base;
let closeApp;
let owner;
let colleague;
let orgId;
let adminRoleId;
let viewerRoleId;
let customRoleId;

function sorted(list) {
  return [...list].sort();
}

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  // Same company domain => both land in one COMPANY org. The first signup is
  // the bootstrap platform ADMIN; the colleague joins as EDITOR (not admin).
  owner = await signupAndLogin(base, 'iam-owner@corp-iam.io', 'ownerpass123', 'IAM Owner');
  colleague = await signupAndLogin(
    base,
    'iam-colleague@corp-iam.io',
    'collabpass123',
    'IAM Colleague'
  );

  const orgs = await owner.client.api('GET', '/api/orgs');
  assert.equal(orgs.status, 200);
  orgId = orgs.json.organizations[0].id;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('any authenticated user can read the permission catalog', async () => {
  const res = await colleague.client.api('GET', '/api/permissions');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.json.groups.map((g) => g.key),
    ['org', 'project', 'workspace', 'team', 'content']
  );
  const keys = res.json.groups.flatMap((g) => g.permissions.map((p) => p.key));
  assert.deepEqual(sorted(keys), sorted(ALL_PERMISSION_KEYS));
});

test('GET /orgs reports membership role and admin flag', async () => {
  const ownerOrgs = await owner.client.api('GET', '/api/orgs');
  assert.equal(ownerOrgs.status, 200);
  const ownerOrg = ownerOrgs.json.organizations.find((o) => o.id === orgId);
  assert.equal(ownerOrg.role, 'ADMIN');
  assert.equal(ownerOrg.isAdmin, true);

  const colleagueOrgs = await colleague.client.api('GET', '/api/orgs');
  const colleagueOrg = colleagueOrgs.json.organizations.find((o) => o.id === orgId);
  assert.equal(colleagueOrg.role, 'EDITOR');
  assert.equal(colleagueOrg.isAdmin, false);
});

test('owner can list members and roles', async () => {
  const members = await owner.client.api('GET', `/api/orgs/${orgId}/members`);
  assert.equal(members.status, 200);
  assert.equal(members.json.members.length, 2);
  const ownerMember = members.json.members.find((m) => m.userId === owner.id);
  assert.equal(ownerMember.isOwner, true);
  assert.equal(ownerMember.legacyRole, 'ADMIN');
  assert.ok(ownerMember.roles.some((r) => r.systemKey === 'ADMIN' && r.isSystem));

  const roles = await owner.client.api('GET', `/api/orgs/${orgId}/roles`);
  assert.equal(roles.status, 200);
  const systemKeys = roles.json.roles
    .filter((r) => r.isSystem)
    .map((r) => r.systemKey)
    .sort();
  assert.deepEqual(systemKeys, ['ADMIN', 'EDITOR', 'MANAGER', 'SUPPORT', 'VIEWER']);
  const admin = roles.json.roles.find((r) => r.systemKey === 'ADMIN');
  adminRoleId = admin.id;
  assert.deepEqual(sorted(admin.permissions), sorted(ALL_PERMISSION_KEYS));
  assert.ok(!admin.permissions.includes('*'));
  viewerRoleId = roles.json.roles.find((r) => r.systemKey === 'VIEWER').id;
});

test('owner can create a custom role with a permission subset', async () => {
  const res = await owner.client.api('POST', `/api/orgs/${orgId}/roles`, {
    name: 'Auditor',
    description: 'Read plus audit',
    permissions: ['project.view', 'workspace.view', 'org.view_audit'],
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.role.name, 'Auditor');
  assert.equal(res.json.role.systemKey, null);
  assert.equal(res.json.role.isSystem, false);
  assert.deepEqual(
    sorted(res.json.role.permissions),
    sorted(['project.view', 'workspace.view', 'org.view_audit'])
  );
  customRoleId = res.json.role.id;
});

test('assigning the custom role makes the member see its permissions, not admin', async () => {
  const assign = await owner.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/${colleague.id}/roles`,
    { roleIds: [customRoleId] }
  );
  assert.equal(assign.status, 200);
  assert.equal(assign.json.roles.length, 1);
  assert.equal(assign.json.roles[0].id, customRoleId);

  const me = await colleague.client.api('GET', `/api/orgs/${orgId}/me/permissions`);
  assert.equal(me.status, 200);
  assert.deepEqual(
    sorted(me.json.permissions),
    sorted(['project.view', 'workspace.view', 'org.view_audit'])
  );
  assert.equal(me.json.roles.length, 1);
  assert.equal(me.json.roles[0].systemKey, null);
  assert.ok(!me.json.permissions.includes('org.manage_roles'));
  assert.ok(!me.json.permissions.includes('org.manage_members'));
});

test('a non-admin member gets 403 on role management', async () => {
  const create = await colleague.client.api('POST', `/api/orgs/${orgId}/roles`, {
    name: 'Nope',
    permissions: ['project.view'],
  });
  assert.equal(create.status, 403);
  assert.equal(create.json.error, 'Insufficient permissions');

  const assign = await colleague.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/${owner.id}/roles`,
    { roleIds: [viewerRoleId] }
  );
  assert.equal(assign.status, 403);
});

test('system roles cannot be modified or deleted', async () => {
  const patch = await owner.client.api('PATCH', `/api/orgs/${orgId}/roles/${adminRoleId}`, {
    name: 'Renamed Admin',
  });
  assert.equal(patch.status, 403);
  assert.equal(patch.json.error, 'System roles cannot be modified');

  const del = await owner.client.api('DELETE', `/api/orgs/${orgId}/roles/${adminRoleId}`);
  assert.equal(del.status, 400);
  assert.equal(del.json.error, 'System roles cannot be modified');
});

test("the owner's ADMIN role cannot be stripped", async () => {
  const res = await owner.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/${owner.id}/roles`,
    { roleIds: [viewerRoleId] }
  );
  assert.equal(res.status, 400);
  assert.match(res.json.error, /ADMIN/);

  const empty = await owner.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/${owner.id}/roles`,
    { roleIds: [] }
  );
  assert.equal(empty.status, 400);
});

test('role names are unique within an organization (case-insensitive)', async () => {
  const res = await owner.client.api('POST', `/api/orgs/${orgId}/roles`, {
    name: 'auditor',
    permissions: ['project.view'],
  });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /already exists/i);
});

test('assigning roles to a non-member returns 404', async () => {
  const res = await owner.client.api(
    'PUT',
    `/api/orgs/${orgId}/members/00000000-0000-0000-0000-000000000000/roles`,
    { roleIds: [] }
  );
  assert.equal(res.status, 404);
});
