'use strict';

// Integration tests for the ephemeral run endpoint POST /api/runs:
// executes an in-memory request shape without a stored request, optionally
// resolving env vars + auth provider via collectionId, and only writing
// run_history when persistHistory is true.

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

function psqlScalar(sql) {
  const out = execFileSync(
    'psql',
    ['-t', '-A', '-c', sql],
    { env: PGENV, stdio: 'pipe', encoding: 'utf8' }
  );
  return out.trim();
}

let server;
let base;
let mockUpstream;

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
let projectId;
let collectionId;
let mockBase;
let multipartStoredRequestId;

const MULTIPART_SAVED_PARTS = [{ key: 'title', kind: 'text', value: 'saved text' }];

before(async () => {
  psqlReset();
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'apihub', '-f', path.join(ROOT, 'db', 'migrations', file)], {
      env: PGENV,
      stdio: 'pipe',
    });
  }

  mockUpstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (req.url === '/upload-echo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            url: req.url,
            method: req.method,
            contentType: req.headers['content-type'] || null,
            length: buf.length,
            body: buf.toString('utf8'),
          })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, method: req.method, echoed: true }));
    });
  });
  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));
  mockBase = `http://127.0.0.1:${mockUpstream.address().port}`;

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
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'runadmin@test.io',
    password: 'adminpass123',
    name: 'Run Admin',
  });
  assert.equal(signup.status, 201, 'admin signup');

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  projectId = content.json.projects.find((p) => p.name === 'Default Project').id;

  const col = await admin.api('POST', '/api/collections', { projectId, name: 'Ephemeral Col' });
  assert.equal(col.status, 201, 'create collection');
  collectionId = col.json.collection.id;

  const env = await admin.api('POST', `/api/workspaces/${myWs.id}/environments`, {
    name: 'Ephemeral Env',
    makeActive: true,
  });
  assert.equal(env.status, 201, 'create active environment');
  const environmentId = env.json.environment.id;

  const v1 = await admin.api('POST', `/api/environments/${environmentId}/variables`, {
    key: 'EPHEMERAL_VAR',
    value: 'hello-from-env',
  });
  assert.equal(v1.status, 201, 'create env variable');
  const v2 = await admin.api('POST', `/api/environments/${environmentId}/variables`, {
    key: 'MOCK_BASE',
    value: mockBase,
  });
  assert.equal(v2.status, 201, 'create MOCK_BASE variable');
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mockUpstream) await new Promise((r) => mockUpstream.close(r));
  const { shutdownWorkflows } = require('../src/api/workflowService');
  await shutdownWorkflows();
  await require('../src/api/db').pool.end();
});

