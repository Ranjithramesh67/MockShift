'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureLeadingSlash, pathToRequestPath, mockRouteUrl, filterMockRoutes } = require('../mockRoutes');

test('ensureLeadingSlash normalizes paths', () => {
  assert.equal(ensureLeadingSlash('users'), '/users');
  assert.equal(ensureLeadingSlash('/users'), '/users');
  assert.equal(ensureLeadingSlash('  '), '/');
});

test('pathToRequestPath converts :params to {{param}} placeholders', () => {
  assert.equal(pathToRequestPath('/users/:id'), '/users/{{id}}');
  assert.equal(pathToRequestPath('/orders/:orderId/items/:itemId'), '/orders/{{orderId}}/items/{{itemId}}');
  assert.equal(pathToRequestPath('users'), '/users');
});

test('mockRouteUrl joins base and converted path without double slashes', () => {
  assert.equal(
    mockRouteUrl('http://127.0.0.1:3001/mock/p1', '/users/:id'),
    'http://127.0.0.1:3001/mock/p1/users/{{id}}'
  );
  assert.equal(
    mockRouteUrl('http://127.0.0.1:3001/mock/p1/', 'users'),
    'http://127.0.0.1:3001/mock/p1/users'
  );
});

test('filterMockRoutes matches method and path case-insensitively', () => {
  const routes = [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/orders' },
  ];
  assert.equal(filterMockRoutes(routes, '').length, 2);
  assert.equal(filterMockRoutes(routes, 'post').length, 1);
  assert.equal(filterMockRoutes(routes, 'users').length, 1);
  assert.equal(filterMockRoutes(routes, 'orders').length, 1);
  assert.equal(filterMockRoutes(routes, 'nope').length, 0);
});
