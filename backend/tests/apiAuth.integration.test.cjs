'use strict';

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
  PGPORT: '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlReset() {
  return execFileSync(
    'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-c', 'DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public'],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
}

let server;
let base;
let mockUpstream;

async function createMockUpstream() {
  return new Promise((resolve) => {
    const upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ access_token: 'itoken-9876', token_type: 'Bearer' }));
        }
        if (req.url === '/echo-body') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(body);
        }
        if (req.url.startsWith('/echo')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ headers: req.headers }));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    upstream.listen(0, '127.0.0.1', () => resolve(upstream));
  });
}

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

const mockBase = () => `http://127.0.0.1:${mockUpstream.address().port}`;

async function loginAsAdmin() {
  const client = makeClient();
  await client.api('POST', '/api/auth/login', { email: 'admin@test.io', password: 'adminpass123' });
  return client;
}

before(async () => {
  // Reset the shared dev/test database the same way db/tests/run.sh does.
  psqlReset();
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-f', path.join(ROOT, 'db', 'migrations', file)], {
      env: PGENV,
      stdio: 'pipe',
    });
  }

  mockUpstream = await createMockUpstream();
  process.env.PGDATABASE = 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  await require('../src/api/db').pool.end();
});

test('health endpoint responds', async () => {
  const { api } = makeClient();
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('first signup bootstraps an ADMIN user with a private workspace', async () => {
  const { api } = makeClient();
  const res = await api('POST', '/api/auth/signup', { email: 'admin@test.io', password: 'adminpass123', name: 'Admin' });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.user.role, 'ADMIN');
  assert.equal(res.json.user.organizations.length, 1);

  const ws = await api('GET', '/api/workspaces');
  assert.equal(ws.status, 200);
  assert.equal(ws.json.workspaces.length, 1);
  assert.equal(ws.json.workspaces[0].name, 'My Workspace');
  assert.equal(ws.json.workspaces[0].role, 'ADMIN');
});

test('login validates credentials and session survives me()', async () => {
  const { api } = makeClient();
  const bad = await api('POST', '/api/auth/login', { email: 'admin@test.io', password: 'wrongpass123' });
  assert.equal(bad.status, 401);
  const good = await api('POST', '/api/auth/login', { email: 'admin@test.io', password: 'adminpass123' });
  assert.equal(good.status, 200);
  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'admin@test.io');
});

test('a user cannot create a workspace in an organization they do not admin', async () => {
  const bob = makeClient();
  const signup = await bob.api('POST', '/api/auth/signup', { email: 'bob@test.io', password: 'bobpass123', name: 'Bob' });
  assert.equal(signup.json.user.user.role, 'EDITOR');

  const admin = await loginAsAdmin();
  const me = await admin.api('GET', '/api/auth/me');
  const adminOrgId = me.json.organizations[0].id;

  const ownWs = await bob.api('POST', '/api/workspaces', { name: 'My Own Org Space' });
  assert.equal(ownWs.status, 201, 'bob can create a workspace inside his own org');

  const foreign = await bob.api('POST', '/api/workspaces', { name: 'Nope', organizationId: adminOrgId });
  assert.equal(foreign.status, 403, 'bob cannot create a workspace in another org');
});

test('team sharing grants cross-user access to a private workspace', async () => {
  const admin = await loginAsAdmin();
  const bob = makeClient();
  await bob.api('POST', '/api/auth/login', { email: 'bob@test.io', password: 'bobpass123' });

  const wsRes = await admin.api('POST', '/api/workspaces', { name: 'Shared Space' });
  assert.equal(wsRes.status, 201);
  const workspaceId = wsRes.json.workspace.id;

  const teamRes = await admin.api('POST', '/api/teams', { name: 'Delivery' });
  assert.equal(teamRes.status, 201);
  const teamId = teamRes.json.team.id;

  const invite = await admin.api('POST', `/api/teams/${teamId}/members`, { email: 'bob@test.io', role: 'EDITOR' });
  assert.equal(invite.status, 201);

  const share = await admin.api('POST', `/api/workspaces/${workspaceId}/teams`, { teamId, role: 'EDITOR' });
  assert.equal(share.status, 201);

  const list = await bob.api('GET', '/api/workspaces');
  assert.ok(list.json.workspaces.some((w) => w.id === workspaceId), 'bob should see the shared workspace');
  const shared = list.json.workspaces.find((w) => w.id === workspaceId);
  assert.equal(shared.role, 'EDITOR');

  const tree = await bob.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(tree.status, 200);
  assert.equal(tree.json.projects.length, 1);
});

