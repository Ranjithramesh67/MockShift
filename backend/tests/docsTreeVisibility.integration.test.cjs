'use strict';

// Doc visibility + document tree (DR3/DR4 groundwork, migration 029):
//   - doc_pages.visibility (PRIVATE default / PUBLIC): a PUBLIC page is
//     readable by every member of the owning organization (in addition to the
//     usual workspace readers / share audiences / platform MANAGER/ADMIN);
//     anonymous access still only arrives through a public share token.
//   - doc_pages.parent_id self-FK: children must share their parent's
//     workspace, nesting is capped at MAX_TREE_DEPTH (24), reparenting cannot
//     create a cycle, and deleting a root cascades to its sub-tree.
//   - read resolution walks the parent chain, so a targeted share on an
//     ancestor (or its PUBLIC visibility) opens the whole sub-tree; GET
//     /docs/shared surfaces pages readable without workspace membership.

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
  // The fresh test org is on the default (free) plan whose creation gates and
  // the public-link plan gate would otherwise restrict this suite; the docs
  // share-audience suite flips the master switch for the same reason.
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
    email: 'doctreeadmin@test.io',
    password: 'adminpass123',
    name: 'Doc Tree Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

async function signupUser(email, name) {
  const client = makeClient();
  const res = await client.api('POST', '/api/auth/signup', {
    email,
    password: 'userpass123',
    name,
  });
  assert.equal(res.status, 201, `signup ${email}`);
  return client;
}

const ADMIN_EMAIL = 'doctreeadmin@test.io';

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

async function createDoc({ workspaceId, title, visibility, parentId }) {
  const admin = globalThis.__admin;
  const created = await admin.api('POST', '/api/docs', {
    workspaceId: workspaceId || (await adminWorkspaceId()),
    title,
    visibility,
    parentId,
  });
  return created;
}

