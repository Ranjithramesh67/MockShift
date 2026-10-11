'use strict';

// MED-6 (verified intent) — PUBLIC workspace visibility is deliberately
// workspace-scoped: it makes the workspace (and workspace-scoped resources like
// environments) discoverable to every member of the owning organization, while
// the projects inside it keep their own access gate. This test pins that
// contract so a future change cannot silently expose project contents.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.close();
});

function one(sql) {
  const match = psql(sql).match(/^\s*([0-9a-f-]{36})\s*$/m);
  return match ? match[1] : null;
}

test('a PUBLIC workspace is readable by org members but its projects stay gated', async () => {
  const owner = await signupAndLogin(app.base, 'public-owner@test.io', 'publicowner123', 'Public Owner');
  const member = await signupAndLogin(app.base, 'public-member@test.io', 'publicmember123', 'Public Member');

  const orgId = one(`SELECT org_id FROM organization_members WHERE user_id = '${owner.id}' LIMIT 1`);
  assert.ok(orgId, 'owner must belong to an organization');
  psql(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES ('${orgId}', '${member.id}', 'VIEWER')`
  );

  const ownerWorkspaces = await owner.client.api('GET', '/api/workspaces');
  const workspaceId = ownerWorkspaces.json.workspaces.find((w) => w.name === 'My Workspace').id;
  const ownerContent = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = ownerContent.json.projects[0].id;

  psql(`UPDATE workspaces SET visibility = 'PUBLIC' WHERE id = '${workspaceId}'`);

  const memberWorkspaces = await member.client.api('GET', '/api/workspaces');
  assert.ok(
    memberWorkspaces.json.workspaces.some((w) => w.id === workspaceId),
    'org member must see the PUBLIC workspace'
  );

  const memberContent = await member.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(memberContent.status, 200, 'org member may read the PUBLIC workspace tree');
  assert.ok(memberContent.json.projects.length >= 1);
  assert.ok(
    memberContent.json.projects.every((p) => p.can_access === false),
    'projects inside a PUBLIC workspace must not be marked accessible to non-members'
  );
  assert.equal(memberContent.json.collections.length, 0, 'no project contents may leak');

  const memberWorkflows = await member.client.api('GET', `/api/workflows?projectId=${projectId}`);
  assert.equal(memberWorkflows.status, 403, 'project-level reads stay gated');
});