test('AUTH request + folder provider injects the token into sibling requests', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Auth Workspace' });
  const workspaceId = ws.json.workspace.id;
  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;

  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Secured' });
  const collectionId = col.json.collection.id;

  const auth = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Token', method: 'POST', url: `${mockBase()}/token`, apiType: 'AUTH',
  });
  assert.equal(auth.json.request.api_type, 'AUTH');

  const target = await admin.api('POST', '/api/requests', {
    collectionId, name: 'Balance', method: 'GET', url: `${mockBase()}/echo`,
  });
  const targetId = target.json.request.id;

  const prov = await admin.api('PUT', `/api/collections/${collectionId}/auth-provider`, {
    authType: 'BEARER_TOKEN', tokenRequestId: auth.json.request.id,
    tokenPath: 'access_token', headerKey: 'Authorization', headerPrefix: 'Bearer',
  });
  assert.equal(prov.status, 200);
  assert.equal(prov.json.authProvider.authType, 'BEARER_TOKEN');

  const testProv = await admin.api('POST', `/api/collections/${collectionId}/auth-provider/test`);
  assert.equal(testProv.status, 200);
  assert.equal(testProv.json.resolvedHeader.headerValue, 'Bearer itoken-9876');

  const run = await admin.api('POST', `/api/requests/${targetId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');
  assert.equal(run.json.resolvedAuth.headerValue, 'Bearer itoken-9876');
  const echoed = JSON.parse(run.json.response.body);
  assert.equal(echoed.headers.authorization, 'Bearer itoken-9876');
});

test('folder provider rejects a token request that is not AUTH-type', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Guard Workspace' });
  const tree = await admin.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Guarded' });
  const rest = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'Plain', method: 'GET', url: `${mockBase()}/echo`,
  });
  const prov = await admin.api('PUT', `/api/collections/${col.json.collection.id}/auth-provider`, {
    authType: 'BEARER_TOKEN', tokenRequestId: rest.json.request.id, tokenPath: 'access_token',
  });
  assert.equal(prov.status, 400);
});

test('admin can deactivate a user and they can no longer log in', async () => {
  const admin = await loginAsAdmin();
  const carol = makeClient();
  await carol.api('POST', '/api/auth/signup', { email: 'carol@test.io', password: 'carolpass123', name: 'Carol' });
  await carol.api('POST', '/api/auth/login', { email: 'carol@test.io', password: 'carolpass123' });

  const users = await admin.api('GET', '/api/admin/users');
  const carolUser = users.json.users.find((u) => u.email === 'carol@test.io');
  const patch = await admin.api('PATCH', `/api/admin/users/${carolUser.id}`, { isActive: false });
  assert.equal(patch.status, 200);

  const login = await carol.api('POST', '/api/auth/login', { email: 'carol@test.io', password: 'carolpass123' });
  assert.equal(login.status, 403);
});

test('non-admins are blocked from the admin API', async () => {
  const bob = makeClient();
  await bob.api('POST', '/api/auth/login', { email: 'bob@test.io', password: 'bobpass123' });
  const res = await bob.api('GET', '/api/admin/users');
  assert.equal(res.status, 403);
});

test('request detail is returned with camelCase fields for the editor', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Fields Workspace' });
  const tree = await admin.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Fields' });
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'Body', method: 'POST',
    url: 'https://api.example.com/x', apiType: 'SOAP',
  });
  await admin.api('PUT', `/api/requests/${req.json.request.id}`, {
    bodyType: 'JSON', bodyJson: { a: 1 }, apiType: 'GRAPHQL',
  });
  const detail = await admin.api('GET', `/api/requests/${req.json.request.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.request.bodyType, 'JSON');
  assert.equal(detail.json.request.apiType, 'GRAPHQL');
  assert.deepEqual(detail.json.request.bodyJson, { a: 1 });
});

