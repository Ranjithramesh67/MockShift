'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
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

async function signup(client, email, password, name) {
  const res = await client.api('POST', '/api/auth/signup', { email, password, name });
  assert.equal(res.status, 201, `${email} signup`);
}

async function defaultProjectId(client) {
  const ws = await client.api('GET', '/api/workspaces');
  assert.equal(ws.status, 200);
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  assert.ok(myWs, 'found My Workspace');
  const content = await client.api('GET', `/api/workspaces/${myWs.id}/content`);
  assert.equal(content.status, 200);
  const project = content.json.projects.find((p) => p.name === 'Default Project');
  assert.ok(project, 'found Default Project');
  return project.id;
}

let admin;
let projectId;
let collectionId;
let tokenRequestId;

before(async () => {
  psqlReset();
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-f', path.join(ROOT, 'db', 'migrations', file)], {
      env: PGENV,
      stdio: 'pipe',
    });
  }

  process.env.PGDATABASE = 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const { createApp } = require('../src/api/server');
  server = await new Promise((resolve) => {
    const app = createApp();
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  await signup(admin, 'expadmin@test.io', 'adminpass123', 'Exp Admin');
  projectId = await defaultProjectId(admin);

  // Seed a collection with two requests (GET with query/headers/assertions +
  // an AUTH token request with a JSON body) and an auth provider.
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Export Me' });
  assert.equal(col.status, 201);
  collectionId = col.json.collection.id;

  const getReq = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'List items',
    method: 'GET',
    url: 'http://127.0.0.1:3999/items?page=1',
    apiType: 'REST',
  });
  assert.equal(getReq.status, 201);
  const getRequestId = getReq.json.request.id;
  await admin.api('PUT', `/api/requests/${getRequestId}`, {
    headers: [{ key: 'X-Debug', value: 'yes', enabled: true }],
    queryParams: [{ key: 'limit', value: '10', enabled: true }],
    assertions: [{ type: 'status', operator: 'eq', expected: 200 }],
  });

  const tokenReq = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Get token',
    method: 'POST',
    url: 'http://127.0.0.1:3999/token',
    apiType: 'AUTH',
  });
  assert.equal(tokenReq.status, 201);
  tokenRequestId = tokenReq.json.request.id;
  await admin.api('PUT', `/api/requests/${tokenRequestId}`, {
    bodyType: 'JSON',
    bodyJson: { grant_type: 'client_credentials' },
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
  });

  const auth = await admin.api('PUT', `/api/collections/${collectionId}/auth-provider`, {
    authType: 'BEARER_TOKEN',
    tokenRequestId,
    tokenPath: 'access_token',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer',
  });
  assert.equal(auth.status, 200, 'set auth provider');
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

test('export serializes the collection with full request + auth data', async () => {
  const res = await admin.api('GET', `/api/collections/${collectionId}/export`);
  assert.equal(res.status, 200);
  const c = res.json.collection;
  assert.equal(c.format, 'api-hub-collection');
  assert.equal(c.version, 1);
  assert.equal(c.name, 'Export Me');
  assert.equal(c.requests.length, 2);

  const list = c.requests.find((r) => r.name === 'List items');
  assert.equal(list.method, 'GET');
  assert.equal(list.url, 'http://127.0.0.1:3999/items?page=1');
  assert.deepEqual(list.headers, [{ key: 'X-Debug', value: 'yes', enabled: true }]);
  assert.deepEqual(list.queryParams, [{ key: 'limit', value: '10', enabled: true }]);
  assert.deepEqual(list.assertions, [{ type: 'status', operator: 'eq', expected: 200 }]);
  assert.ok(list.sourceId, 'carries sourceId for re-link');

  const token = c.requests.find((r) => r.name === 'Get token');
  assert.equal(token.apiType, 'AUTH');
  assert.deepEqual(token.bodyJson, { grant_type: 'client_credentials' });
  assert.equal(token.bodyType, 'JSON');

  assert.equal(c.authProvider.authType, 'BEARER_TOKEN');
  assert.equal(c.authProvider.tokenRequestId, tokenRequestId);
  assert.equal(c.authProvider.tokenPath, 'access_token');
});

test('export requires access (403 for an outsider)', async () => {
  const dev = makeClient();
  await signup(dev, 'expdev@test.io', 'devpass123', 'Exp Dev');
  const res = await dev.api('GET', `/api/collections/${collectionId}/export`);
  assert.equal(res.status, 403);
  const missing = await dev.api('GET', '/api/collections/00000000-0000-0000-0000-000000000000/export');
  assert.equal(missing.status, 404);
});

test('import recreates the collection, requests and auth provider', async () => {
  const exported = await admin.api('GET', `/api/collections/${collectionId}/export`);
  const payload = exported.json.collection;

  const res = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Imported Copy',
    collection: payload,
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.collection.name, 'Imported Copy');
  assert.equal(res.json.requests.length, 2);

  // Verify the recreated collection reads back identically.
  const fresh = await admin.api('GET', `/api/collections/${res.json.collection.id}/export`);
  const fc = fresh.json.collection;
  assert.equal(fc.name, 'Imported Copy');
  assert.equal(fc.requests.length, 2);

  const list = fc.requests.find((r) => r.name === 'List items');
  assert.deepEqual(list.headers, [{ key: 'X-Debug', value: 'yes', enabled: true }]);
  assert.deepEqual(list.queryParams, [{ key: 'limit', value: '10', enabled: true }]);
  assert.deepEqual(list.assertions, [{ type: 'status', operator: 'eq', expected: 200 }]);

  const token = fc.requests.find((r) => r.name === 'Get token');
  assert.deepEqual(token.bodyJson, { grant_type: 'client_credentials' });

  // Auth provider is re-linked: tokenRequestId points at the imported token req.
  assert.equal(fc.authProvider.authType, 'BEARER_TOKEN');
  assert.notEqual(fc.authProvider.tokenRequestId, tokenRequestId);
  assert.equal(fc.authProvider.tokenRequestId, token.sourceId, 're-linked to imported request');
});

test('import validates input and enforces write access', async () => {
  const missingRequests = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Bad',
    collection: { format: 'api-hub-collection', version: 1, name: 'Bad', requests: 'nope' },
  });
  assert.equal(missingRequests.status, 400);

  const noName = await admin.api('POST', '/api/collections/import', {
    projectId,
    name: 'Bad2',
    collection: { format: 'api-hub-collection', version: 1, name: 'Bad2', requests: [{ method: 'GET', url: 'http://x' }] },
  });
  assert.equal(noName.status, 400);
  assert.match(noName.json.error, /name is required/i);

  const exported = await admin.api('GET', `/api/collections/${collectionId}/export`);

  const dev = makeClient();
  await signup(dev, 'expdev2@test.io', 'devpass123', 'Exp Dev2');
  const asDev = await dev.api('POST', '/api/collections/import', {
    projectId,
    name: 'Nope',
    collection: exported.json.collection,
  });
  assert.equal(asDev.status, 403);
});
