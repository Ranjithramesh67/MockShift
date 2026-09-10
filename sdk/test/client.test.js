'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('../src/client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('posts the manifest with a Bearer token and returns the body', async () => {
  let seen = null;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ summary: { requests: { created: 1 } } }));
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createClient({ baseUrl: base, apiKey: 'secret', timeoutMs: 2000 });
  const out = await client.sync({ requests: [{ method: 'GET', path: '/health' }] });
  assert.equal(out.summary.requests.created, 1);
  assert.equal(seen.url, '/api/sdk/sync');
  assert.equal(seen.auth, 'Bearer secret');
  assert.ok(Array.isArray(seen.body.requests));
  server.close();
});

test('throws ApiHubError with the status on a non-2xx response', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'nope' }));
  });
  const client = createClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'k', timeoutMs: 2000 });
  await assert.rejects(() => client.sync({}), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /nope/);
    return true;
  });
  server.close();
});
