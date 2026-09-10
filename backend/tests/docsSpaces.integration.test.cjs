'use strict';

// Doc spaces + sibling ordering (DR4 remainder, migration 030):
//   - doc_pages.team_id: an optional team ("space") binding. A bound team must
//     belong to the workspace's owning organization; children inherit the
//     parent's binding unless overridden.
//   - doc_pages.position: append-on-create sibling order within
//     (workspace_id, parent_id); PUT can reorder or clear the team binding.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlScalar(sql) {
  const out = execFileSync('psql', ['-q', '-t', '-A', '-d', process.env.INTEGRATION_PGDATABASE || 'apihub', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return out.trim();
}

let server;
let base;

function makeClient() {
  let cookie = '';
  async function api(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api, get cookie() { return cookie; } };
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'docspaceadmin@test.io',
    password: 'adminpass123',
    name: 'Doc Space Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

const ADMIN_EMAIL = 'docspaceadmin@test.io';

function adminId() {
  return psqlScalar(`SELECT id FROM users WHERE email = '${ADMIN_EMAIL}'`);
}

function adminOrgId() {
  return psqlScalar(
    `SELECT om.org_id FROM organization_members om
      WHERE om.user_id = '${adminId()}' AND om.role = 'ADMIN' LIMIT 1`
  );
}

async function adminWorkspaceId() {
  const admin = globalThis.__admin;
  const ws = await admin.api('GET', '/api/workspaces');
  return ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
}

async function createDoc({ workspaceId, title, visibility, parentId, teamId }) {
  const admin = globalThis.__admin;
  return admin.api('POST', '/api/docs', {
    workspaceId: workspaceId || (await adminWorkspaceId()),
    title,
    visibility,
    parentId,
    teamId,
  });
}

function makeTeam(name, orgId) {
  return psqlScalar(
    `INSERT INTO teams (name, organization_id) VALUES ('${name}', '${orgId}') RETURNING id`
  );
}

function otherOrgId() {
  return psqlScalar(
    `INSERT INTO organizations (name, owner_id)
     VALUES ('Other Space Org', '${adminId()}') RETURNING id`
  );
}

test('a page binds to a team ("space") and siblings append in order', async () => {
  const wsId = await adminWorkspaceId();
  const teamId = makeTeam('Platform Space', adminOrgId());

  const first = await createDoc({ title: 'Space home', workspaceId: wsId, teamId });
  assert.equal(first.status, 201);
  assert.equal(first.json.page.teamId, teamId);
  assert.equal(first.json.page.teamName, 'Platform Space');
  assert.equal(first.json.page.position, 0, 'first root appends at position 0');

  const second = await createDoc({ title: 'Space second', workspaceId: wsId, teamId });
  assert.equal(second.json.page.position, 1, 'next root appends after the existing sibling');

  const list = await adminWorkspaceId().then((id) =>
    globalThis.__admin.api('GET', `/api/docs?workspaceId=${id}`)
  );
  const byId = (id) => list.json.pages.find((p) => p.id === id);
  assert.equal(byId(first.json.page.id).teamId, teamId);
  assert.equal(byId(first.json.page.id).teamName, 'Platform Space');
  assert.equal(byId(second.json.page.id).position, 1, 'list rows carry position/team');
});

test('a team from another organization is rejected', async () => {
  const wsId = await adminWorkspaceId();
  const foreignTeam = makeTeam('Foreign Space', otherOrgId());

  const rejected = await createDoc({ title: 'Foreign space doc', workspaceId: wsId, teamId: foreignTeam });
  assert.equal(rejected.status, 400);
  assert.ok(/Team must belong/.test(rejected.json.error));

  const malformed = await createDoc({ title: 'Bad team id', workspaceId: wsId, teamId: 'not-a-uuid' });
  assert.equal(malformed.status, 400);
});

test('children inherit the parent team and append under it', async () => {
  const wsId = await adminWorkspaceId();
  const teamId = makeTeam('Inherit Space', adminOrgId());

  const root = await createDoc({ title: 'Inherit root', workspaceId: wsId, teamId });
  const childA = await createDoc({ title: 'Inherit child A', parentId: root.json.page.id, workspaceId: wsId });
  assert.equal(childA.json.page.teamId, teamId, 'child inherits the parent team binding');
  assert.equal(childA.json.page.position, 0, 'first child appends at position 0');

  const childB = await createDoc({ title: 'Inherit child B', parentId: root.json.page.id, workspaceId: wsId });
  assert.equal(childB.json.page.position, 1, 'second child appends under the same parent');

  const override = await createDoc({
    title: 'Inherit child override',
    parentId: root.json.page.id,
    workspaceId: wsId,
    teamId,
  });
  assert.equal(override.json.page.teamId, teamId);
});

test('PUT reorders siblings and can clear the team binding', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();
  const teamId = makeTeam('Reorder Space', adminOrgId());

  const a = await createDoc({ title: 'Order A', workspaceId: wsId, teamId });
  const b = await createDoc({ title: 'Order B', workspaceId: wsId, teamId });
  assert.equal(b.json.page.position, a.json.page.position + 1, 'siblings append in order');

  const swap = await admin.api('PUT', `/api/docs/${b.json.page.id}`, { position: a.json.page.position });
  assert.equal(swap.status, 200);
  assert.equal(swap.json.page.position, a.json.page.position, 'position can be set to reorder');

  const cleared = await admin.api('PUT', `/api/docs/${a.json.page.id}`, { teamId: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.page.teamId, null, 'teamId null clears the space binding');

  const badPosition = await admin.api('PUT', `/api/docs/${a.json.page.id}`, { position: -1 });
  assert.equal(badPosition.status, 400, 'negative positions are rejected');

  const foreignTeam = makeTeam('Foreign Reorder', otherOrgId());
  const badTeam = await admin.api('PUT', `/api/docs/${a.json.page.id}`, { teamId: foreignTeam });
  assert.equal(badTeam.status, 400, 'cannot move a page into a foreign organization team');
});

test('reparenting without an explicit position appends to the new siblings', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const parentA = await createDoc({ title: 'Move parent A', workspaceId: wsId });
  const parentB = await createDoc({ title: 'Move parent B', workspaceId: wsId });
  await createDoc({ title: 'Existing B child', parentId: parentB.json.page.id, workspaceId: wsId });
  const mover = await createDoc({ title: 'Mover', parentId: parentA.json.page.id, workspaceId: wsId });
  assert.equal(mover.json.page.position, 0);

  const moved = await admin.api('PUT', `/api/docs/${mover.json.page.id}`, {
    parentId: parentB.json.page.id,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.page.parentId, parentB.json.page.id);
  assert.equal(moved.json.page.position, 1, 'reparent appends after existing siblings');
});
