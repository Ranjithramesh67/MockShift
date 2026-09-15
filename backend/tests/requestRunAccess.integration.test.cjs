'use strict';

// Regression test for BLK-2: POST /api/requests/:requestId/run must require
// project read access. Before the fix, any authenticated user could run
// another tenant's stored request and receive its resolved environment
// variables, auth token and substituted request snapshot.

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

async function seedRequest(client) {
  const ws = await client.api('POST', '/api/workspaces', { name: 'Run Access WS' });
  assert.equal(ws.status, 201, `create workspace: ${ws.status} ${JSON.stringify(ws.json)}`);
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  assert.equal(tree.status, 200, `workspace content: ${tree.status} ${JSON.stringify(tree.json)}`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Run Access Col' });
  assert.equal(col.status, 201);
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Run Access Request',
    method: 'GET',
    url: `${upstreamBase}/ok`,
  });
  assert.equal(req.status, 201);
  return req.json.request.id;
}

test('a non-member cannot run another org\u2019s stored request', async () => {
  const owner = await signupAndLogin(base, 'run-owner@test.io', 'ownerpass123', 'Owner');
  const requestId = await seedRequest(owner.client);

  const intruder = await signupAndLogin(base, 'run-intruder@test.io', 'intruderpass123', 'Intruder');
  const res = await intruder.client.api('POST', `/api/requests/${requestId}/run`, {});

  assert.equal(res.status, 403, `expected 403, got ${res.status} ${JSON.stringify(res.json)}`);
  assert.equal(res.json.variables, undefined, 'no env vars leaked to a non-member');
  assert.equal(res.json.requestSnapshot, undefined, 'no request snapshot leaked to a non-member');
});

test('the owner can still run their own stored request', async () => {
  const owner = await signupAndLogin(base, 'run-owner2@test.io', 'ownerpass123', 'Owner');
  const requestId = await seedRequest(owner.client);

  const res = await owner.client.api('POST', `/api/requests/${requestId}/run`, {});
  assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
  assert.equal(res.json.runStatus, 'SUCCESS');
});
