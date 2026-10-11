'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHub } = require('../src/index');

test('records routes registered after attach and ignores settings lookups', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false, targetBaseUrl: 'http://localhost:4000' });
  hub.express(app);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.post('/users', (req, res) => res.status(201).end());
  // Express's app.get(name) settings accessor must not be recorded as a route.
  app.get('env');
  const keys = hub.manifest().requests.map((r) => r.key).sort();
  assert.deepEqual(keys, ['GET /health', 'POST /users']);
});

test('respects include and exclude filters', () => {
  const app = express();
  const hub = createHub({
    apiKey: 'k',
    autoSync: false,
    include: ['/api'],
    exclude: ['/api/internal'],
  });
  hub.express(app);
  app.get('/api/users', (req, res) => res.end());
  app.get('/api/internal/health', (req, res) => res.end());
  app.get('/public', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/users']);
});

test('autoSync triggers a sync when the server starts listening', async () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: true });
  hub.express(app);
  let synced = 0;
  hub.client = { sync: async () => { synced += 1; return { summary: {} }; } };
  app.get('/ping', (req, res) => res.end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  server.close();
  assert.equal(synced, 1);
});
