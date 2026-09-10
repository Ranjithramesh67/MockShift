'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKey,
  normalizeManifest,
  nestFolders,
  joinUrl,
  pickUniqueName,
} = require('../sdkManifest');

test('normalizeKey upper-cases the method and trims the path', () => {
  assert.equal(normalizeKey('get', '/users/:id'), 'GET /users/:id');
  assert.equal(normalizeKey('POST', 'users'), 'POST /users');
});

test('nestFolders orders parents before children and assigns depth', () => {
  const out = nestFolders([
    { key: 'Users/Admin', name: 'Admin', parent: 'Users' },
    { key: 'Users', name: 'Users', parent: null },
  ]);
  assert.deepEqual(out.map((f) => f.key), ['Users', 'Users/Admin']);
  assert.equal(out[0].depth, 0);
  assert.equal(out[1].depth, 1);
  assert.equal(out[1].parent, 'Users');
});

test('nestFolders rejects an unknown parent key', () => {
  assert.throws(
    () => nestFolders([{ key: 'a', name: 'A', parent: 'missing' }]),
    /unknown parent/
  );
});

test('nestFolders rejects cycles', () => {
  assert.throws(
    () => nestFolders([
      { key: 'a', name: 'A', parent: 'b' },
      { key: 'b', name: 'B', parent: 'a' },
    ]),
    /cycle/
  );
});

test('joinUrl avoids duplicate slashes', () => {
  assert.equal(joinUrl('http://x/', '/users'), 'http://x/users');
  assert.equal(joinUrl('http://x', 'users'), 'http://x/users');
  assert.equal(joinUrl('', '/users'), '/users');
});

test('pickUniqueName suffixes collisions case-insensitively', () => {
  assert.equal(pickUniqueName('Users', []), 'Users');
  assert.equal(pickUniqueName('users', ['Users']), 'users (copy)');
  assert.equal(pickUniqueName('Users', ['Users', 'Users (copy)']), 'Users (copy) 2');
});

test('normalizeManifest validates the shape and defaults', () => {
  const m = normalizeManifest({
    source: 'express',
    requests: [{ method: 'get', path: '/health' }],
  });
  assert.equal(m.source, 'express');
  assert.equal(m.prune, false);
  assert.deepEqual(m.folders, []);
  assert.equal(m.requests[0].method, 'GET');
  assert.equal(m.requests[0].key, 'GET /health');
  assert.equal(m.requests[0].name, 'GET /health');
  assert.equal(m.requests[0].url, '/health');
});

test('normalizeManifest rejects non-array folders/requests', () => {
  assert.throws(() => normalizeManifest({ requests: 'nope' }), /requests must be an array/);
});

test('normalizeManifest rejects a request without method or path', () => {
  assert.throws(() => normalizeManifest({ requests: [{ method: 'GET' }] }), /requires method and path/);
});