test('ephemeral run without a collection executes and persists no history', async () => {
  const beforeCount = psqlScalar('SELECT count(*) FROM run_history');

  const res = await admin.api('POST', '/api/runs', {
    method: 'GET',
    url: `${mockBase}/plain?x=1`,
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.runStatus, 'SUCCESS');
  assert.equal(res.json.httpStatus, 200);
  assert.equal(res.json.runId, null);
  assert.equal(res.json.response.status, 200);
  assert.equal(res.json.response.body, JSON.stringify({ url: '/plain?x=1', method: 'GET', echoed: true }));
  assert.deepEqual(res.json.variables, {});

  const afterCount = psqlScalar('SELECT count(*) FROM run_history');
  assert.equal(afterCount, beforeCount, 'no run_history row when persistHistory is false');
});

test('ephemeral run with collectionId resolves env vars and applies headers/body', async () => {
  const res = await admin.api('POST', '/api/runs', {
    collectionId,
    method: 'POST',
    url: '{{MOCK_BASE}}/vars?q={{EPHEMERAL_VAR}}',
    headers: [{ key: 'X-Test', value: '{{EPHEMERAL_VAR}}', enabled: true }],
    bodyType: 'JSON',
    bodyJson: { nested: { value: '{{EPHEMERAL_VAR}}' } },
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.runStatus, 'SUCCESS');
  assert.equal(res.json.variables.EPHEMERAL_VAR, 'hello-from-env');
  assert.equal(res.json.requestSnapshot.url, `${mockBase}/vars?q=hello-from-env`);
  assert.equal(res.json.requestSnapshot.headers['X-Test'], 'hello-from-env');
  assert.equal(res.json.response.status, 200);
});

test('ephemeral run with persistHistory=true writes a request_id NULL history row', async () => {
  const beforeCount = Number(psqlScalar('SELECT count(*) FROM run_history'));

  const res = await admin.api('POST', '/api/runs', {
    collectionId,
    persistHistory: true,
    method: 'GET',
    url: `${mockBase}/persist`,
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.runStatus, 'SUCCESS');
  assert.ok(res.json.runId, 'runId returned when history persisted');

  const afterCount = Number(psqlScalar('SELECT count(*) FROM run_history'));
  assert.equal(afterCount, beforeCount + 1, 'one run_history row written');

  const row = psqlScalar(
    `SELECT request_id FROM run_history WHERE id = '${res.json.runId}'`
  );
  assert.equal(row, '', 'request_id is NULL for an ephemeral run');

  const list = await admin.api('GET', '/api/history?limit=10');
  assert.equal(list.status, 200);
  assert.ok(list.json.runs.some((r) => r.id === res.json.runId), 'history list includes the ephemeral run');
});

test('ephemeral run validates the URL scheme', async () => {
  const res = await admin.api('POST', '/api/runs', {
    method: 'GET',
    url: 'file:///etc/passwd',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Unsupported URL scheme/);
});

test('ephemeral run requires read access when a collectionId is given', async () => {
  const stranger = makeClient();
  const signup = await stranger.api('POST', '/api/auth/signup', {
    email: 'stranger@test.io',
    password: 'strangerpass123',
    name: 'Stranger',
  });
  assert.equal(signup.status, 201, 'stranger signup');

  const res = await stranger.api('POST', '/api/runs', {
    collectionId,
    method: 'GET',
    url: `${mockBase}/forbidden`,
  });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /No access/);
});

test('ephemeral multipart run sends text + file parts as real multipart/form-data', async () => {
  const fileBytes = Buffer.from('hello-file-bytes');
  const res = await admin.api('POST', '/api/runs', {
    method: 'POST',
    url: `${mockBase}/upload-echo`,
    bodyType: 'MULTIPART',
    bodyParts: [
      { key: 'title', enabled: true, kind: 'text', value: 'Hi there' },
      {
        key: 'avatar',
        enabled: true,
        kind: 'file',
        fileName: 'a.txt',
        fileType: 'text/plain',
        data: fileBytes.toString('base64'),
      },
    ],
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.runStatus, 'SUCCESS');
  assert.equal(res.json.httpStatus, 200);
  assert.equal(res.json.response.status, 200);

  const echoed = JSON.parse(res.json.response.body);
  assert.ok(
    echoed.contentType.startsWith('multipart/form-data'),
    `wire content-type is ${echoed.contentType}`
  );
  assert.ok(echoed.body.includes('name="title"'), 'text part name header present on the wire');
  assert.ok(echoed.body.includes('Hi there'), 'text part value present on the wire');
  assert.ok(echoed.body.includes('name="avatar"'), 'file part name header present on the wire');
  assert.ok(echoed.body.includes('filename="a.txt"'), 'file part filename present on the wire');
  assert.ok(echoed.body.includes('hello-file-bytes'), 'file bytes present on the wire');

  assert.ok(
    !String(res.json.requestSnapshot.body).includes('hello-file-bytes'),
    'request snapshot omits the raw file bytes'
  );
  assert.ok(
    String(res.json.requestSnapshot.body).includes('title=Hi there'),
    'request snapshot carries the compact text-part summary'
  );
});

test('ephemeral multipart run rejects a file part with no data', async () => {
  const res = await admin.api('POST', '/api/runs', {
    method: 'POST',
    url: `${mockBase}/upload-echo`,
    bodyType: 'MULTIPART',
    bodyParts: [
      { key: 'avatar', enabled: true, kind: 'file', fileName: 'a.txt', fileType: 'text/plain' },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Missing file data/);
});

test('multipart file part exceeding 10MB is rejected', async () => {
  const big = Buffer.alloc(11 * 1024 * 1024, 0x61);
  const res = await admin.api('POST', '/api/runs', {
    method: 'POST',
    url: `${mockBase}/upload-echo`,
    bodyType: 'MULTIPART',
    bodyParts: [
      {
        key: 'bigfile',
        enabled: true,
        kind: 'file',
        fileName: 'big.bin',
        fileType: 'application/octet-stream',
        data: big.toString('base64'),
      },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /10 MB file limit/);
});

test('stored request round-trips multipart text parts and runs via POST /requests/:id/run', async () => {
  const created = await admin.api('POST', '/api/requests', {
    collectionId,
    name: 'Multipart Stored Req',
    method: 'POST',
    url: `${mockBase}/upload-echo`,
    apiType: 'REST',
  });
  assert.equal(created.status, 201, 'create stored request');
  multipartStoredRequestId = created.json.request.id;

  const put = await admin.api('PUT', `/api/requests/${multipartStoredRequestId}`, {
    method: 'POST',
    url: `${mockBase}/upload-echo`,
    bodyType: 'MULTIPART',
    bodyParts: MULTIPART_SAVED_PARTS,
  });
  assert.equal(put.status, 200, 'update stored request with multipart parts');

  const got = await admin.api('GET', `/api/requests/${multipartStoredRequestId}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.request.bodyType, 'MULTIPART');
  assert.deepEqual(got.json.request.bodyParts, MULTIPART_SAVED_PARTS, 'bodyParts round-trips');

  const run = await admin.api('POST', `/api/requests/${multipartStoredRequestId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.runStatus, 'SUCCESS');
  assert.equal(run.json.httpStatus, 200);
  const echoed = JSON.parse(run.json.response.body);
  assert.ok(echoed.body.includes('name="title"'), 'stored run sends the text part name');
  assert.ok(echoed.body.includes('saved text'), 'stored run sends the text part value');
});

test('duplicate preserves body_parts', async () => {
  assert.ok(multipartStoredRequestId, 'stored request from round-trip test exists');

  const dup = await admin.api('POST', `/api/requests/${multipartStoredRequestId}/duplicate`);
  assert.equal(dup.status, 201, 'duplicate stored request');
  const copyId = dup.json.request.id;
  assert.notEqual(copyId, multipartStoredRequestId, 'duplicate gets a fresh id');

  const got = await admin.api('GET', `/api/requests/${copyId}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.request.bodyType, 'MULTIPART');
  assert.deepEqual(got.json.request.bodyParts, MULTIPART_SAVED_PARTS, 'duplicate keeps bodyParts');
});
