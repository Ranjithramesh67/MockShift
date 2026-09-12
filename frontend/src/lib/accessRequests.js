'use strict';

function mergeMyRequests(projectRows, workspaceRows) {
  const rows = [];
  for (const r of projectRows || []) {
    rows.push({
      id: r.id,
      kind: 'project',
      projectId: r.project_id,
      title: r.project_name || 'Project',
      role: r.role || null,
      status: r.status,
      reason: r.reason || null,
      requestedAt: r.requested_at,
      cancellable: r.status === 'PENDING',
    });
  }
  for (const r of workspaceRows || []) {
    rows.push({
      id: r.id,
      kind: 'workspace',
      workspaceId: r.workspaceId,
      title: r.workspaceName || 'Workspace',
      role: null,
      status: r.status,
      reason: r.reason || null,
      requestedAt: r.requestedAt,
      cancellable: r.status === 'PENDING',
    });
  }
  rows.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  return rows;
}

module.exports = { mergeMyRequests };
