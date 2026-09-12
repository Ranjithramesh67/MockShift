'use strict';

// Integration tests for admin-configurable menus:
//   - GET /api/menu-access resolves org vs project scope
//   - a disabled feature router returns 403 menu_disabled
//   - PUT/GET/DELETE /api/admin/menus manage overrides
//   - non-admins cannot read or mutate menu settings

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

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
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
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
  return { api };
}

let admin;
let editor;
let orgId;
let projectId;
let workspaceId;

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

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/menu-access', require('../src/api/routes/menuAccess'));
  app.use('/api/admin', require('../src/api/routes/admin'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api/docs', require('../src/api/menuAccess').requireMenuEnabled('docs'), require('../src/api/routes/docs'));

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'menusadmin@test.io',
    password: 'adminpass123',
    name: 'Menus Admin',
  });
  assert.equal(signup.status, 201);
  orgId = signup.json.user.organizations[0].id;

  const ws = await admin.api('GET', '/api/workspaces');
  workspaceId = ws.json.workspaces[0].id;
  const content = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  projectId = content.json.projects[0].id;

  editor = makeClient();
  const editorSignup = await editor.api('POST', '/api/auth/signup', {
    email: 'menuseditor@test.io',
    password: 'editorpass123',
    name: 'Menus Editor',
  });
  assert.equal(editorSignup.status, 201);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('GET /api/menu-access defaults every toggleable key to enabled', async () => {
  const res = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.menus.docs, true);
  assert.equal(res.json.menus.copilot, true);
  assert.equal(res.json.orgId, orgId);
});

test('non-admin cannot read or write menu settings', async () => {
  const read = await editor.api('GET', '/api/admin/menus');
  assert.equal(read.status, 403);
  const write = await editor.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(write.status, 403);
});

test('org-scoped disable hides the menu and blocks the feature route', async () => {
  const put = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(put.status, 200);
  const settingId = put.json.setting.id;

  const access = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(access.json.menus.docs, false);

  const blocked = await admin.api('GET', '/api/docs');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'menu_disabled');
  assert.equal(blocked.json.menuKey, 'docs');

  const del = await admin.api('DELETE', `/api/admin/menus/${settingId}`);
  assert.equal(del.status, 200);
  const restored = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(restored.json.menus.docs, true);
});

test('project override wins over an org disable', async () => {
  await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  const projectOn = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'project',
    projectId,
    enabled: true,
  });
  assert.equal(projectOn.status, 200);

  const access = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}&projectId=${projectId}`);
  assert.equal(access.json.menus.docs, true);

  const allowed = await admin.api('GET', `/api/docs?projectId=${projectId}`);
  assert.notEqual(allowed.status, 403);
});

test('PUT rejects unknown menu keys and bad scope', async () => {
  const badKey = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'nope',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(badKey.status, 400);
  const badScope = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'team',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(badScope.status, 400);
});