test('pre-request formula mutates the outgoing JSON body and round-trips', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Formula Workspace' });
  const tree = await admin.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Formula' });

  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'Order', method: 'POST', url: `${mockBase()}/echo-body`,
  });
  const requestId = req.json.request.id;

  const saved = await admin.api('PUT', `/api/requests/${requestId}`, {
    bodyType: 'JSON',
    bodyJson: { amount: 19.99 },
    formula: 'req.body.userId = 2',
  });
  assert.equal(saved.status, 200);

  const detail = await admin.api('GET', `/api/requests/${requestId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.request.formula, 'req.body.userId = 2');

  const run = await admin.api('POST', `/api/requests/${requestId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');
  const dispatched = JSON.parse(run.json.requestSnapshot.body);
  assert.equal(dispatched.userId, 2, 'formula should add userId to the dispatched body');
  assert.equal(dispatched.amount, 19.99, 'original body fields are preserved');

  const echoed = JSON.parse(run.json.response.body);
  assert.equal(echoed.userId, 2, 'upstream should receive the formula-mutated body');
});

test('admins can delete requests, collections, workspaces and teams', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Delete Workspace' });
  const workspaceId = ws.json.workspace.id;
  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'To Delete' });
  const collectionId = col.json.collection.id;
  const req = await admin.api('POST', '/api/requests', {
    collectionId, name: 'R', method: 'GET', url: 'https://api.example.com/x',
  });

  const delReq = await admin.api('DELETE', `/api/requests/${req.json.request.id}`);
  assert.equal(delReq.status, 200);
  const missingReq = await admin.api('GET', `/api/requests/${req.json.request.id}`);
  assert.equal(missingReq.status, 404);

  const delCol = await admin.api('DELETE', `/api/collections/${collectionId}`);
  assert.equal(delCol.status, 200);

  const delWs = await admin.api('DELETE', `/api/workspaces/${workspaceId}`);
  assert.equal(delWs.status, 200);
  const list = await admin.api('GET', '/api/workspaces');
  assert.ok(!list.json.workspaces.some((w) => w.id === workspaceId));

  const team = await admin.api('POST', '/api/teams', { name: 'Disposable' });
  const delTeam = await admin.api('DELETE', `/api/teams/${team.json.team.id}`);
  assert.equal(delTeam.status, 200);
});

