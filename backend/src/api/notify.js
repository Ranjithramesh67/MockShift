'use strict';

const { query } = require('./db');

// De-duplicate a recipient id list, dropping the actor and any falsy ids.
function dedupeRecipients(userIds, excludeUserId) {
  const seen = new Set();
  const out = [];
  for (const id of userIds || []) {
    if (!id || id === excludeUserId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function notifyUser({ userId, title, body, kind, payload, link }) {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, payload, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, body || null, kind || 'info', JSON.stringify(payload || {}), link || null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] insert failed:', err.message);
  }
}

async function notifyUsers(userIds, opts) {
  for (const userId of dedupeRecipients(userIds, opts && opts.excludeUserId)) {
    await notifyUser({ ...opts, userId });
  }
}

// Platform admins plus the project's assigned managers.
async function projectReviewerIds(projectId, excludeUserId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id
       FROM users u
      WHERE u.is_active = true
        AND u.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (
          u.role = 'ADMIN'
          OR EXISTS (SELECT 1 FROM project_managers pm
                      WHERE pm.project_id = $1 AND pm.user_id = u.id)
        )`,
    [projectId, excludeUserId || null]
  );
  return rows.map((r) => r.id);
}

// Platform managers/admins, the workspace's org admins, and workspace admins.
async function workspaceReviewerIds(workspaceId, excludeUserId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id
       FROM users u
      WHERE u.is_active = true
        AND u.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (
          u.role IN ('ADMIN', 'MANAGER')
          OR EXISTS (SELECT 1 FROM workspace_members wm
                      WHERE wm.workspace_id = $1 AND wm.user_id = u.id AND wm.role = 'ADMIN')
          OR EXISTS (SELECT 1 FROM organization_members om
                      JOIN workspaces w ON w.id = $1
                     WHERE om.org_id = w.organization_id AND om.user_id = u.id AND om.role = 'ADMIN')
        )`,
    [workspaceId, excludeUserId || null]
  );
  return rows.map((r) => r.id);
}

module.exports = { dedupeRecipients, notifyUser, notifyUsers, projectReviewerIds, workspaceReviewerIds };
