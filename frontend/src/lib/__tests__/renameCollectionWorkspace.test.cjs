'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidebar = fs.readFileSync(
  path.join(__dirname, '../../components/Sidebar.tsx'),
  'utf8'
);
const api = fs.readFileSync(path.join(__dirname, '../api.ts'), 'utf8');
const store = fs.readFileSync(
  path.join(__dirname, '../../store/WorkspaceStore.tsx'),
  'utf8'
);
const shortcut = fs.readFileSync(
  path.join(__dirname, '../../components/useTreeRenameShortcut.ts'),
  'utf8'
);

test('contentApi can update a collection name', () => {
  assert.match(api, /updateCollection:/);
  assert.match(api, /\/api\/collections\/\$\{collectionId\}/);
});

test('workspaceApi can rename a workspace', () => {
  assert.match(api, /rename:\s*\(workspaceId/);
  assert.match(api, /method:\s*'PATCH'/);
});

test('WorkspaceStore exposes renameCollection and renameWorkspace', () => {
  assert.match(store, /renameCollection:/);
  assert.match(store, /renameWorkspace:/);
});

test('collection options menu includes Rename', () => {
  assert.match(sidebar, /rename-collection-/);
  assert.match(sidebar, /startRename\('collection'/);
});

test('workspace chips include Rename', () => {
  assert.match(sidebar, /rename-workspace-/);
  assert.match(sidebar, /renameWorkspace\(/);
});

test('F2 rename shortcut covers collections', () => {
  assert.match(shortcut, /kind: 'request' \| 'folder' \| 'collection'/);
});