test('deleting a request that has run history succeeds and preserves the audit row', async () => {
  const admin = await loginAsAdmin();
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Run-Delete Workspace' });
  const tree = await admin.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Runs' });
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'Ran Once', method: 'POST', url: `${mockBase()}/echo-body`,
  });
  const requestId = req.json.request.id;

  const run = await admin.api('POST', `/api/requests/${requestId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');

  const { query } = require('../src/api/db');
  const beforeRows = await query('SELECT count(*)::int AS n FROM run_history WHERE request_id = $1', [requestId]);
  assert.ok(beforeRows.rows[0].n >= 1, 'the run should be recorded before deletion');

  const beforeOrphans = await query(
    'SELECT count(*)::int AS n FROM run_history WHERE request_id IS NULL AND workflow_id IS NULL'
  );

  const del = await admin.api('DELETE', `/api/requests/${requestId}`);
  assert.equal(del.status, 200, 'deleting a run request must not violate run_history_target');

  const missing = await admin.api('GET', `/api/requests/${requestId}`);
  assert.equal(missing.status, 404);

  const afterOrphans = await query(
    'SELECT count(*)::int AS n FROM run_history WHERE request_id IS NULL AND workflow_id IS NULL'
  );
  assert.equal(
    afterOrphans.rows[0].n,
    beforeOrphans.rows[0].n + beforeRows.rows[0].n,
    'run history rows are preserved (SET NULL) after deleting the request'
  );
});

test('non-admin workspace members cannot delete requests', async () => {
  const admin = await loginAsAdmin();
  const bob = makeClient();
  await bob.api('POST', '/api/auth/login', { email: 'bob@test.io', password: 'bobpass123' });

  const ws = await admin.api('POST', '/api/workspaces', { name: 'Locked Down' });
  const workspaceId = ws.json.workspace.id;
  const team = await admin.api('POST', '/api/teams', { name: 'Viewers' });
  await admin.api('POST', `/api/teams/${team.json.team.id}/members`, { email: 'bob@test.io', role: 'VIEWER' });
  await admin.api('POST', `/api/workspaces/${workspaceId}/teams`, { teamId: team.json.team.id, role: 'VIEWER' });

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Guarded' });
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'R', method: 'GET', url: 'https://api.example.com/x',
  });

  const attempt = await bob.api('DELETE', `/api/requests/${req.json.request.id}`);
  assert.equal(attempt.status, 403);
});

test('project managers can approve access requests and grant real access', async () => {
  const admin = await loginAsAdmin();

  // Admin creates a MANAGER and an ordinary EDITOR.
  const mgrCreate = await admin.api('POST', '/api/admin/users', {
    email: 'mgr@test.io', name: 'Mgr', role: 'MANAGER', password: 'managerpass123',
  });
  assert.equal(mgrCreate.status, 201);
  const editorCreate = await admin.api('POST', '/api/admin/users', {
    email: 'outsider@test.io', name: 'Outsider', role: 'EDITOR', password: 'outsider123',
  });
  assert.equal(editorCreate.status, 201);

  // Admin creates a project and assigns the manager.
  const ws = await admin.api('POST', '/api/workspaces', { name: 'Governed' });
  const workspaceId = ws.json.workspace.id;
  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = tree.json.projects[0].id;
  const assign = await admin.api('POST', `/api/manage/projects/${projectId}/managers`, {
    userId: mgrCreate.json.user.id,
  });
  assert.equal(assign.status, 200);
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'API' });
  const req = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id, name: 'Echo', method: 'GET', url: `${mockBase()}/echo`,
  });

  // The outsider cannot read the project before approval.
  const outsider = makeClient();
  await outsider.api('POST', '/api/auth/login', { email: 'outsider@test.io', password: 'outsider123' });
  const beforeTree = await outsider.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(beforeTree.status, 403);

  // Outsider requests access; the manager sees and approves it.
  const request = await outsider.api('POST', `/api/projects/${projectId}/access-requests`, {
    reason: 'Need to test the payments API',
  });
  assert.equal(request.status, 201);
  const manager = makeClient();
  await manager.api('POST', '/api/auth/login', { email: 'mgr@test.io', password: 'managerpass123' });
  const listReq = await manager.api('GET', '/api/manage/access-requests');
  assert.equal(listReq.status, 200);
  const pending = listReq.json.accessRequests.find((r) => r.project_id === projectId && r.email === 'outsider@test.io');
  assert.ok(pending, 'manager should see the pending request');

  const review = await manager.api('POST', `/api/manage/access-requests/${pending.id}/review`, { approve: true });
  assert.equal(review.status, 200);

  // Now the outsider has real read access: the tree loads and flags the
  // project as accessible, and the request detail is reachable.
  const afterTree = await outsider.api('GET', `/api/workspaces/${workspaceId}/content`);
  assert.equal(afterTree.status, 200);
  const project = afterTree.json.projects.find((p) => p.id === projectId);
  assert.ok(project, 'tree should contain the project');
  assert.equal(project.can_access, true);

  const detail = await outsider.api('GET', `/api/requests/${req.json.request.id}`);
  assert.equal(detail.status, 200);

  // But the outsider still cannot delete content.
  const deny = await outsider.api('DELETE', `/api/requests/${req.json.request.id}`);
  assert.equal(deny.status, 403);

  // Managers can see their managed projects and history.
  const mgrProjects = await manager.api('GET', '/api/manage/projects');
  assert.ok(mgrProjects.json.projects.some((p) => p.id === projectId && p.is_manager));
  const mgrUsers = await manager.api('GET', '/api/manage/users');
  assert.equal(mgrUsers.status, 200);
  const mgrAudit = await manager.api('GET', '/api/manage/audit-logs');
  assert.equal(mgrAudit.status, 200);
});

test('managers cannot see other projects they do not manage', async () => {
  const admin = await loginAsAdmin();
  const other = await admin.api('POST', '/api/workspaces', { name: 'Unmanaged' });
  const tree = await admin.api('GET', `/api/workspaces/${other.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;

  const manager = makeClient();
  await manager.api('POST', '/api/auth/login', { email: 'mgr@test.io', password: 'managerpass123' });
  const projects = await manager.api('GET', '/api/manage/projects');
  assert.ok(!projects.json.projects.some((p) => p.id === projectId));

  // Manager is not a reviewer for it either.
  const otherEditor = makeClient();
  await otherEditor.api('POST', '/api/auth/login', { email: 'outsider@test.io', password: 'outsider123' });
  const accessReq = await otherEditor.api('POST', `/api/projects/${projectId}/access-requests`, { reason: 'try' });
  assert.equal(accessReq.status, 201);
  const review = await manager.api('POST', `/api/manage/access-requests/${accessReq.json.accessRequest.id}/review`, { approve: true });
  assert.equal(review.status, 403);
});

