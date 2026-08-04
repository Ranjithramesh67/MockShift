'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, requireManagerOrAdmin, getOrgIdsForUser } = require('../access');
const { logAudit, managedProjectIds } = require('../audit');

const router = Router();
router.use(requireAuth, requireManagerOrAdmin);

// ---------------------------------------------------------------- Overview
router.get('/overview', async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') {
      const counts = await query(
        `SELECT
           (SELECT count(*) FROM users)                         AS users,
           (SELECT count(*) FROM projects)                      AS projects,
           (SELECT count(*) FROM teams)                         AS teams,
           (SELECT count(*) FROM workspaces)                    AS workspaces,
           (SELECT count(*) FROM run_history)                   AS runs,
           (SELECT count(*) FROM access_requests WHERE status = 'PENDING') AS pending_requests,
           (SELECT count(*) FROM audit_logs)                    AS audit_entries,
           (SELECT count(*) FROM automations)                   AS automations`
      );
      return res.json({ scope: 'all', counts: counts.rows[0] });
    }
    const orgIds = await getOrgIdsForUser(req.user.id);
    const managed = await managedProjectIds(req.user.id);
    const counts = await query(
      `SELECT
         (SELECT count(*) FROM users u
           WHERE u.id = $1 OR EXISTS (SELECT 1 FROM organization_members om
             WHERE om.user_id = u.id AND om.org_id = ANY($2::uuid[]))) AS users,
         (SELECT count(*) FROM projects WHERE id = ANY($3::uuid[]))   AS projects,
         (SELECT count(*) FROM teams t
           WHERE t.organization_id = ANY($2::uuid[]) OR t.organization_id IS NULL) AS teams,
         (SELECT count(DISTINCT p.workspace_id) FROM projects p WHERE p.id = ANY($3::uuid[])) AS workspaces,
         (SELECT count(*) FROM run_history rh
           WHERE rh.request_id IN (SELECT ar.id FROM api_requests ar
                                    JOIN collections c ON c.id = ar.collection_id
                                    WHERE c.project_id = ANY($3::uuid[]))
              OR rh.workflow_id IN (SELECT wc.id FROM workflow_chains wc
                                     WHERE wc.project_id = ANY($3::uuid[]))) AS runs,
         (SELECT count(*) FROM access_requests
           WHERE status = 'PENDING' AND project_id = ANY($3::uuid[])) AS pending_requests,
         (SELECT count(*) FROM audit_logs)                            AS audit_entries,
         (SELECT count(*) FROM automations WHERE project_id = ANY($3::uuid[])) AS automations`,
      [req.user.id, orgIds, managed]
    );
    res.json({ scope: 'managed', counts: counts.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Users
router.get('/users', async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') {
      const { rows } = await query(
        `SELECT id, email, name, role, is_active, created_at
           FROM users ORDER BY created_at DESC`
      );
      return res.json({ users: rows });
    }
    const orgIds = await getOrgIdsForUser(req.user.id);
    const { rows } = await query(
      `SELECT id, email, name, role, is_active, created_at
         FROM users u
        WHERE u.id = $1
           OR EXISTS (SELECT 1 FROM organization_members om
                       WHERE om.user_id = u.id AND om.org_id = ANY($2::uuid[]))
        ORDER BY created_at DESC`,
      [req.user.id, orgIds]
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- Projects
router.get('/projects', async (req, res, next) => {
  try {
    const params = [req.user.id];
    let where = '';
    if (req.user.role !== 'ADMIN') {
      where = 'WHERE p.id = ANY(SELECT project_id FROM project_managers WHERE user_id = $1)';
    }
    const { rows } = await query(
      `SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name,
              (SELECT count(*) FROM collections c WHERE c.project_id = p.id) AS collections,
              (SELECT count(*) FROM api_requests ar
                JOIN collections c ON c.id = ar.collection_id
                WHERE c.project_id = p.id) AS requests,
              EXISTS (SELECT 1 FROM project_managers pm
                       WHERE pm.project_id = p.id AND pm.user_id = $1) AS is_manager
         FROM projects p
         JOIN workspaces w ON w.id = p.workspace_id
         ${where}
        ORDER BY w.name, p.name`,
      params
    );
    res.json({ projects: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:projectId', requireProjectManagerOrAdmin, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await query(
      `SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name, w.organization_id
         FROM projects p JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = $1`,
      [projectId]
    );
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const managers = await query(
      `SELECT u.id, u.email, u.name FROM project_managers pm
         JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.name`,
      [projectId]
    );
    const members = await query(
      `SELECT u.id, u.email, u.name, pm.role, pm.created_at
         FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1 ORDER BY u.name`,
      [projectId]
    );
    const requests = await query(
      `SELECT ar.id, ar.status, ar.reason, ar.requested_at, ar.role,
              u.id AS user_id, u.email, u.name
         FROM access_requests ar JOIN users u ON u.id = ar.user_id
        WHERE ar.project_id = $1 ORDER BY ar.requested_at DESC`,
      [projectId]
    );
    res.json({
      project: project.rows[0],
      managers: managers.rows,
      members: members.rows,
      requests: requests.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------- Access request approval
router.get('/access-requests', async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') {
      const { rows } = await query(
        `SELECT ar.*, u.email, u.name, p.name AS project_name
           FROM access_requests ar
           JOIN users u ON u.id = ar.user_id
           JOIN projects p ON p.id = ar.project_id
          ORDER BY ar.requested_at DESC`
      );
      return res.json({ accessRequests: rows });
    }
    const managed = await managedProjectIds(req.user.id);
    const { rows } = await query(
      `SELECT ar.*, u.email, u.name, p.name AS project_name
         FROM access_requests ar
         JOIN users u ON u.id = ar.user_id
         JOIN projects p ON p.id = ar.project_id
        WHERE ar.project_id = ANY($1::uuid[])
        ORDER BY ar.requested_at DESC`,
      [managed]
    );
    res.json({ accessRequests: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/access-requests/:requestId/review', requireReviewer, async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { approve } = req.body || {};
    if (approve === undefined || typeof approve !== 'boolean') {
      return res.status(400).json({ error: 'approve must be a boolean' });
    }
    const reqRow = await query(
      `SELECT id, project_id, user_id, role, status FROM access_requests WHERE id = $1`,
      [requestId]
    );
    if (reqRow.rows.length === 0) return res.status(404).json({ error: 'Access request not found' });
    const request = reqRow.rows[0];
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'Request already reviewed' });
    }
    const status = approve ? 'APPROVED' : 'DENIED';
    await query(
      `UPDATE access_requests
          SET status = $1, reviewed_by = $2, reviewed_at = now()
        WHERE id = $3`,
      [status, req.user.id, requestId]
    );
    if (approve) {
      await query(
        `INSERT INTO project_members (project_id, user_id, role, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
        [request.project_id, request.user_id, request.role, req.user.id]
      );
      await query(
        `INSERT INTO notifications (user_id, title, body, kind)
         VALUES ($1, $2, $3, 'success')`,
        [
          request.user_id,
          'Project access granted',
          `Your request to join the project was approved.`,
        ]
      );
    } else {
      await query(
        `INSERT INTO notifications (user_id, title, body, kind)
         VALUES ($1, $2, $3, 'info')`,
        [request.user_id, 'Project access denied', `Your request to join the project was declined.`]
      );
    }
    await logAudit({
      actorId: req.user.id,
      entityType: 'access_request',
      entityId: requestId,
      action: approve ? 'approve' : 'deny',
      detail: { projectId: request.project_id, userId: request.user_id },
      ip: req.ip,
    });
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- Manager assignment
router.post('/projects/:projectId/managers', requireAdminRole, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const target = await query(`SELECT id, name FROM users WHERE id = $1`, [userId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const project = await query(`SELECT id FROM projects WHERE id = $1`, [projectId]);
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    await query(
      `INSERT INTO project_managers (project_id, user_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [projectId, userId, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'project',
      entityId: projectId,
      action: 'assign_manager',
      detail: { userId },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/projects/:projectId/managers/:userId', requireAdminRole, async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;
    await query(
      `DELETE FROM project_managers WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'project',
      entityId: projectId,
      action: 'remove_manager',
      detail: { userId },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------- Teams
router.get('/teams', async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') {
      const { rows } = await query(
        `SELECT t.id, t.name, t.organization_id,
                (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id) AS members
           FROM teams t ORDER BY t.name`
      );
      return res.json({ teams: rows });
    }
    const orgIds = await getOrgIdsForUser(req.user.id);
    const { rows } = await query(
      `SELECT t.id, t.name, t.organization_id,
              (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id) AS members
         FROM teams t
        WHERE t.organization_id = ANY($1::uuid[]) OR t.organization_id IS NULL
        ORDER BY t.name`,
      [orgIds]
    );
    res.json({ teams: rows });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ Audit history
router.get('/audit-logs', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    if (req.user.role === 'ADMIN') {
      const { rows } = await query(
        `SELECT al.*, u.email AS actor_email, u.name AS actor_name
           FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
          ORDER BY al.created_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ logs: rows });
    }
    const managed = await managedProjectIds(req.user.id);
    const orgIds = await getOrgIdsForUser(req.user.id);
    const { rows } = await query(
      `SELECT al.*, u.email AS actor_email, u.name AS actor_name
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
        WHERE al.actor_id = $1
           OR (al.entity_type = 'project' AND al.entity_id = ANY($2::uuid[]))
           OR (al.entity_type = 'access_request' AND al.entity_id IN (
                 SELECT id FROM access_requests WHERE project_id = ANY($2::uuid[])))
           OR (al.entity_type = 'automation' AND al.entity_id IN (
                 SELECT id FROM automations WHERE project_id = ANY($2::uuid[])))
           OR (al.entity_type = 'workflow' AND al.entity_id IN (
                 SELECT id FROM workflow_chains WHERE project_id = ANY($2::uuid[])))
           OR (al.entity_type IN ('request', 'collection') AND al.entity_id IN (
                 SELECT ar.id FROM api_requests ar
                   JOIN collections c ON c.id = ar.collection_id
                   WHERE c.project_id = ANY($2::uuid[])
                 UNION
                 SELECT c.id FROM collections c WHERE c.project_id = ANY($2::uuid[])))
           OR (al.entity_type = 'run' AND al.entity_id IN (
                 SELECT rh.id FROM run_history rh
                   WHERE rh.request_id IN (SELECT ar.id FROM api_requests ar
                                            JOIN collections c ON c.id = ar.collection_id
                                            WHERE c.project_id = ANY($2::uuid[]))
                      OR rh.workflow_id IN (SELECT wc.id FROM workflow_chains wc
                                             WHERE wc.project_id = ANY($2::uuid[]))))
           OR (al.entity_type IN ('user', 'team', 'workspace', 'organization')
               AND EXISTS (SELECT 1 FROM organization_members om
                            WHERE om.user_id = al.actor_id AND om.org_id = ANY($3::uuid[])))
        ORDER BY al.created_at DESC LIMIT $4`,
      [req.user.id, managed, orgIds, limit]
    );
    res.json({ logs: rows });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- Run history
router.get('/history', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    if (req.user.role === 'ADMIN') {
      const { rows } = await query(
        `SELECT rh.id, rh.trigger, rh.status, rh.started_at, rh.finished_at,
                rh.request_id, rh.workflow_id,
                u.email AS user_email, u.name AS user_name,
                COALESCE(ar.name, wc.name) AS name
           FROM run_history rh
           LEFT JOIN users u ON u.id = rh.user_id
           LEFT JOIN api_requests ar ON ar.id = rh.request_id
           LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
          ORDER BY rh.started_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ runs: rows });
    }
    const managed = await managedProjectIds(req.user.id);
    const { rows } = await query(
      `SELECT rh.id, rh.trigger, rh.status, rh.started_at, rh.finished_at,
              rh.request_id, rh.workflow_id,
              u.email AS user_email, u.name AS user_name,
              COALESCE(ar.name, wc.name) AS name
         FROM run_history rh
         LEFT JOIN users u ON u.id = rh.user_id
         LEFT JOIN api_requests ar ON ar.id = rh.request_id
         LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
        WHERE rh.request_id IN (SELECT ar.id FROM api_requests ar
                                 JOIN collections c ON c.id = ar.collection_id
                                 WHERE c.project_id = ANY($1::uuid[]))
           OR rh.workflow_id IN (SELECT wc.id FROM workflow_chains wc
                                  WHERE wc.project_id = ANY($1::uuid[]))
        ORDER BY rh.started_at DESC LIMIT $2`,
      [managed, limit]
    );
    res.json({ runs: rows });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- Helper middleware
async function requireAdminRole(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin privileges required' });
  next();
}

async function requireProjectManagerOrAdmin(req, res, next) {
  try {
    const { projectId } = req.params;
    const managed = await managedProjectIds(req.user.id);
    if (req.user.role === 'ADMIN' || managed.includes(projectId)) return next();
    return res.status(403).json({ error: 'Manager or admin access required' });
  } catch (err) {
    next(err);
  }
}

async function requireReviewer(req, res, next) {
  try {
    const { requestId } = req.params;
    if (req.user.role === 'ADMIN') return next();
    const { rows } = await query(
      `SELECT project_id FROM access_requests WHERE id = $1`,
      [requestId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Access request not found' });
    const managed = await managedProjectIds(req.user.id);
    if (managed.includes(rows[0].project_id)) return next();
    return res.status(403).json({ error: 'Manager or admin access required' });
  } catch (err) {
    next(err);
  }
}

module.exports = router;
