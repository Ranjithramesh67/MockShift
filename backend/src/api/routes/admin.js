'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, requireAdmin } = require('../access');
const { hashPassword } = require('../authLib');
const { logAudit } = require('../audit');
const { allocateUsername } = require('../username');

const router = Router();
router.use(requireAuth, requireAdmin);

const ROLES = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'];

async function userExists(userId) {
  const { rows } = await query(`SELECT id, name, email, is_active FROM users WHERE id = $1`, [userId]);
  return rows[0] || null;
}

// ------------------------------------------------------------- Access overview
// Admin-only view of every project and workspace with their current access
// grants, so an admin can directly create/revoke membership.
router.get('/access', async (req, res, next) => {
  try {
    const [projects, workspaces] = await Promise.all([
      query(
        `SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name,
                COALESCE(json_agg(DISTINCT m) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS managers,
                COALESCE(json_agg(DISTINCT mem) FILTER (WHERE mem.id IS NOT NULL), '[]'::json) AS members
           FROM projects p
           JOIN workspaces w ON w.id = p.workspace_id
           LEFT JOIN (
             SELECT pm.project_id, u.id, u.name, u.email
               FROM project_managers pm JOIN users u ON u.id = pm.user_id
           ) m ON m.project_id = p.id
           LEFT JOIN (
             SELECT pm.project_id, u.id, u.name, u.email, pm.role
               FROM project_members pm JOIN users u ON u.id = pm.user_id
           ) mem ON mem.project_id = p.id
          GROUP BY p.id, w.name
          ORDER BY w.name, p.name`
      ),
      query(
        `SELECT ws.id, ws.name, ws.organization_id, o.name AS organization_name,
                COALESCE(json_agg(DISTINCT wm) FILTER (WHERE wm.id IS NOT NULL), '[]'::json) AS members
           FROM workspaces ws
           JOIN organizations o ON o.id = ws.organization_id
           LEFT JOIN (
             SELECT wm.workspace_id, u.id, u.name, u.email, wm.role
               FROM workspace_members wm JOIN users u ON u.id = wm.user_id
           ) wm ON wm.workspace_id = ws.id
          GROUP BY ws.id, o.name
          ORDER BY o.name, ws.name`
      ),
    ]);
    res.json({ projects: projects.rows, workspaces: workspaces.rows });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- Project membership
// Directly grant a user project access (bypasses the access-request flow).
router.post('/projects/:projectId/members', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { userId, role } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const roleValue = ROLES.includes(role) ? role : 'VIEWER';
    const [user, project] = await Promise.all([
      userExists(userId),
      query(`SELECT id, name FROM projects WHERE id = $1`, [projectId]),
    ]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
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

router.delete('/projects/:projectId/members/:userId', async (req, res, next) => {
  try {
    const { projectId, userId } = req.params;
    await query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
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

// ------------------------------------------------------- Manager assignment
router.post('/projects/:projectId/managers', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [user, project] = await Promise.all([
      userExists(userId),
      query(`SELECT id FROM projects WHERE id = $1`, [projectId]),
    ]);
    if (!user) return res.status(404).json({ error: 'User not found' });
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

router.delete('/projects/:projectId/managers/:userId', async (req, res, next) => {
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

// ------------------------------------------------------ Workspace membership
// Directly grant/revoke workspace membership (overrides visibility defaults).
router.post('/workspaces/:workspaceId/members', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { userId, role } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const roleValue = ROLES.includes(role) ? role : 'VIEWER';
    const [user, workspace] = await Promise.all([
      userExists(userId),
      query(`SELECT id, name FROM workspaces WHERE id = $1`, [workspaceId]),
    ]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (workspace.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, userId, roleValue]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'grant_workspace_access',
      detail: { userId, role: roleValue },
      ip: req.ip,
    });
    res.json({ ok: true, role: roleValue });
  } catch (err) {
    next(err);
  }
});

router.delete('/workspaces/:workspaceId/members/:userId', async (req, res, next) => {
  try {
    const { workspaceId, userId } = req.params;
    await query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'revoke_workspace_access',
      detail: { userId },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const { email, name, role, password, username } = req.body || {};
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name and password are required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const roleValue = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'].includes(role) ? role : 'EDITOR';

    const existing = await query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const usernameValue = await allocateUsername(query, {
      username,
      email: normalizedEmail,
      name: String(name).trim(),
    });

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, role, username)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, username, name, role, is_active, created_at`,
      [normalizedEmail, await hashPassword(String(password)), String(name).trim() || normalizedEmail, roleValue, usernameValue]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'user',
      entityId: rows[0].id,
      action: 'create_user',
      detail: { email: normalizedEmail, role: roleValue },
      ip: req.ip,
    });
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.username, u.name, u.role, u.is_active, u.created_at,
              COALESCE((
                SELECT json_agg(x ORDER BY x.name)
                  FROM (
                    SELECT p.id, p.name,
                           CASE WHEN pmg.project_id IS NOT NULL THEN 'manager' ELSE 'member' END AS kind,
                           COALESCE(pmm.role::text, 'MANAGER') AS role
                      FROM projects p
                      JOIN (
                        SELECT project_id FROM project_managers WHERE user_id = u.id
                        UNION
                        SELECT project_id FROM project_members WHERE user_id = u.id
                      ) sub ON sub.project_id = p.id
                      LEFT JOIN project_members pmm ON pmm.project_id = p.id AND pmm.user_id = u.id
                      LEFT JOIN project_managers pmg ON pmg.project_id = p.id AND pmg.user_id = u.id
                  ) x
              ), '[]'::json) AS projects
         FROM users u
        ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role, isActive } = req.body || {};

    const target = await query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (role !== undefined) {
      if (!['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      if (userId === req.user.id && role !== 'ADMIN') {
        return res.status(400).json({ error: 'You cannot demote yourself' });
      }
      await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, userId]);
    }

    if (isActive !== undefined) {
      if (userId === req.user.id && isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate yourself' });
      }
      // Never deactivate the last active admin.
      if (isActive === false && target.rows[0].role === 'ADMIN') {
        const admins = await query(
          `SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND is_active = true`
        );
        if (admins.rows[0].n <= 1) {
          return res.status(400).json({ error: 'Cannot deactivate the last admin' });
        }
      }
      await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive === true, userId]);
    }

    const updated = await query(
      `SELECT id, email, name, role, is_active, created_at FROM users WHERE id = $1`,
      [userId]
    );
    res.json({ user: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
