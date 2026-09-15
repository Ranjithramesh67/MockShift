'use strict';

// Regression tests for HIGH-1: API token scopes must be enforced on every
// authenticated route, not only the SDK and server-run endpoints. Before the
// fix a `read`-scope token could create, modify and delete content.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;
let upstream;
let upstreamBase;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
});

after(async () => {
  if (closeApp) await closeApp();
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
});

async function bearer(method, path, token, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function issueToken(client, scopes) {
  const res = await client.api('POST', '/api/tokens', { name: `tok-${scopes.join('-')}`, scopes });
  assert.equal(res.status, 201, `issue ${scopes.join('-')} token: ${JSON.stringify(res.json)}`);
  return res.json.token;
}

async function seed(client) {
  const ws = await client.api('POST', '/api/workspaces', { name: 'Token Scope WS' });
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Token Scope Col' });
  assert.equal(col.status, 201);
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Token Scope Request',
    method: 'GET',
    url: `${upstreamBase}/ok`,
  });
  assert.equal(req.status, 201);
  return { projectId, collectionId: col.json.collection.id, requestId: req.json.request.id };
}

test('a read-scope token can read but not mutate', async () => {
  const owner = await signupAndLogin(base, 'token-reader@test.io', 'readerpass123', 'Reader');
  const { projectId, collectionId } = await seed(owner.client);
  const token = await issueToken(owner.client, ['read']);

  const read = await bearer('GET', '/api/workspaces', token);
  assert.equal(read.status, 200, 'read token may read');

  const create = await bearer('POST', '/api/collections', token, { projectId, name: 'Nope' });
  assert.equal(create.status, 403, `read token must not create; got ${create.status}`);

  const remove = await bearer('DELETE', `/api/collections/${collectionId}`, token);
  assert.equal(remove.status, 403, `read token must not delete; got ${remove.status}`);
});

test('a write-scope token retains full access', async () => {
  const owner = await signupAndLogin(base, 'token-writer@test.io', 'writerpass123', 'Writer');
  const { projectId, collectionId } = await seed(owner.client);
  const token = await issueToken(owner.client, ['write']);

  const create = await bearer('POST', '/api/collections', token, { projectId, name: 'Written' });
  assert.equal(create.status, 201, `write token may create; got ${create.status}`);

  const remove = await bearer('DELETE', `/api/collections/${collectionId}`, token);
  assert.equal(remove.status, 200, `write token may delete; got ${remove.status}`);
});

test('a runs-scope token may run a request but not create content', async () => {
  const owner = await signupAndLogin(base, 'token-runner@test.io', 'runnerpass123', 'Runner');
  const { projectId, requestId } = await seed(owner.client);
  const token = await issueToken(owner.client, ['runs']);

  const run = await bearer('POST', `/api/requests/${requestId}/run`, token, {});
  assert.equal(run.status, 200, `runs token may run; got ${run.status} ${JSON.stringify(run.json)}`);

  const create = await bearer('POST', '/api/collections', token, { projectId, name: 'Nope' });
  assert.equal(create.status, 403, `runs token must not create; got ${create.status}`);
});
