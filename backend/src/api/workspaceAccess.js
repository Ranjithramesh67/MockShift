'use strict';

const { query } = require('./db');
const { roleAtLeast, getWorkspaceRole, canReadWorkspace } = require('./access');
const { logAudit } = require('./audit');
const { notifyUser } = require('./notify');

// Platform MANAGER/ADMIN users act as workspace admins everywhere.
function isGlobalHigh(user) {
  return Boolean(user) && roleAtLeast(user.role, 'MANAGER');
}

// Effective workspace access for the caller:
//   { role: 'ADMIN'|'MANAGER'|'EDITOR'|'VIEWER'|null, readable: boolean }
// readable follows access.js canReadWorkspace (direct/team/org-admin
// membership, PUBLIC visibility within an org, project grants) or the platform
// MANAGER/ADMIN bypass.
async function workspaceAccessFor(user, workspaceId) {
  if (isGlobalHigh(user)) return { role: 'ADMIN', readable: true };
  const role = await getWorkspaceRole(user.id, workspaceId);
  const readable = Boolean(role) || (await canReadWorkspace(user.id, workspaceId));
  return { role, readable };
}

// Request: {id,workspaceId,workspaceName,requesterId,requester:{id,name,email},
// reason,status,requestedAt,reviewedBy:null|{id,name},reviewedAt}
async function serializeWorkspaceAccessRequest(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    requesterId: row.user_id,
    requester: { id: row.user_id, name: row.requester_name, email: row.requester_email },
    reason: row.reason ?? null,
    status: row.status,
    requestedAt: row.requested_at,
    reviewedBy: row.reviewed_by
      ? { id: row.reviewed_by, name: row.reviewer_name }
      : null,
    reviewedAt: row.reviewed_at ?? null,
  };
}

async function loadWorkspaceAccessRequest(id) {
  const { rows } = await query(
    `SELECT war.*, w.name AS workspace_name,
            ru.name AS requester_name, ru.email AS requester_email,
            rb.name AS reviewer_name
       FROM workspace_access_requests war
       JOIN workspaces w ON w.id = war.workspace_id
       JOIN users ru ON ru.id = war.user_id
       LEFT JOIN users rb ON rb.id = war.reviewed_by
      WHERE war.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function reviewWorkspaceAccessRequest({ request, reviewer, approve, ip }) {
  const status = approve ? 'APPROVED' : 'DENIED';
  await query(
    `UPDATE workspace_access_requests
        SET status = $1, reviewed_by = $2, reviewed_at = now()
      WHERE id = $3`,
    [status, reviewer.id, request.id]
  );
  if (approve) {
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, granted_by)
       VALUES ($1, $2, 'VIEWER', $3)
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [request.workspace_id, request.user_id, reviewer.id]
    );
  }
  await notifyUser({
    userId: request.user_id,
    title: approve ? 'Workspace access granted' : 'Workspace access denied',
    body: `Your request to join "${request.workspace_name}" was ${
      approve ? 'approved' : 'declined'
    }.`,
    kind: approve ? 'success' : 'info',
    payload: { requestId: request.id, workspaceId: request.workspace_id, type: 'workspace_access_request' },
    link: '/inbox?tab=requests',
  });
  await logAudit({
    actorId: reviewer.id,
    entityType: 'workspace_access_request',
    entityId: request.id,
    action: approve ? 'approve' : 'deny',
    detail: { workspaceId: request.workspace_id, userId: request.user_id },
    ip,
  });
  return { status };
}

module.exports = {
  isGlobalHigh,
  workspaceAccessFor,
  serializeWorkspaceAccessRequest,
  loadWorkspaceAccessRequest,
  reviewWorkspaceAccessRequest,
};