function addOrgMember(email, role = 'VIEWER') {
  const userId = psqlScalar(`SELECT id FROM users WHERE email = '${email}'`);
  psqlRun(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES ('${adminOrgId()}', '${userId}', '${role}')`
  );
  return userId;
}

function makeSecondWorkspace() {
  return psqlScalar(
    `INSERT INTO workspaces (name, organization_id)
     VALUES ('Second Docs WS', '${adminOrgId()}')
     RETURNING id`
  );
}

test('visibility defaults to PRIVATE, round-trips, and filters the list', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const priv = await createDoc({ title: 'V-default', workspaceId: wsId });
  assert.equal(priv.status, 201);
  assert.equal(priv.json.page.visibility, 'PRIVATE');
  assert.equal(priv.json.page.parentId, null);

  const pub = await createDoc({ title: 'V-public', visibility: 'PUBLIC', workspaceId: wsId });
  assert.equal(pub.status, 201);
  assert.equal(pub.json.page.visibility, 'PUBLIC');

  const bad = await createDoc({ title: 'V-bad', visibility: 'SECRET', workspaceId: wsId });
  assert.equal(bad.status, 400, 'unknown visibility is rejected');

  const list = await admin.api('GET', `/api/docs?workspaceId=${wsId}`);
  const byId = (id) => list.json.pages.find((p) => p.id === id);
  assert.equal(byId(priv.json.page.id).visibility, 'PRIVATE');
  assert.equal(byId(pub.json.page.id).visibility, 'PUBLIC');
  assert.ok('parentId' in byId(priv.json.page.id), 'list rows carry parentId');

  const onlyPub = await admin.api('GET', `/api/docs?workspaceId=${wsId}&visibility=PUBLIC`);
  assert.ok(onlyPub.json.pages.every((p) => p.visibility === 'PUBLIC'));
  assert.ok(onlyPub.json.pages.some((p) => p.id === pub.json.page.id));
  assert.ok(!onlyPub.json.pages.some((p) => p.id === priv.json.page.id));

  const invalid = await admin.api('GET', `/api/docs?workspaceId=${wsId}&visibility=MEH`);
  assert.equal(invalid.status, 400, 'invalid visibility filter is rejected');

  const toggled = await admin.api('PUT', `/api/docs/${pub.json.page.id}`, { visibility: 'private' });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.json.page.visibility, 'PRIVATE', 'PUBLIC can be toggled back to PRIVATE');
});

test('PUBLIC pages are readable by owning-org members; PRIVATE pages are not', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const pubPage = await createDoc({ title: 'Org open page', visibility: 'PUBLIC', workspaceId: wsId });
  const privPage = await createDoc({ title: 'Org closed page', workspaceId: wsId });

  const eve = await signupUser('eve-orgv@test.io', 'Eve Org Viewer');
  addOrgMember('eve-orgv@test.io', 'VIEWER');
  const glen = await signupUser('glen-out@test.io', 'Glen Outsider');

  const eveBefore = await eve.api('GET', `/api/docs/${pubPage.json.page.id}`);
  assert.equal(eveBefore.status, 200, 'org member reads a PUBLIC page without a workspace row');
  assert.equal(eveBefore.json.page.canEdit, false, 'PUBLIC visibility is read-only');
  assert.equal(eveBefore.json.page.visibility, 'PUBLIC');

  const evePriv = await eve.api('GET', `/api/docs/${privPage.json.page.id}`);
  assert.equal(evePriv.status, 404, 'org member cannot read a PRIVATE page without workspace access');

  const glenPub = await glen.api('GET', `/api/docs/${pubPage.json.page.id}`);
  assert.equal(glenPub.status, 404, 'a different organization cannot read a PUBLIC page');

  const shared = await eve.api('GET', '/api/docs/shared');
  assert.ok(shared.json.pages.some((p) => p.id === pubPage.json.page.id), 'PUBLIC org page appears in /shared');
  assert.ok(!shared.json.pages.some((p) => p.id === privPage.json.page.id), 'PRIVATE page never appears in /shared');

  const adminRead = await admin.api('GET', `/api/docs/${pubPage.json.page.id}`);
  assert.equal(adminRead.status, 200);
  assert.equal(adminRead.json.page.canEdit, true, 'workspace editor still edits a PUBLIC page');
});

test('a targeted share on an ancestor covers the sub-tree and populates /shared', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const root = await createDoc({ title: 'Tree root', workspaceId: wsId });
  const child = await createDoc({ title: 'Tree child', parentId: root.json.page.id, workspaceId: wsId });
  assert.equal(child.status, 201);
  assert.equal(child.json.page.parentId, root.json.page.id);
  const grand = await createDoc({ title: 'Tree grand', parentId: child.json.page.id, workspaceId: wsId });
  assert.equal(grand.json.page.parentId, child.json.page.id);

  const fay = await signupUser('fay-shared@test.io', 'Fay Shared');
  const denied = await fay.api('GET', `/api/docs/${grand.json.page.id}`);
  assert.equal(denied.status, 404, 'not readable before the share');

  const shared = await admin.api('POST', `/api/docs/${root.json.page.id}/shares`, {
    kind: 'user',
    targetUser: { email: 'fay-shared@test.io' },
  });
  assert.equal(shared.status, 201);

  for (const id of [root.json.page.id, child.json.page.id, grand.json.page.id]) {
    const read = await fay.api('GET', `/api/docs/${id}`);
    assert.equal(read.status, 200, `shared root exposes sub-tree page ${id}`);
    assert.equal(read.json.page.canEdit, false);
  }

  const sharedList = await fay.api('GET', '/api/docs/shared');
  const ids = sharedList.json.pages.map((p) => p.id);
  for (const id of [root.json.page.id, child.json.page.id, grand.json.page.id]) {
    assert.ok(ids.includes(id), `descendant ${id} listed in /shared`);
  }
});

test('create under a parent enforces same-workspace and the depth boundary', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const crossWs = makeSecondWorkspace();
  const ws2Root = await createDoc({ title: 'WS2 root', workspaceId: crossWs });
  assert.equal(ws2Root.status, 201);

  const crossWsChild = await createDoc({
    title: 'Cross-workspace child',
    workspaceId: wsId,
    parentId: ws2Root.json.page.id,
  });
  assert.equal(crossWsChild.status, 400, 'a child cannot live in a different workspace than its parent');

  const unknownParent = await createDoc({ title: 'Ghost child', workspaceId: wsId, parentId: cryptoUuid() });
  assert.equal(unknownParent.status, 404, 'an unknown parent is a 404');

  const badUuid = await createDoc({ title: 'Malformed child', workspaceId: wsId, parentId: 'not-a-uuid' });
  assert.equal(badUuid.status, 400, 'a malformed parentId is a 400');

  // Build a 24-deep chain directly (route guard caps create at depth MAX).
  psqlRun(
    `WITH RECURSIVE chain AS (
       SELECT gen_random_uuid() AS id, NULL::uuid AS parent_id, 1 AS d
       UNION ALL
       SELECT gen_random_uuid(), c.id, c.d + 1 FROM chain c WHERE c.d < 24
     )
     INSERT INTO doc_pages (id, workspace_id, title, created_by, parent_id)
     SELECT id, '${wsId}'::uuid, 'deep-' || d, '${adminId()}'::uuid, parent_id FROM chain`
  );
  const deep23 = psqlScalar(`SELECT id FROM doc_pages WHERE title = 'deep-23'`);
  const deep24 = psqlScalar(`SELECT id FROM doc_pages WHERE title = 'deep-24'`);

  const atLimit = await createDoc({ title: 'Deep child at 24', workspaceId: wsId, parentId: deep23 });
  assert.equal(atLimit.status, 201, 'a page at depth 24 is allowed');

  const overLimit = await createDoc({ title: 'Deep child at 25', workspaceId: wsId, parentId: deep24 });
  assert.equal(overLimit.status, 400, 'depth 25 is rejected');
  assert.ok(/Max nesting depth/.test(overLimit.json.error));

  // The depth-24 child still belongs to the tree and can be read/edited.
  const read = await admin.api('GET', `/api/docs/${atLimit.json.page.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.page.parentId, deep23);
});

