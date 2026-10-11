'use strict';

// E1 — OpenAPI import + contract validation. Pure-helper coverage plus an
// in-process API round trip: import a spec (collection/folders/requests),
// validate a live response against an operation schema, attach contract checks
// to a request, and diff two spec versions for breaking changes.

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

// ------------------------------------------------------------------- fixtures

const SPEC_V1 = {
  openapi: '3.0.3',
  info: { title: 'Pets API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        tags: ['Pets'],
        summary: 'List pets',
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items'],
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Pets'],
        summary: 'Create pet',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' }, age: { type: 'integer' } },
              },
              example: { name: 'Rex', age: 3 },
            },
          },
        },
        responses: {
          201: {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        tags: ['Pets'],
        summary: 'Get pet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          404: { description: 'not found' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health probe',
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          age: { type: 'integer' },
        },
      },
    },
  },
};

function makeV2() {
  const spec = JSON.parse(JSON.stringify(SPEC_V1));
  delete spec.paths['/health'];
  delete spec.paths['/pets'].post;
  spec.components.schemas.Pet.required = ['id'];
  spec.components.schemas.Pet.properties.age = { type: 'string' };
  spec.info.version = '2.0.0';
  return spec;
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

  // The contracts router is a coordinator seam in server.js. Build a minimal
  // app here (express.json + the session/auth/content routers the suite needs)
  // so the suite is self-contained until the coordinator wires the mount.
  const express = require('express');
  server = await new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api/auth', require('../src/api/routes/auth'));
    app.use('/api/workspaces', require('../src/api/routes/workspaces'));
    app.use('/api', require('../src/api/routes/content'));
    app.use('/api/contracts', require('../src/api/routes/contracts'));
    app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    });
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'contractsadmin@test.io',
    password: 'adminpass123',
    name: 'Contracts Admin',
  });
  assert.equal(signup.status, 201);
  globalThis.__admin = admin;
  const ws = await admin.api('GET', '/api/workspaces');
  const wsId = ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
  const content = await admin.api('GET', `/api/workspaces/${wsId}/content`);
  globalThis.__projectId = content.json.projects.find((p) => p.can_access).id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

// ------------------------------------------------------------- pure helpers

test('parseSpec accepts 3.x and rejects other versions', () => {
  const { parseSpec } = require('../src/api/openapi');
  assert.equal(parseSpec(SPEC_V1).info.title, 'Pets API');
  assert.equal(parseSpec(JSON.stringify(SPEC_V1)).info.version, '1.0.0');
  assert.throws(() => parseSpec({ swagger: '2.0', info: { title: 'x', version: '1' }, paths: {} }), /3\.x required/);
  assert.throws(() => parseSpec('{ not json'), /Invalid JSON/);
});

test('generateRequests maps paths to folders and requests', () => {
  const { generateRequests } = require('../src/api/openapi');
  const blueprint = generateRequests(SPEC_V1);
  assert.equal(blueprint.collectionName, 'Pets API');
  assert.deepEqual(blueprint.folders.map((f) => f.name).sort(), ['Pets', 'health']);
  assert.equal(blueprint.requests.length, 4);
  const list = blueprint.requests.find((r) => r.name === 'List pets');
  assert.equal(list.method, 'GET');
  assert.equal(list.url, '{{baseUrl}}/pets');
  const create = blueprint.requests.find((r) => r.name === 'Create pet');
  assert.equal(create.bodyType, 'JSON');
  assert.deepEqual(create.bodyJson, { name: 'Rex', age: 3 });
});

