'use strict';

// Doc share audiences (DR1): targeted sharing to users / org teams /
// organizations and the plan-gated public token link. doc_shares now stores
// one grant per target (kind=user/team/org/public). Targeted grants are
// read-only: recipients can GET the page (canEdit:false) but only the author
// or workspace editors may manage shares.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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
  // The fresh test org is on the default (free) plan which forbids public
  // links. Flip the master restrictions switch off so the public-link flow can
  // be exercised like a paid org; targeted-audience shares never hit the gate.
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
    email: 'docshareadmin@test.io',
    password: 'adminpass123',
    name: 'Doc Share Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
  globalThis.__anon = makeClient();
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

async function adminWorkspaceId() {
  const admin = globalThis.__admin;
  const ws = await admin.api('GET', '/api/workspaces');
  return ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
}

async function createDoc(title) {
  const admin = globalThis.__admin;
  const created = await admin.api('POST', '/api/docs', {
    workspaceId: await adminWorkspaceId(),
    title,
  });
  assert.equal(created.status, 201, `create doc ${title}`);
  return created.json.page.id;
}

function userIdByEmail(email) {
  return psqlScalar(`SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}'`);
}

function adminOrgId() {
  const adminId = userIdByEmail('docshareadmin@test.io');
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

test('share a doc to a specific user by email and username; revoke', async () => {
  const admin = globalThis.__admin;
  const pageId = await createDoc('User-shared page');
  const alice = await signupUser('alice-aud@test.io', 'Alice Aud');
  const mallory = await signupUser('mallory-aud@test.io', 'Mallory Aud');
  addOrgMember('alice-aud@test.io', 'VIEWER');

  const denied = await alice.api('GET', `/api/docs/${pageId}`);
  assert.equal(denied.status, 404, 'recipient cannot read before share');
  const outsider = await mallory.api('GET', `/api/docs/${pageId}`);
  assert.equal(outsider.status, 404, 'unrelated user cannot read');

  const shared = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'user',
    targetUser: { email: 'ALICE-AUD@test.io' },
  });
  assert.equal(shared.status, 201);
  assert.equal(shared.json.share.kind, 'user');
  assert.equal(shared.json.share.target.email, 'alice-aud@test.io');
  const shareId = shared.json.share.id;

  const again = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'user',
    targetUser: { email: 'alice-aud@test.io' },
  });
  assert.equal(again.status, 200, 'duplicate grant returns the existing share');
  assert.equal(again.json.share.id, shareId);

  const byUsername = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'user',
    targetUser: { username: psqlScalar(`SELECT username FROM users WHERE email = 'alice-aud@test.io'`) },
  });
  assert.equal(byUsername.status, 200, 'username resolves to the same user');
  assert.equal(byUsername.json.share.id, shareId);

  const unknown = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'user',
    targetUser: { email: 'nobody-aud@test.io' },
  });
  assert.equal(unknown.status, 400, 'unknown email is rejected');

  const badKind = await admin.api('POST', `/api/docs/${pageId}/shares`, { kind: 'planet' });
  assert.equal(badKind.status, 400, 'unknown audience kind is rejected');

  const read = await alice.api('GET', `/api/docs/${pageId}`);
  assert.equal(read.status, 200, 'recipient can read after share');
  assert.equal(read.json.page.title, 'User-shared page');
  assert.equal(read.json.page.canEdit, false, 'share grants read-only access');
  const outsiderAfter = await mallory.api('GET', `/api/docs/${pageId}`);
  assert.equal(outsiderAfter.status, 404, 'unrelated user still cannot read');

  const list = await admin.api('GET', `/api/docs/${pageId}/shares`);
  assert.equal(list.status, 200);
  assert.ok(list.json.shares.some((s) => s.id === shareId), 'grant appears in the share list');

  const revoked = await admin.api('DELETE', `/api/docs/${pageId}/shares/${shareId}`);
  assert.equal(revoked.status, 204);
  const afterRevoke = await alice.api('GET', `/api/docs/${pageId}`);
  assert.equal(afterRevoke.status, 404, 'recipient loses read access after revoke');
  const revokeMissing = await admin.api('DELETE', `/api/docs/${pageId}/shares/${shareId}`);
  assert.equal(revokeMissing.status, 404, 'revoking an absent share is a 404');
});

test('share a doc to an org team; only members gain read access', async () => {
  const admin = globalThis.__admin;
  const pageId = await createDoc('Team-shared page');
  const bob = await signupUser('bob-team@test.io', 'Bob Team');
  const carol = await signupUser('carol-team@test.io', 'Carol Team');

  const adminId = userIdByEmail('docshareadmin@test.io');
  const orgId = psqlScalar(
    `SELECT om.org_id FROM organization_members om WHERE om.user_id = '${adminId}' AND om.role = 'ADMIN' LIMIT 1`
  );
  const teamId = psqlScalar(
    `INSERT INTO teams (name, organization_id) VALUES ('Aud Team', '${orgId}') RETURNING id`
  );
  const bobId = userIdByEmail('bob-team@test.io');
  psqlRun(`INSERT INTO team_members (team_id, user_id, role) VALUES ('${teamId}', '${bobId}', 'EDITOR')`);

  const bobBefore = await bob.api('GET', `/api/docs/${pageId}`);
  assert.equal(bobBefore.status, 404);

  const shared = await admin.api('POST', `/api/docs/${pageId}/shares`, { kind: 'team', teamId });
  assert.equal(shared.status, 201);
  assert.equal(shared.json.share.target.id, teamId);
  const shareId = shared.json.share.id;

  const bobRead = await bob.api('GET', `/api/docs/${pageId}`);
  assert.equal(bobRead.status, 200, 'team member can read');
  assert.equal(bobRead.json.page.canEdit, false);

  const carolRead = await carol.api('GET', `/api/docs/${pageId}`);
  assert.equal(carolRead.status, 404, 'non-team user cannot read');

  const wrongOrgTeam = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'team',
    teamId: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(wrongOrgTeam.status, 400, 'team must belong to the doc org');

  await admin.api('DELETE', `/api/docs/${pageId}/shares/${shareId}`);
  const bobAfter = await bob.api('GET', `/api/docs/${pageId}`);
  assert.equal(bobAfter.status, 404, 'team member loses read after revoke');
});

