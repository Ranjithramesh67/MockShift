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

test('records routes on a router mounted after attach', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);
  const api = express.Router();
  app.use('/api', api);
  api.get('/users', (req, res) => res.end());
  api.post('/users', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key).sort(), [
    'GET /api/users',
    'POST /api/users',
  ]);
});

test('records routes defined before the router is mounted', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);
  const api = express.Router();
  api.get('/health', (req, res) => res.end());
  app.use('/api', api);
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/health']);
});

test('composes nested router mounts', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);
  const api = express.Router();
  const v1 = express.Router();
  api.use('/v1', v1);
  v1.get('/users/:id', (req, res) => res.end());
  app.use('/api', api);
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/v1/users/:id']);
});

test('records routes mounted before attach (Express 4 prefix recovery)', () => {
  const app = express();
  const api = express.Router();
  const v1 = express.Router();
  v1.get('/users', (req, res) => res.end());
  api.use('/v1', v1);
  app.use('/api', api);
  app.get('/root', (req, res) => res.end());

  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);

  assert.deepEqual(hub.manifest().requests.map((r) => r.key).sort(), [
    'GET /api/v1/users',
    'GET /root',
  ]);
});

test('keeps a parameterised mount prefix', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);
  const api = express.Router();
  app.use('/api/:version', api);
  api.get('/users', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/:version/users']);
});

test('applies include filters to the composed router path', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false, include: ['/api'] });
  hub.express(app);
  const api = express.Router();
  app.use('/api', api);
  app.use('/internal', express.Router());
  api.get('/users', (req, res) => res.end());
  app.get('/internal/health', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/users']);
});

test('records a router mounted twice under both prefixes', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);
  const shared = express.Router();
  app.use('/v1', shared);
  app.use('/v2', shared);
  shared.get('/ping', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key).sort(), [
    'GET /v1/ping',
    'GET /v2/ping',
  ]);
});

test('normalizes index routes and composes parameterised nested mounts', () => {
  const app = express();
  const api = express.Router();
  const v1 = express.Router();
  const orders = express.Router();
  const items = express.Router({ mergeParams: true });

  orders.use('/:orderId/items', items);
  items.get('/', (req, res) => res.end());
  orders.get('/', (req, res) => res.end());
  v1.use('/orders', orders);
  api.use('/v1', v1);
  app.use('/api', api);

  const hub = createHub({ apiKey: 'k', autoSync: false });
  hub.express(app);

  assert.deepEqual(hub.manifest().requests.map((r) => r.key).sort(), [
    'GET /api/v1/orders',
    'GET /api/v1/orders/:orderId/items',
  ]);
});
