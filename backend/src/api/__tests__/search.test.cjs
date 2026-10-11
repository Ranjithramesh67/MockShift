'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups } = require('../search');

test('escapeLike escapes % _ and backslash', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('normalizeQuery trims, caps limit and rejects blanks', () => {
  assert.equal(normalizeQuery('  api  ').ok, true);
  assert.equal(normalizeQuery('  api  ').q, 'api');
  assert.equal(normalizeQuery('x', 9999).limit, 50);
  assert.equal(normalizeQuery('   ').ok, false);
});

test('rankResult prefers prefix then substring', () => {
  assert.ok(rankResult({ name: 'Users' }, 'use') < rankResult({ name: 'List users' }, 'use'));
});

test('menuKeyForType maps feature menus', () => {
  assert.equal(menuKeyForType('doc'), 'docs');
  assert.equal(menuKeyForType('contract'), 'contracts');
  assert.equal(menuKeyForType('monitor'), 'monitors');
  assert.equal(menuKeyForType('mockScenario'), 'mock-scenarios');
  assert.equal(menuKeyForType('request'), 'apis');
});

test('flattenGroups attaches type and sorts by rank then name', () => {
  const flat = flattenGroups({ request: [{ id: '1', name: 'zebra', rank: 9 }, { id: '2', name: 'Apple api', rank: 1 }] });
  assert.deepEqual(flat.map((r) => r.id), ['2', '1']);
  assert.equal(flat[0].type, 'request');
});