test('validateResponse accepts conforming bodies and reports violations', () => {
  const { validateResponse } = require('../src/api/openapi');
  const ok = validateResponse(SPEC_V1, { method: 'GET', path: '/pets', statusCode: '200' }, {
    status: 200,
    body: JSON.stringify({ items: [{ id: '1', name: 'Rex', age: 3 }] }),
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.errors, []);

  const bad = validateResponse(SPEC_V1, { method: 'GET', path: '/pets', statusCode: '200' }, {
    status: 200,
    body: JSON.stringify({ items: [{ id: 1 }] }),
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /missing required property/.test(e)));
  assert.ok(bad.errors.some((e) => /expected string, got integer/.test(e)));

  const none = validateResponse(SPEC_V1, { method: 'GET', path: '/pets/1', statusCode: '404' }, { status: 404, body: '' });
  assert.equal(none.skipped, true);
});

test('diffSpecs flags removed paths/methods, removed required fields and type changes', () => {
  const { diffSpecs } = require('../src/api/openapi');
  const diff = diffSpecs(SPEC_V1, makeV2());
  assert.equal(diff.hasBreaking, true);
  const kinds = new Set(diff.breaking.map((change) => change.kind));
  assert.ok(kinds.has('path_removed'));
  assert.ok(kinds.has('method_removed'));
  assert.ok(kinds.has('required_field_removed'));
  assert.ok(kinds.has('field_type_changed'));
  assert.ok(diff.nonBreaking.every((change) => change.severity === 'non-breaking'));
});

// --------------------------------------------------------------- API round trip

test('import generates a collection, folders and requests and lists the spec', async () => {
  const admin = globalThis.__admin;
  const res = await admin.api('POST', '/api/contracts/import', {
    projectId: globalThis.__projectId,
    spec: SPEC_V1,
  });
  assert.equal(res.status, 201, `import failed: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.collection.name, 'Pets API');
  assert.equal(res.json.folders.length, 2);
  assert.equal(res.json.requests.length, 4);
  assert.equal(res.json.spec.operationCount, 4);
  globalThis.__specId = res.json.spec.id;
  globalThis.__requests = res.json.requests;

  const list = await admin.api('GET', `/api/contracts?projectId=${globalThis.__projectId}`);
  assert.equal(list.status, 200);
  const found = list.json.specs.find((spec) => spec.id === globalThis.__specId);
  assert.ok(found);
  assert.equal(found.operationCount, 4);

  const detail = await admin.api('GET', `/api/contracts/${globalThis.__specId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.spec.document.openapi, '3.0.3');
  assert.equal(detail.json.operations.length, 4);
});

test('validate endpoint checks a live body against the operation schema', async () => {
  const admin = globalThis.__admin;
  const good = await admin.api('POST', '/api/contracts/validate', {
    specId: globalThis.__specId,
    method: 'GET',
    path: '/pets',
    statusCode: '200',
    response: { status: 200, body: JSON.stringify({ items: [{ id: '1', name: 'Rex' }] }) },
  });
  assert.equal(good.status, 200);
  assert.equal(good.json.result.valid, true);

  const bad = await admin.api('POST', '/api/contracts/validate', {
    specId: globalThis.__specId,
    method: 'GET',
    path: '/pets',
    statusCode: '200',
    response: { status: 200, body: JSON.stringify({ items: [{}] }) },
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.result.valid, false);
  assert.ok(bad.json.result.errors.length > 0);
});

test('contract checks attach to a request and evaluate on demand', async () => {
  const admin = globalThis.__admin;
  const request = globalThis.__requests.find((r) => r.method === 'GET' && r.url.endsWith('/pets'));
  assert.ok(request, 'GET /pets request was generated');

  const attach = await admin.api('POST', '/api/contracts/checks', {
    requestId: request.id,
    specId: globalThis.__specId,
    method: 'GET',
    path: '/pets',
    statusCode: '200',
  });
  assert.equal(attach.status, 201, `attach failed: ${JSON.stringify(attach.json)}`);
  const checkId = attach.json.check.id;

  const listed = await admin.api('GET', `/api/contracts/checks?requestId=${request.id}`);
  assert.equal(listed.json.checks.length, 1);
  assert.equal(listed.json.checks[0].specName, 'Pets API');

  const pass = await admin.api('POST', '/api/contracts/validate-request', {
    requestId: request.id,
    response: { status: 200, body: JSON.stringify({ items: [{ id: '1', name: 'Rex' }] }) },
  });
  assert.equal(pass.json.passed, true);
  assert.equal(pass.json.results.length, 1);
  assert.equal(pass.json.results[0].passed, true);

  const fail = await admin.api('POST', '/api/contracts/validate-request', {
    requestId: request.id,
    response: { status: 200, body: JSON.stringify({ items: [{}] }) },
  });
  assert.equal(fail.json.passed, false);

  const removed = await admin.api('DELETE', `/api/contracts/checks/${checkId}`);
  assert.equal(removed.status, 200);
  const after = await admin.api('GET', `/api/contracts/checks?requestId=${request.id}`);
  assert.equal(after.json.checks.length, 0);
});

test('diff endpoint flags breaking changes between two versions', async () => {
  const admin = globalThis.__admin;
  const res = await admin.api('POST', '/api/contracts/diff', { base: SPEC_V1, head: makeV2() });
  assert.equal(res.status, 200);
  assert.equal(res.json.diff.hasBreaking, true);
  const kinds = new Set(res.json.diff.breaking.map((change) => change.kind));
  assert.ok(kinds.has('path_removed'));
  assert.ok(kinds.has('method_removed'));
  assert.ok(kinds.has('required_field_removed'));
  assert.ok(kinds.has('field_type_changed'));
});
