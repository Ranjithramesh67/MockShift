'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STORAGE_KEY,
  canCreateProject,
  resolveActiveProject,
  readPersistedProject,
  persistActiveProject,
  collectionsForProject,
} = require('../activeProject.js');

test('canCreateProject is true for workspace or platform MANAGER+', () => {
  assert.equal(canCreateProject('ADMIN', 'EDITOR'), true);
  assert.equal(canCreateProject('MANAGER', 'VIEWER'), true);
  assert.equal(canCreateProject('EDITOR', 'ADMIN'), true);
  assert.equal(canCreateProject('EDITOR', 'MANAGER'), true);
  assert.equal(canCreateProject('EDITOR', 'EDITOR'), false);
  assert.equal(canCreateProject(null, 'VIEWER'), false);
});

test('resolveActiveProject prefers a still-valid saved id, else first accessible', () => {
  const tree = {
    projects: [
      { id: 'locked', can_access: false },
      { id: 'a', can_access: true },
      { id: 'b', can_access: true },
    ],
  };
  assert.equal(resolveActiveProject(tree, 'b'), 'b');
  assert.equal(resolveActiveProject(tree, 'gone'), 'a');
  assert.equal(resolveActiveProject(tree, null), 'a');
  assert.equal(resolveActiveProject({ projects: [] }, 'a'), null);
});

test('persist/read round-trips per workspace', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  persistActiveProject(storage, 'ws1', 'p1');
  persistActiveProject(storage, 'ws2', 'p2');
  assert.equal(readPersistedProject(storage, 'ws1'), 'p1');
  assert.equal(readPersistedProject(storage, 'ws2'), 'p2');
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).ws1, 'p1');
});

test('collectionsForProject filters by project_id', () => {
  const tree = {
    collections: [
      { id: 'c1', project_id: 'p1' },
      { id: 'c2', project_id: 'p2' },
    ],
  };
  assert.deepEqual(collectionsForProject(tree, 'p1').map((c) => c.id), ['c1']);
});