test('team org-users picker lists candidates and add-by-userId works', async () => {
  const admin = makeClient();
  const login = await admin.api('POST', '/api/auth/login', { email: 'admin@test.io', password: 'adminpass123' });
  if (login.status !== 200) {
    const signupAdmin = await admin.api('POST', '/api/auth/signup', {
      email: 'admin@test.io',
      password: 'adminpass123',
      name: 'Admin',
    });
    assert.equal(signupAdmin.status, 201);
  }
  const teamRes = await admin.api('POST', '/api/teams', { name: 'Picker Team' });
  assert.equal(teamRes.status, 201);
  const teamId = teamRes.json.team.id;

  const stamp = Date.now();
  const target = makeClient();
  const targetEmail = `picker-${stamp}@test.io`;
  const signup = await target.api('POST', '/api/auth/signup', {
    email: targetEmail,
    password: 'pickerpass123',
    name: 'Picker Target',
    username: `picker${stamp}`,
  });
  assert.equal(signup.status, 201);

  const listed = await admin.api('GET', `/api/teams/${teamId}/org-users`);
  assert.equal(listed.status, 200);
  const hit = listed.json.users.find((u) => u.username === `picker${stamp}`);
  assert.ok(hit, 'new user should appear in the picker');
  assert.equal(hit.email, undefined);
  assert.ok(!listed.json.users.some((u) => u.id === teamRes.json.team.members[0].id));

  const missing = await admin.api('POST', `/api/teams/${teamId}/members`, { role: 'EDITOR' });
  assert.equal(missing.status, 400);

  const added = await admin.api('POST', `/api/teams/${teamId}/members`, { userId: hit.id, role: 'EDITOR' });
  assert.equal(added.status, 201);
  assert.ok(added.json.members.some((m) => m.username === `picker${stamp}` && m.role === 'EDITOR'));

  const after = await admin.api('GET', `/api/teams/${teamId}/org-users`);
  assert.ok(!after.json.users.some((u) => u.username === `picker${stamp}`));

  const emailUser = makeClient();
  const emailTwo = `picker-mail-${stamp}@test.io`;
  const signupTwo = await emailUser.api('POST', '/api/auth/signup', {
    email: emailTwo,
    password: 'pickerpass123',
    name: 'Picker Mail',
    username: `pickermail${stamp}`,
  });
  assert.equal(signupTwo.status, 201);
  const byUsername = await admin.api('POST', `/api/teams/${teamId}/members`, { username: `pickermail${stamp}`, role: 'VIEWER' });
  assert.equal(byUsername.status, 201);
  assert.ok(byUsername.json.members.some((m) => m.username === `pickermail${stamp}` && m.role === 'VIEWER'));

  const stranger = makeClient();
  const strangerSignup = await stranger.api('POST', '/api/auth/signup', {
    email: `picker-out-${stamp}@test.io`,
    password: 'pickerpass123',
    name: 'Picker Out',
  });
  assert.equal(strangerSignup.status, 201);
  const forbidden = await stranger.api('GET', `/api/teams/${teamId}/org-users`);
  assert.equal(forbidden.status, 403);
});
