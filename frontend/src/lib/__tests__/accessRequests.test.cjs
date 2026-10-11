'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeMyRequests } = require('../accessRequests.js');

test('mergeMyRequests tags and sorts project and workspace requests', () => {
  const project = [{ id: 'p1', project_id: 'pr1', role: 'VIEWER', status: 'PENDING', requested_at: '2026-01-01T00:00:00Z', project_name: 'Alpha' }];
  const workspace = [{ id: 'w1', workspaceId: 'ws1', workspaceName: 'Beta', status: 'PENDING', requestedAt: '2026-01-02T00:00:00Z', requester: {}, requesterId: 'u', reviewedBy: null, reviewedAt: null, reason: null }];
  const rows = mergeMyRequests(project, workspace);
  assert.equal(rows[0].kind, 'workspace');
  assert.equal(rows[0].title, 'Beta');
  assert.equal(rows[0].workspaceId, 'ws1');
  assert.equal(rows[1].kind, 'project');
  assert.equal(rows[1].title, 'Alpha');
  assert.equal(rows[1].projectId, 'pr1');
});

test('mergeMyRequests tolerates null inputs', () => {
  assert.deepEqual(mergeMyRequests(null, undefined), []);
});