test('PUT reparent moves pages and rejects cycles / self / cross-workspace', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const r1 = await createDoc({ title: 'R1', workspaceId: wsId });
  const r2 = await createDoc({ title: 'R2', workspaceId: wsId });
  const c1 = await createDoc({ title: 'C1', parentId: r1.json.page.id, workspaceId: wsId });
  assert.equal(c1.json.page.parentId, r1.json.page.id);

  const moved = await admin.api('PUT', `/api/docs/${c1.json.page.id}`, { parentId: r2.json.page.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.page.parentId, r2.json.page.id);

  const readMoved = await admin.api('GET', `/api/docs/${c1.json.page.id}`);
  assert.equal(readMoved.json.page.parentId, r2.json.page.id);

  const rooted = await admin.api('PUT', `/api/docs/${c1.json.page.id}`, { parentId: null });
  assert.equal(rooted.status, 200);
  assert.equal(rooted.json.page.parentId, null, 'parentId null returns the page to the root level');

  const selfParent = await admin.api('PUT', `/api/docs/${r1.json.page.id}`, { parentId: r1.json.page.id });
  assert.equal(selfParent.status, 400, 'a page cannot be its own parent');

  const crossWs = makeSecondWorkspace();
  const ws2Root = await createDoc({ title: 'WS2 move target', workspaceId: crossWs });
  const crossMove = await admin.api('PUT', `/api/docs/${r1.json.page.id}`, {
    parentId: ws2Root.json.page.id,
  });
  assert.equal(crossMove.status, 400, 'moving across workspaces is rejected');

  // Cycle: r3 -> d1 -> d2, then try to hang r3 under d2.
  const r3 = await createDoc({ title: 'R3', workspaceId: wsId });
  const d1 = await createDoc({ title: 'D1', parentId: r3.json.page.id, workspaceId: wsId });
  const d2 = await createDoc({ title: 'D2', parentId: d1.json.page.id, workspaceId: wsId });
  const cycle = await admin.api('PUT', `/api/docs/${r3.json.page.id}`, { parentId: d2.json.page.id });
  assert.equal(cycle.status, 400, 'reparenting under a descendant is rejected');
  assert.ok(/descendant/.test(cycle.json.error));

  const readAfter = await admin.api('GET', `/api/docs/${r3.json.page.id}`);
  assert.equal(readAfter.json.page.parentId, null, 'rejected reparent leaves the tree unchanged');

  const touch = await admin.api('PUT', `/api/docs/${r3.json.page.id}`, { title: 'R3 renamed' });
  assert.equal(touch.status, 200);
  assert.equal(touch.json.page.title, 'R3 renamed');
});

test('visibility is enforced per page, not inherited by sub-docs', async () => {
  const wsId = await adminWorkspaceId();
  const eve = await signupUser('eve-inherit@test.io', 'Eve Inherit');
  addOrgMember('eve-inherit@test.io', 'VIEWER');

  const pubParent = await createDoc({ title: 'Public parent', visibility: 'PUBLIC', workspaceId: wsId });
  const privChild = await createDoc({
    title: 'Private child under public',
    parentId: pubParent.json.page.id,
    workspaceId: wsId,
  });
  const pubChild = await createDoc({
    title: 'Public child under private',
    visibility: 'PUBLIC',
    parentId: privChild.json.page.id,
    workspaceId: wsId,
  });

  const readParent = await eve.api('GET', `/api/docs/${pubParent.json.page.id}`);
  assert.equal(readParent.status, 200, 'org viewer reads the PUBLIC parent');

  const readPrivChild = await eve.api('GET', `/api/docs/${privChild.json.page.id}`);
  assert.equal(readPrivChild.status, 404, 'a PRIVATE child stays closed even under a PUBLIC parent');

  const readPubChild = await eve.api('GET', `/api/docs/${pubChild.json.page.id}`);
  assert.equal(readPubChild.status, 200, 'a PUBLIC child opens to the org even under a PRIVATE parent');
  assert.equal(readPubChild.json.page.canEdit, false);
});

test('deleting a root page cascades through its sub-tree', async () => {
  const admin = globalThis.__admin;
  const wsId = await adminWorkspaceId();

  const root = await createDoc({ title: 'Cascade root', workspaceId: wsId });
  const child = await createDoc({ title: 'Cascade child', parentId: root.json.page.id, workspaceId: wsId });
  const grand = await createDoc({ title: 'Cascade grand', parentId: child.json.page.id, workspaceId: wsId });

  const del = await admin.api('DELETE', `/api/docs/${root.json.page.id}`);
  assert.equal(del.status, 204);

  for (const id of [child.json.page.id, grand.json.page.id]) {
    const read = await admin.api('GET', `/api/docs/${id}`);
    assert.equal(read.status, 404, `deleting the root removed descendant ${id}`);
  }
});

function cryptoUuid() {
  return '00000000-0000-4000-8000-000000000000';
}
