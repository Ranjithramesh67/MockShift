'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileRoutePath, matchRoutePath } = require('../../mock/pathMatcher');

test('exact static path matches', () => {
  const res = matchRoutePath('/users', '/users');
  assert.ok(res);
  assert.deepEqual(res.params, {});
});

test('static path requires exact match', () => {
  assert.equal(matchRoutePath('/users', '/users/1'), null);
  assert.equal(matchRoutePath('/users/1', '/users'), null);
});

test('trailing slashes are normalized', () => {
  assert.ok(matchRoutePath('/users', '/users/'));
  assert.ok(matchRoutePath('/users/', '/users'));
  assert.ok(matchRoutePath('/', '/'));
});

test('named param captures a single segment', () => {
  const res = matchRoutePath('/users/:id', '/users/42');
  assert.ok(res);
  assert.deepEqual(res.params, { id: '42' });
});

test('named param does not cross slash boundaries', () => {
  assert.equal(matchRoutePath('/users/:id', '/users/42/posts'), null);
});

test('multiple params + static segments', () => {
  const res = matchRoutePath('/api/:version/users/:id', '/api/v1/users/7');
  assert.ok(res);
  assert.deepEqual(res.params, { version: 'v1', id: '7' });
});

test('param values are URL-decoded', () => {
  const res = matchRoutePath('/users/:id', '/users/a%20b');
  assert.ok(res);
  assert.deepEqual(res.params, { id: 'a b' });
});

test('regex metacharacters in static segments are escaped', () => {
  assert.ok(matchRoutePath('/a.b/c', '/a.b/c'));
  assert.equal(matchRoutePath('/a.b/c', '/aXb/c'), null);
});

test('empty param segment is rejected gracefully', () => {
  assert.equal(matchRoutePath('/users/:/posts', '/users/1/posts'), null);
});

test('compileRoutePath throws on empty param name', () => {
  assert.throws(() => compileRoutePath('/users/:'), /empty param segment/);
});
