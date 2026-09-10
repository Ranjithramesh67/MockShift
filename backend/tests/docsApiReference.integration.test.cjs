'use strict';

// Product API reference (Docs round 3, DR7): the contract-first OpenAPI document
// lives at api/openapi.json and is served to signed-in users at
// GET /api/docs/api-reference (O8: any authenticated user; it carries no
// secrets and every credential in it is a placeholder).

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
    email: 'docapiadmin@test.io',
    password: 'adminpass123',
    name: 'Doc API Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
  globalThis.__anon = makeClient();
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

test('the API reference requires authentication', async () => {
  const res = await globalThis.__anon.api('GET', '/api/docs/api-reference');
  assert.equal(res.status, 401);
});

test('the API reference serves a valid OpenAPI document', async () => {
  const res = await globalThis.__admin.api('GET', '/api/docs/api-reference');
  assert.equal(res.status, 200);
  const spec = res.json;
  assert.ok(/^3\.0\./.test(spec.openapi), 'OpenAPI 3.0.x');
  assert.ok(spec.info && spec.info.title && spec.info.version, 'info block present');
  assert.ok(spec.paths['/api/runs'] && spec.paths['/api/runs'].post, 'runs operation documented');
  assert.ok(spec.paths['/api/tokens'] && spec.paths['/api/tokens'].post, 'token create documented');
  assert.ok(spec.paths['/api/sends'] && spec.paths['/api/sends'].post, 'send create documented');
  assert.ok(spec.paths['/api/profile/usage'] && spec.paths['/api/profile/usage'].get, 'usage documented');

  const runSecurity = spec.paths['/api/runs'].post.security || [];
  assert.ok(runSecurity.some((s) => 'bearerAuth' in s), 'runs accepts a bearer token');
  assert.ok(spec.components.securitySchemes.bearerAuth, 'bearer scheme declared');

  const runBody = spec.paths['/api/runs'].post.requestBody.content['application/json'];
  assert.ok(runBody.schema, 'run request body schema present');
  assert.ok(runBody.examples && runBody.examples.minimal, 'run request example present');
});

test('the spec carries placeholders, never real credentials', async () => {
  const res = await globalThis.__admin.api('GET', '/api/docs/api-reference');
  const raw = JSON.stringify(res.json);
  assert.ok(/Bearer \$API_TOKEN|\$API_TOKEN|tkh_<hex>/.test(raw), 'token samples use placeholders');
  assert.ok(!/tkh_[0-9a-f]{24,}/i.test(raw), 'no full token secret');
  assert.ok(!/ah\.session=[A-Za-z0-9._-]{20,}/.test(raw), 'no session cookie value');
});