test('share a doc to the owning organization; cross-org rejected', async () => {
  const admin = globalThis.__admin;
  const pageId = await createDoc('Org-shared page');
  const dave = await signupUser('dave-org@test.io', 'Dave Org');

  const adminId = userIdByEmail('docshareadmin@test.io');
  const orgId = psqlScalar(
    `SELECT om.org_id FROM organization_members om WHERE om.user_id = '${adminId}' AND om.role = 'ADMIN' LIMIT 1`
  );
  const daveId = userIdByEmail('dave-org@test.io');
  psqlRun(`INSERT INTO organization_members (org_id, user_id, role) VALUES ('${orgId}', '${daveId}', 'VIEWER')`);

  const daveBefore = await dave.api('GET', `/api/docs/${pageId}`);
  assert.equal(daveBefore.status, 404, 'plain org member cannot read a private workspace doc');

  const shared = await admin.api('POST', `/api/docs/${pageId}/shares`, { kind: 'org' });
  assert.equal(shared.status, 201, 'orgId defaults to the owning organization');
  assert.equal(shared.json.share.target.id, orgId);
  const shareId = shared.json.share.id;

  const daveRead = await dave.api('GET', `/api/docs/${pageId}`);
  assert.equal(daveRead.status, 200, 'org member can read after org share');
  assert.equal(daveRead.json.page.canEdit, false);

  const otherOrgId = psqlScalar(
    `SELECT om.org_id FROM organization_members om JOIN users u ON u.id = om.user_id
      WHERE u.email = 'dave-org@test.io' AND om.role = 'ADMIN' LIMIT 1`
  );
  const crossOrg = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'org',
    orgId: otherOrgId,
  });
  assert.equal(crossOrg.status, 400, 'a page can only be shared with its own organization');

  await admin.api('DELETE', `/api/docs/${pageId}/shares/${shareId}`);
  const daveAfter = await dave.api('GET', `/api/docs/${pageId}`);
  assert.equal(daveAfter.status, 404, 'org member loses read after revoke');
});

test('public share stays token-only and the legacy alias revokes only the link', async () => {
  const admin = globalThis.__admin;
  const anon = globalThis.__anon;
  const pageId = await createDoc('Public-shared page');
  const guest = await signupUser('guest-pub@test.io', 'Guest Pub');

  const created = await admin.api('POST', `/api/docs/${pageId}/share`);
  assert.equal(created.status, 201);
  assert.ok(created.json.share.token);
  const token = created.json.share.token;

  const createdAgain = await admin.api('POST', `/api/docs/${pageId}/share`);
  assert.equal(createdAgain.status, 200, 'public share creation is idempotent');
  assert.equal(createdAgain.json.share.token, token);

  const pubRead = await anon.api('GET', `/api/docs/public/${token}`);
  assert.equal(pubRead.status, 200, 'anonymous token holder reads the snapshot');
  assert.equal(pubRead.json.share.page.title, 'Public-shared page');

  const guestRead = await guest.api('GET', `/api/docs/${pageId}`);
  assert.equal(guestRead.status, 404, 'public token never grants an authenticated session');

  const legacyRevoke = await admin.api('DELETE', `/api/docs/${pageId}/share`);
  assert.equal(legacyRevoke.status, 204);
  const afterRevoke = await anon.api('GET', `/api/docs/public/${token}`);
  assert.equal(afterRevoke.status, 404, 'revoked link is gone');

  const recreated = await admin.api('POST', `/api/docs/${pageId}/share`);
  assert.equal(recreated.status, 201, 'the link can be recreated after revoke');
});

test('legacy share revoke leaves targeted audience grants intact', async () => {
  const admin = globalThis.__admin;
  const pageId = await createDoc('Mixed shares page');
  const alice = await signupUser('alice-mix@test.io', 'Alice Mix');
  addOrgMember('alice-mix@test.io', 'VIEWER');

  const userShare = await admin.api('POST', `/api/docs/${pageId}/shares`, {
    kind: 'user',
    targetUser: { email: 'alice-mix@test.io' },
  });
  assert.equal(userShare.status, 201);
  await admin.api('POST', `/api/docs/${pageId}/share`);

  const revoked = await admin.api('DELETE', `/api/docs/${pageId}/share`);
  assert.equal(revoked.status, 204);

  const list = await admin.api('GET', `/api/docs/${pageId}/shares`);
  const kinds = list.json.shares.map((s) => s.kind);
  assert.ok(!kinds.includes('public'), 'public grant revoked');
  assert.ok(kinds.includes('user'), 'targeted user grant survived');

  const aliceRead = await alice.api('GET', `/api/docs/${pageId}`);
  assert.equal(aliceRead.status, 200, 'user audience still reads after link revoke');
});
