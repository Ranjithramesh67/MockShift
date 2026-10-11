'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createHub } = require('../src/index');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function get(port, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: opts.method || 'GET', headers: opts.headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('captures response structure and suggests assertions via the express adapter', async () => {
  const hub = createHub({ apiKey: 'k', file: false, autoSync: false });
  const app = express();
  app.use(express.json());
  app.get('/api/users/:id', (req, res) => res.json({ id: Number(req.params.id), name: 'Ada', active: true }));
  hub.express(app);
  const server = await listen(app);
  const { port } = server.address();

  await get(port, '/api/users/42');
  server.close();

  const route = hub.routes.find((r) => r.method === 'GET' && r.path === '/api/users/:id');
  assert.ok(route, 'route was auto-registered by the adapter');
  assert.equal(route.statusCode, 200);
  assert.equal(route.sampleCount, 1);
  assert.equal(route.apiType, 'REST');
  assert.equal(route.responseSchema.type, 'object');
  assert.equal(route.responseSchema.properties.name.type, 'string');
  assert.ok(route.assertions.some((a) => a.path === 'name'));
});

test('captures request payloads and merges samples', async () => {
  const hub = createHub({ apiKey: 'k', file: false, autoSync: false });
  const app = express();
  app.use(express.json());
  app.post('/api/widgets', (req, res) => res.status(201).json({ id: 1, label: req.body.name }));
  hub.express(app);
  const server = await listen(app);
  const { port } = server.address();

  await get(port, '/api/widgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Sprocket', qty: 2 }),
  });
  await get(port, '/api/widgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cog', qty: 5, color: 'red' }),
  });
  server.close();

  const route = hub.routes.find((r) => r.method === 'POST' && r.path === '/api/widgets');
  assert.ok(route);
  assert.equal(route.sampleCount, 2);
  assert.equal(route.bodyType, 'JSON');
  assert.equal(route.statusCode, 201);
  assert.ok(route.requestSchema.properties.color, 'second sample widened the request schema');
  assert.equal(route.formulaSuggestions.length > 0, true);
});

test('attaches to a plain http server', async () => {
  const hub = createHub({ apiKey: 'k', file: false, autoSync: false });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  hub.http(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  await get(port, '/health');
  server.close();

  const route = hub.routes.find((r) => r.path === '/health');
  assert.ok(route);
  assert.equal(route.responseSchema.properties.ok.type, 'boolean');
});

test('honours exclude prefixes when capturing', async () => {
  const hub = createHub({ apiKey: 'k', file: false, autoSync: false, exclude: ['/internal'] });
  const app = express();
  app.get('/internal/ping', (req, res) => res.json({ ok: true }));
  app.get('/public/ping', (req, res) => res.json({ ok: true }));
  hub.express(app);
  const server = await listen(app);
  const { port } = server.address();

  await get(port, '/internal/ping');
  await get(port, '/public/ping');
  server.close();

  assert.ok(!hub.routes.some((r) => r.path === '/internal/ping'));
  assert.ok(hub.routes.some((r) => r.path === '/public/ping'));
});

test('never lets capture errors break the response', async () => {
  const hub = createHub({ apiKey: 'k', file: false, autoSync: false });
  const app = express();
  app.get('/boom', (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  // Force finalize to throw.
  const originalRecord = hub.record.bind(hub);
  hub.record = () => { throw new Error('record exploded'); };
  hub.express(app);
  const server = await listen(app);
  const { port } = server.address();
  const res = await get(port, '/boom');
  server.close();
  hub.record = originalRecord;
  assert.equal(res.status, 200);
  assert.equal(res.raw, '{"ok":true}');
});
