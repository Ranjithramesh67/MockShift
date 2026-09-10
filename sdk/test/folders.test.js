'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveFolderPath } = require('../src/folders');

test('defaults to the first path segment, title-cased', () => {
  assert.equal(resolveFolderPath({ path: '/users/:id' }, {}), 'Users');
  assert.equal(resolveFolderPath({ path: '/' }, {}), 'Root');
});

test('a string folder applies to every route', () => {
  assert.equal(resolveFolderPath({ path: '/users' }, { folder: 'Backend' }), 'Backend');
});

test('a function folder receives the route', () => {
  const config = { folder: (r) => `${r.method}/${r.path.split('/')[1]}` };
  assert.equal(resolveFolderPath({ method: 'GET', path: '/users' }, config), 'GET/Users');
});

test('structure uses the longest matching prefix', () => {
  const config = {
    structure: {
      '/users': 'Users',
      '/users/:id/posts': 'Users/Posts',
      '/admin': 'Admin',
    },
  };
  assert.equal(resolveFolderPath({ path: '/users/:id' }, config), 'Users');
  assert.equal(resolveFolderPath({ path: '/users/:id/posts' }, config), 'Users/Posts');
  assert.equal(resolveFolderPath({ path: '/admin/metrics' }, config), 'Admin');
});
