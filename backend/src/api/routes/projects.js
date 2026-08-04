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
