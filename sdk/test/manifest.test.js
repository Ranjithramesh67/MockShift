'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildManifest } = require('../src/manifest');

const config = {
  source: 'express',
  project: 'Pets',
  workspace: 'Acme',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  prune: false,
  folder: (r) => r.path.split('/').filter(Boolean)[0] || 'Root',
};

const routes = [
  { method: 'GET', path: '/users', name: 'List users' },
  { method: 'GET', path: '/users/:id', name: 'Get user' },
  { method: 'POST', path: '/users', name: 'Create user', bodyType: 'JSON', bodyJson: { name: 'x' } },
];

test('builds nested folders from multi-segment folder paths', () => {
  const m = buildManifest(routes, { ...config, folder: () => 'Users/Admin' });
  assert.deepEqual(m.folders.map((f) => f.key), ['Users', 'Users/Admin']);
  assert.equal(m.folders[1].parent, 'Users');
  assert.ok(m.requests.every((r) => r.folder === 'Users/Admin'));
});

test('assigns stable external keys and base-url\'d request urls', () => {
  const m = buildManifest(routes, config);
  assert.ok(m.requests.some((r) => r.key === 'GET /users/:id'));
  const get = m.requests.find((r) => r.key === 'GET /users/:id');
  assert.equal(get.url, 'http://localhost:4000/users/:id');
  assert.equal(get.folder, 'Users');
});

test('deduplicates identical method+path routes', () => {
  const m = buildManifest(
    [...routes, { method: 'GET', path: '/users', name: 'List users again' }],
    config
  );
  assert.equal(m.requests.filter((r) => r.key === 'GET /users').length, 1);
});

test('normalizes explicitly provided route folders', () => {
  const m = buildManifest(
    [{ method: 'GET', path: '/users/admin', name: 'Admin list', folder: 'users/admin' }],
    config
  );
  const request = m.requests.find((r) => r.key === 'GET /users/admin');
  assert.equal(request.folder, 'Users/Admin');
  assert.deepEqual(m.folders.map((f) => f.key), ['Users', 'Users/Admin']);
});
