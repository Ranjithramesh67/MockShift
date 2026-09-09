'use strict';

// Docs DR2 — share UI support backend:
//   - POST /docs/:pageId/shares notifies the new audience (direct user, every
//     team member, every org member), skipping the sharer, and only when a
//     grant is actually created (an idempotent re-share is silent).
//   - GET /docs/:pageId/shares returns a `context` with the page's owning
//     organization + its teams (share-modal target options).
//   - GET /docs/shared pages carry a `via` array (kind=user/team/org/public +
//     names) so the home "Shared with me" surface can group by team/org.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: process.env.INTEGRATION_PGHOST || '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', PGENV.PGDATABASE, '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', PGENV.PGDATABASE, '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlScalar(sql) {
  const out = execFileSync('psql', ['-q', '-t', '-A', '-d', PGENV.PGDATABASE, '-c', sql], {
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
      // no JSON body
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
  // Master restrictions switch off (public-link plan gate; doc creation gate).
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
    email: 'shareaudadmin@test.io',
    password: 'adminpass123',
    name: 'Share Audit Admin',
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

function userIdByEmail(email) {
  return psqlScalar(`SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
}

async function adminWorkspaceId() {
  const admin = globalThis.__admin;
  const ws = await admin.api('GET', '/api/workspaces');
  return ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
}

function adminOrgId() {
  const adminId = userIdByEmail('shareaudadmin@test.io');
  return psqlScalar(
    `SELECT om.org_id FROM organization_members om WHERE om.user_id = '${adminId}' AND om.role = 'ADMIN' LIMIT 1`
  );
}

function addOrgMember(email, role = 'VIEWER') {
  const userId = userIdByEmail(email);
  psqlRun(
    `INSERT INTO organization_members (org_id, user_id, role)
     VALUES ('${adminOrgId()}', '${userId}', '${role}')`
  );
  return userId;
}

function notificationCountFor(pageId) {
  return Number(
    psqlScalar(
      `SELECT count(*)::int FROM notifications WHERE link LIKE '/docs?p=${pageId}%'`
    )
  );
}

function notificationUsersFor(pageId) {
  const out = psqlScalar(
    `SELECT string_agg(u.email, ',' ORDER BY u.email) FROM notifications n
       JOIN users u ON u.id = n.user_id
      WHERE n.link LIKE '/docs?p=${pageId}%'`
  );
  return out ? out.split(',').sort() : [];
}

async function createDoc(title) {
  const admin = globalThis.__admin;
  const created = await admin.api('POST', '/api/docs', {
    workspaceId: await adminWorkspaceId(),
    title,
  });
  assert.equal(created.status, 201, `create doc ${title}`);
  return created.json.page;
}

test('shares context exposes the page org and its teams', async () => {
  const admin = globalThis.__admin;
  const page = await createDoc('Ctx page');

  const before = await admin.api('GET', `/api/docs/${page.id}/shares`);
  assert.equal(before.status, 200);
  assert.equal(before.json.context.organizationId, adminOrgId(), 'context org matches the page org');
  assert.ok(Array.isArray(before.json.context.teams));

  const created = await admin.api('POST', '/api/teams', { name: 'Platform Eng' });
  assert.equal(created.status, 201, 'team created');
  const teamId = created.json.team.id;

  const after = await admin.api('GET', `/api/docs/${page.id}/shares`);
  const names = after.json.context.teams.map((t) => t.name);
  assert.ok(names.includes('Platform Eng'), 'context teams lists the org team');
});

test('a direct user share notifies only the recipient (not the sharer)', async () => {
  const admin = globalThis.__admin;
  await signupUser('shareaud-bob@test.io', 'Bob Sharee');
  const page = await createDoc('Direct-share page');

  const res = await admin.api('POST', `/api/docs/${page.id}/shares`, {
    kind: 'user',
    targetUser: { email: 'shareaud-bob@test.io' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.share.kind, 'user');
  assert.equal(res.json.share.target.email, 'shareaud-bob@test.io');

  assert.equal(notificationCountFor(page.id), 1, 'exactly one notification row');
  assert.deepEqual(notificationUsersFor(page.id), ['shareaud-bob@test.io'], 'recipient notified, actor skipped');

  // Idempotent re-share of the same grant must not duplicate notifications.
  const again = await admin.api('POST', `/api/docs/${page.id}/shares`, {
    kind: 'user',
    targetUser: { email: 'shareaud-bob@test.io' },
  });
  assert.equal(again.status, 200, 'idempotent re-share returns 200');
  assert.equal(notificationCountFor(page.id), 1, 're-share is silent');
});

test('a team share notifies every team member except the sharer', async () => {
  const admin = globalThis.__admin;
  await signupUser('shareaud-ana@test.io', 'Ana');
  await signupUser('shareaud-ira@test.io', 'Ira');
  const page = await createDoc('Team-share page');

  const team = await admin.api('POST', '/api/teams', { name: 'Docs QA' });
  const teamId = team.json.team.id;
  for (const email of ['shareaud-ana@test.io', 'shareaud-ira@test.io']) {
    const add = await admin.api('POST', `/api/teams/${teamId}/members`, { email, role: 'VIEWER' });
    assert.equal(add.status, 201, `add ${email} to team`);
  }

  const res = await admin.api('POST', `/api/docs/${page.id}/shares`, { kind: 'team', teamId });
  assert.equal(res.status, 201);
  assert.equal(res.json.share.kind, 'team');

  assert.deepEqual(
    notificationUsersFor(page.id).sort(),
    ['shareaud-ana@test.io', 'shareaud-ira@test.io'].sort(),
    'both team members notified, sharer skipped'
  );
});

test('an org share notifies org members and via carries the org label', async () => {
  const admin = globalThis.__admin;
  await signupUser('shareaud-carl@test.io', 'Carl Org');
  addOrgMember('shareaud-carl@test.io', 'VIEWER');
  const page = await createDoc('Org-share page');

  const res = await admin.api('POST', `/api/docs/${page.id}/shares`, { kind: 'org' });
  assert.equal(res.status, 201);
  assert.equal(res.json.share.kind, 'org');

  assert.ok(notificationUsersFor(page.id).includes('shareaud-carl@test.io'), 'org member notified');

  // via on /docs/shared: Carl sees the page grouped under the org.
  const carl = makeClient();
  const login = await carl.api('POST', '/api/auth/login', {
    email: 'shareaud-carl@test.io',
    password: 'userpass123',
  });
  assert.equal(login.status, 200);
  const shared = await carl.api('GET', '/api/docs/shared');
  const found = shared.json.pages.find((p) => p.id === page.id);
  assert.ok(found, 'shared feed surfaces the page');
  assert.ok(found.via.some((v) => v.kind === 'org' && v.id === adminOrgId() && v.name), 'via lists the org with a name');
});

test('a team member sees the shared sub-tree with via=team', async () => {
  const admin = globalThis.__admin;
  await signupUser('shareaud-leo@test.io', 'Leo Tree');
  addOrgMember('shareaud-leo@test.io', 'VIEWER');
  const root = await createDoc('Team root for leo');

  const team = await admin.api('POST', '/api/teams', { name: 'Docs Tree Team' });
  const teamId = team.json.team.id;
  const add = await admin.api('POST', `/api/teams/${teamId}/members`, { email: 'shareaud-leo@test.io', role: 'VIEWER' });
  assert.equal(add.status, 201);

  const child = await admin.api('POST', '/api/docs', {
    workspaceId: root.workspaceId,
    parentId: root.id,
    title: 'Leo child page',
  });
  assert.equal(child.status, 201);

  const res = await admin.api('POST', `/api/docs/${root.id}/shares`, { kind: 'team', teamId });
  assert.equal(res.status, 201);

  const leo = makeClient();
  const login = await leo.api('POST', '/api/auth/login', { email: 'shareaud-leo@test.io', password: 'userpass123' });
  assert.equal(login.status, 200);
  const shared = await leo.api('GET', '/api/docs/shared');
  const teamVia = { kind: 'team', id: teamId };
  const hasRoot = shared.json.pages.find((p) => p.id === root.id);
  const hasChild = shared.json.pages.find((p) => p.id === child.json.page.id);
  assert.ok(hasRoot && hasChild, 'root + sub-page both surface');
  assert.ok(hasRoot.via.some((v) => v.kind === 'team' && v.id === teamId), 'root via lists the team');
  assert.ok(hasChild.via.some((v) => v.kind === 'team' && v.id === teamId), 'sub-page inherits the team via');
});

test('a PUBLIC page surfaces via kind=public with the owning org name', async () => {
  const admin = globalThis.__admin;
  await signupUser('shareaud-nora@test.io', 'Nora Org');
  addOrgMember('shareaud-nora@test.io', 'VIEWER');
  const page = await createDoc('Public-for-nora');
  const madePub = await admin.api('PUT', `/api/docs/${page.id}`, { visibility: 'PUBLIC' });
  assert.equal(madePub.status, 200);

  const nora = makeClient();
  const login = await nora.api('POST', '/api/auth/login', { email: 'shareaud-nora@test.io', password: 'userpass123' });
  assert.equal(login.status, 200);
  const shared = await nora.api('GET', '/api/docs/shared');
  const found = shared.json.pages.find((p) => p.id === page.id);
  assert.ok(found, 'PUBLIC page is shared with org members');
  const via = found.via.find((v) => v.kind === 'public');
  assert.ok(via && via.name, 'via kind=public carries the org name');
});
