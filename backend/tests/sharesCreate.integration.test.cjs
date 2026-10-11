'use strict';

// HIGH-5 — POST /api/shares raced its own existence check: two concurrent
// creates (React StrictMode's double effect) both saw no row and both INSERTed,
// so one lost on the (item_type, item_id) unique key and surfaced a raw
// duplicate-key 500. Creation now upserts on the natural key.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

async function makeRequest(client, wsName) {
  const ws = await client.api('POST', '/api/workspaces', { name: wsName });
  const tree = await client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = tree.json.projects[0].id;
  const col = await client.api('POST', '/api/collections', { projectId, name: 'Outbox' });
  const req = await client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.com/ping',
  });
  return req.json.request.id;
}

test('concurrent share creates converge on one token', async () => {
  const { client } = await signupAndLogin(base, 'sharer@test.io', 'sharerpass123', 'Sharer');
  const requestId = await makeRequest(client, 'Share WS');

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      client.api('POST', '/api/shares', { itemType: 'request', itemId: requestId })
    )
  );

  for (const res of results) {
    assert.equal(res.status, 201);
  }
  const tokens = new Set(results.map((res) => res.json.share.token));
  assert.equal(tokens.size, 1);

  const again = await client.api('POST', '/api/shares', { itemType: 'request', itemId: requestId });
  assert.equal(again.status, 201);
  assert.equal(again.json.share.token, results[0].json.share.token);
});
