'use strict';

const { Router } = require('express');
const { query } = require('../db');
const {
  requireAuth,
  requireProjectRead,
  getProjectAccess,
  roleAtLeast,
} = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

// ------------------------------------------------- Access request lifecycle
// Any authenticated user may request access to a project. The project's
// managers (and admins) review these via /api/manage/access-requests/:id/review.
router.post('/projects/:projectId/access-requests', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { reason, role } = req.body || {};
    const project = await query(`SELECT id, name FROM projects WHERE id = $1`, [projectId]);
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const access = await getProjectAccess(req.user.id, projectId);
    if (access) return res.status(409).json({ error: 'You already have access to this project' });

    const requestedRole = ['VIEWER', 'EDITOR'].includes(role) ? role : 'VIEWER';
    const existing = await query(
      `SELECT id, status FROM access_requests WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.user.id]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status === 'PENDING') {
        return res.status(409).json({ error: 'You already have a pending request for this project' });
      }
      await query(
        `UPDATE access_requests SET status = 'PENDING', reason = $1, reviewed_by = NULL,
                reviewed_at = NULL, role = $2, requested_at = now()
          WHERE id = $3`,
        [reason || null, requestedRole, existing.rows[0].id]
      );
      const { rows } = await query(
        `SELECT id, project_id, user_id, role, reason, status, requested_at
           FROM access_requests WHERE id = $1`,
        [existing.rows[0].id]
      );
      return res.status(201).json({ accessRequest: rows[0] });
    }

    const { rows } = await query(
      `INSERT INTO access_requests (project_id, user_id, role, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, user_id, role, reason, status, requested_at`,
      [projectId, req.user.id, requestedRole, reason || null]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'access_request',
      entityId: rows[0].id,
      action: 'request_access',
      detail: { projectId },
      ip: req.ip,
    });
    res.status(201).json({ accessRequest: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:projectId/access-requests', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { rows } = await query(
      `SELECT id, project_id, user_id, role, reason, status, requested_at
         FROM access_requests WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.user.id]
    );
    res.json({ accessRequests: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/access-requests/mine', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ar.id, ar.project_id, ar.role, ar.reason, ar.status, ar.requested_at,
              p.name AS project_name
         FROM access_requests ar JOIN projects p ON p.id = ar.project_id
        WHERE ar.user_id = $1
        ORDER BY ar.requested_at DESC`,
      [req.user.id]
    );
    res.json({ accessRequests: rows });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------- Project overview / management
// Middleware: caller must hold MANAGER (or above) access on the project,
// i.e. a project manager, an org admin, or a platform admin.
async function requireProjectManager(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const access = await getProjectAccess(req.user.id, projectId);
    if (!access || !roleAtLeast(access.level, 'MANAGER')) {
      return res.status(403).json({ error: 'Project manager or admin access required' });
    }
    req.projectAccess = access;
    next();
  } catch (err) {
    next(err);
  }
}

const MEMBER_ROLES = ['EDITOR', 'VIEWER'];

// Rich, member-readable project home. Any user with read access on the
// project may load it; fields describing what the caller may do (canManage)
// are derived from their effective access level.
router.get('/projects/:projectId/overview', requireProjectRead, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await query(
      `SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name,
              w.visibility AS workspace_visibility, w.organization_id,
              o.name AS organization_name
         FROM projects p
         JOIN workspaces w ON w.id = p.workspace_id
         JOIN organizations o ON o.id = w.organization_id
        WHERE p.id = $1`,
      [projectId]
    );
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const access = req.projectAccess;

    const [counts, managers, members, recentRuns] = await Promise.all([
      query(
        `SELECT
           (SELECT count(*) FROM collections WHERE project_id = $1) AS collections,
           (SELECT count(*) FROM folders f
             WHERE f.collection_id IN (SELECT id FROM collections WHERE project_id = $1)) AS folders,
           (SELECT count(*) FROM api_requests ar
             WHERE ar.collection_id IN (SELECT id FROM collections WHERE project_id = $1)) AS requests,
           (SELECT count(*) FROM automations WHERE project_id = $1) AS automations,
           (SELECT count(*) FROM workflow_chains WHERE project_id = $1) AS workflows,
           EXISTS (SELECT 1 FROM mock_servers WHERE project_id = $1) AS has_mock_server`,
        [projectId]
      ),
      query(
        `SELECT u.id, u.email, u.name, pm.created_at AS granted_at,
                g.name AS grantor_name
           FROM project_managers pm
           JOIN users u ON u.id = pm.user_id
           LEFT JOIN users g ON g.id = pm.created_by
          WHERE pm.project_id = $1 ORDER BY u.name`,
        [projectId]
      ),
      query(
        `SELECT u.id, u.email, u.name, pm.role, pm.created_at AS granted_at,
                g.name AS grantor_name
           FROM project_members pm
           JOIN users u ON u.id = pm.user_id
           LEFT JOIN users g ON g.id = pm.granted_by
          WHERE pm.project_id = $1 ORDER BY u.name`,
        [projectId]
      ),
      query(
        `SELECT rh.id, rh.status, rh.trigger, rh.started_at, rh.finished_at,
                COALESCE(ar.name, '') AS request_name, wc.name AS workflow_name,
                COALESCE(u.name, '') AS user_name
           FROM run_history rh
           LEFT JOIN api_requests ar ON ar.id = rh.request_id
           LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
           LEFT JOIN users u ON u.id = rh.user_id
          WHERE (ar.collection_id IN (SELECT id FROM collections WHERE project_id = $1))
             OR (wc.project_id = $1)
          ORDER BY rh.started_at DESC
          LIMIT 8`,
        [projectId]
      ),
    ]);

    res.json({
      project: project.rows[0],
      myAccess: {
        level: access.level,
        isManager: !!access.isManager,
      },
      canManage: roleAtLeast(access.level, 'MANAGER'),
      counts: counts.rows[0],
      managers: managers.rows.map((m) => ({ ...m, role: 'MANAGER' })),
      members: members.rows,
      recentRuns: recentRuns.rows,
    });
  } catch (err) {
    next(err);
  }
});

// Users inside the project's organization who are not already managers or
// members, for populating the "Add member" picker.
router.get('/projects/:projectId/org-users', requireProjectManager, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { rows } = await query(
      `SELECT u.id, u.name, u.email
         FROM users u
         JOIN organization_members om ON om.user_id = u.id
         JOIN projects p ON p.id = $1
         JOIN workspaces w ON w.id = p.workspace_id
        WHERE om.org_id = w.organization_id
          AND NOT EXISTS (SELECT 1 FROM project_members pm
                           WHERE pm.project_id = p.id AND pm.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM project_managers pm
                           WHERE pm.project_id = p.id AND pm.user_id = u.id)
        ORDER BY u.name`,
      [projectId]
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// Grant or update a member's role on a project. Project managers and admins
// may only assign editor/viewer roles here (never elevate to manager).
router.post('/projects/:projectId/members', requireProjectManager, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { userId, role } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const roleValue = MEMBER_ROLES.includes(role) ? role : 'VIEWER';
    const [user, project] = await Promise.all([
      query(`SELECT id, name FROM users WHERE id = $1`, [userId]),
      query(`SELECT id FROM projects WHERE id = $1`, [projectId]),
    ]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const isManager = await query(
      `SELECT 1 FROM project_managers WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (isManager.rows.length > 0) {
      return res.status(409).json({ error: 'User is already a project manager' });
    }
    await query(
      `INSERT INTO project_members (project_id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
      [projectId, userId, roleValue, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'project',
      entityId: projectId,
      action: 'grant_project_access',
      detail: { userId, role: roleValue },
      ip: req.ip,
    });
    res.json({ ok: true, role: roleValue });
  } catch (err) {
    next(err);
  }
});

// Change an existing member's role (no-op if the user is a manager).
router.patch('/projects/:projectId/members/:userId', requireProjectManager, async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: 'role is required' });
    const roleValue = MEMBER_ROLES.includes(role) ? role : null;
    if (!roleValue) {
      return res.status(400).json({ error: 'role must be one of EDITOR, VIEWER' });
    }
    const isManager = await query(
      `SELECT 1 FROM project_managers WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (isManager.rows.length > 0) {
      return res.status(409).json({ error: 'User is a project manager, not a member' });
    }
    const res2 = await query(
      `UPDATE project_members SET role = $1, granted_by = $2 WHERE project_id = $3 AND user_id = $4`,
      [roleValue, req.user.id, projectId, userId]
    );
    if (res2.rowCount === 0) return res.status(404).json({ error: 'Member not found in project' });
    await logAudit({
      actorId: req.user.id,
      entityType: 'project',
      entityId: projectId,
      action: 'update_project_member_role',
      detail: { userId, role: roleValue },
      ip: req.ip,
    });
    res.json({ ok: true, role: roleValue });
  } catch (err) {
    next(err);
  }
});

// Remove a member from the project. Project managers can only remove plain
// members (never managers); the removee keeps any workspace-level access.
router.delete('/projects/:projectId/members/:userId', requireProjectManager, async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;
    const isManager = await query(
      `SELECT 1 FROM project_managers WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (isManager.rows.length > 0) {
      return res.status(409).json({ error: 'Remove managers via project management instead' });
    }
    const res2 = await query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (res2.rowCount === 0) return res.status(404).json({ error: 'Member not found in project' });
    await logAudit({
      actorId: req.user.id,
      entityType: 'project',
      entityId: projectId,
      action: 'revoke_project_access',
      detail: { userId },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- Project membership
router.get('/projects/:projectId/members', requireProjectRead, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const [managers, members] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.name FROM project_managers pm
           JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.name`,
        [projectId]
      ),
      query(
        `SELECT u.id, u.email, u.name, pm.role FROM project_members pm
           JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.name`,
        [projectId]
      ),
    ]);
    res.json({ managers: managers.rows, members: members.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
