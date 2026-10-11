'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getWorkspaceRole, roleAtLeast } = require('../access');
const { requirePermissionFor, requireResourcePermission } = require('../permissions');
const { getRetentionDays, MIN_RETENTION_DAYS } = require('../retention');
const { logAudit } = require('../audit');
const { checkCountGate, checkPublicSharingGate, checkSeatGate, orgOfWorkspace } = require('../entitlements');

const router = Router();
router.use(requireAuth);

// Effective access: direct membership, team sharing, or PUBLIC visibility
// within an org the user belongs to.
async function listWorkspaces(userId) {
  const { rows } = await query(
    `SELECT DISTINCT w.id, w.name, w.visibility, w.organization_id, o.name AS organization_name
       FROM workspaces w
       JOIN organizations o ON o.id = w.organization_id
      WHERE (
        EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = $1)
        OR EXISTS (SELECT 1 FROM workspace_teams wt JOIN team_members tm ON tm.team_id = wt.team_id
                    WHERE wt.workspace_id = w.id AND tm.user_id = $1)
        OR (w.visibility = 'PUBLIC'
            AND EXISTS (SELECT 1 FROM organization_members om
                         WHERE om.org_id = w.organization_id AND om.user_id = $1))
      )
      ORDER BY w.name`,
    [userId]
  );
  const result = [];
  for (const w of rows) {
    result.push({
      ...w,
      role: await getWorkspaceRole(userId, w.id),
    });
  }
  return result;
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ workspaces: await listWorkspaces(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// Org a workspace is being created into: prefer an explicit projectId's org,
// else the organizationId from the body. Unknown -> null (legacy guard rules).
async function resolveWorkspaceCreateOrg(req) {
  const { projectId, organizationId } = req.body || {};
  if (projectId) {
    const { rows } = await query(`SELECT organization_id FROM projects WHERE id = $1`, [projectId]);
    if (rows[0]) return rows[0].organization_id;
  }
  return organizationId || null;
}

router.post('/', requirePermissionFor(resolveWorkspaceCreateOrg, 'workspace.create'), async (req, res, next) => {
  try {
    const { organizationId, name, visibility } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    const vis = visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';

    let orgId = organizationId;
    if (!orgId) {
      const { rows } = await query(
        `SELECT org_id FROM organization_members WHERE user_id = $1 ORDER BY role DESC, org_id LIMIT 1`,
        [req.user.id]
      );
      orgId = rows[0]?.org_id;
    }
    if (!orgId) return res.status(400).json({ error: 'You are not part of any organization' });

    const isAdmin = await query(
      `SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2 AND role = 'ADMIN'`,
      [orgId, req.user.id]
    );
    if (isAdmin.rows.length === 0) {
      return res.status(403).json({ error: 'Organization admin access required' });
    }

    // L2/L3 creation gates — the org pool's plan limits (403 plan_limit when
    // at/over). PUBLIC workspaces also require the public_sharing entitlement.
    // Workspace creation also auto-creates a "Default Project", so the project
    // entitlement is checked here too.
    const gate = await checkCountGate({ userId: req.user.id, orgId, key: 'workspaces' });
    if (gate) return res.status(403).json(gate);
    const projectGate = await checkCountGate({ userId: req.user.id, orgId, key: 'projects' });
    if (projectGate) return res.status(403).json(projectGate);
    if (vis === 'PUBLIC') {
      const sharingGate = await checkPublicSharingGate({ userId: req.user.id, orgId });
      if (sharingGate) return res.status(403).json(sharingGate);
    }

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO workspaces (organization_id, name, visibility, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, name.trim(), vis, req.user.id]
      );
      const wsId = rows[0].id;
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
        [wsId, req.user.id]
      );
      await client.query(
        `INSERT INTO projects (workspace_id, name, created_by) VALUES ($1, $2, $3)`,
        [wsId, 'Default Project', req.user.id]
      );
      await client.query('COMMIT');
      res.status(201).json({ workspace: { id: wsId, name: name.trim(), visibility: vis, organization_id: orgId, role: 'ADMIN' } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/:workspaceId', requireResourcePermission('workspace', 'workspace.update'), async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(role, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });

    const { name, visibility } = req.body || {};
    const sets = [];
    const params = [workspaceId];
    if (name) {
      sets.push(`name = $${params.length + 1}`);
      params.push(String(name).trim());
    }
    if (visibility) {
      const newVis = visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
      // L3 public_sharing gate — switching a workspace to PUBLIC requires the
      // entitlement on the org pool plan.
      if (newVis === 'PUBLIC') {
        const { rows } = await query(`SELECT organization_id FROM workspaces WHERE id = $1`, [workspaceId]);
        const orgId = rows[0]?.organization_id;
        if (orgId) {
          const sharingGate = await checkPublicSharingGate({ userId: req.user.id, orgId });
          if (sharingGate) return res.status(403).json(sharingGate);
        }
      }
      sets.push(`visibility = $${params.length + 1}`);
      params.push(newVis);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    await query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = $1`, params);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:workspaceId', requireResourcePermission('workspace', 'workspace.delete'), async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(role, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });
    const { rows } = await query(`SELECT name, visibility FROM workspaces WHERE id = $1`, [workspaceId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    if (rows[0].name === 'My Workspace') {
      return res.status(409).json({
        error: 'Your personal "My Workspace" cannot be deleted. Create a new workspace instead.',
      });
    }
    await query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Workspace settings (run-history retention)
router.get('/:workspaceId/settings', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!role) return res.status(404).json({ error: 'Workspace not found' });

    const days = await getRetentionDays(workspaceId);
    res.json({ settings: { run_history_retention_days: days } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:workspaceId/settings', requireResourcePermission('workspace', 'workspace.update'), async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(role, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });

    const days = Number(req.body?.runHistoryRetentionDays);
    if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
      return res.status(400).json({ error: `runHistoryRetentionDays must be an integer >= ${MIN_RETENTION_DAYS}` });
    }

    await query(
      `INSERT INTO workspace_settings (workspace_id, run_history_retention_days, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (workspace_id)
       DO UPDATE SET run_history_retention_days = EXCLUDED.run_history_retention_days,
                     updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [workspaceId, days, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'run_history_retention_set',
      detail: { run_history_retention_days: days },
    });
    res.json({ settings: { run_history_retention_days: days } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Teams in workspace
router.get('/:workspaceId/teams', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    // Team sharing is internal: only workspace members may see which teams the
    // workspace is shared to.
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!role) return res.status(403).json({ error: 'No access to this workspace' });
    const { rows } = await query(
      `SELECT wt.id AS share_id, t.id AS team_id, t.name, wt.role
         FROM workspace_teams wt JOIN teams t ON t.id = wt.team_id
        WHERE wt.workspace_id = $1 ORDER BY t.name`,
      [workspaceId]
    );
    res.json({ teams: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:workspaceId/teams', requireResourcePermission('workspace', 'workspace.manage_members'), async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { teamId, role } = req.body || {};
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });
    const wsRole = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(wsRole, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });

    // The team must belong to the same organization as the workspace.
    const orgMatch = await query(
      `SELECT 1 FROM workspaces w JOIN teams t ON t.organization_id = w.organization_id
        WHERE w.id = $1 AND t.id = $2`,
      [workspaceId, teamId]
    );
    if (orgMatch.rows.length === 0) {
      return res.status(400).json({ error: 'Team must belong to the same organization as the workspace' });
    }
    await query(
      `INSERT INTO workspace_teams (workspace_id, team_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, team_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, teamId, role === 'VIEWER' ? 'VIEWER' : 'EDITOR']
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:workspaceId/teams/:teamId', requireResourcePermission('workspace', 'workspace.manage_members'), async (req, res, next) => {
  try {
    const { workspaceId, teamId } = req.params;
    const wsRole = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(wsRole, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });
    await query(
      `DELETE FROM workspace_teams WHERE workspace_id = $1 AND team_id = $2`,
      [workspaceId, teamId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------- Individuals in workspace
// Direct per-person grants stored in `workspace_members`. These are distinct
// from team shares (`workspace_teams`), which grant every member of a team:
// use these routes to share a workspace with one specific person.
router.get('/:workspaceId/members', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!role) return res.status(403).json({ error: 'No access to this workspace' });
    const { rows } = await query(
      `SELECT wm.user_id, wm.role, u.name, u.email, u.username
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1 ORDER BY u.name`,
      [workspaceId]
    );
    res.json({ members: rows });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:workspaceId/members',
  requireResourcePermission('workspace', 'workspace.manage_members'),
  async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      const { userId, email, username, role } = req.body || {};
      const wsRole = await getWorkspaceRole(req.user.id, workspaceId);
      if (!roleAtLeast(wsRole, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });

      let targetId = userId || null;
      const identifier = String(email || username || '').trim();
      if (!targetId && identifier) {
        const { rows } = await query(
          `SELECT id FROM users
            WHERE lower(email) = lower($1) OR lower(username) = lower($1)
            LIMIT 1`,
          [identifier]
        );
        targetId = rows[0]?.id || null;
      }
      if (!targetId) return res.status(404).json({ error: 'No matching user found' });

      const roleValue = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'].includes(role) ? role : 'EDITOR';
      const orgId = await orgOfWorkspace(workspaceId);
      const seatGate = await checkSeatGate({ userId: req.user.id, orgId, targetUserId: targetId });
      if (seatGate) return res.status(403).json(seatGate);

      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [workspaceId, targetId, roleValue]
      );
      await logAudit({
        actorId: req.user.id,
        entityType: 'workspace',
        entityId: workspaceId,
        action: 'grant_workspace_access',
        detail: { userId: targetId, role: roleValue },
        ip: req.ip,
      });
      res.status(201).json({ ok: true, userId: targetId, role: roleValue });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:workspaceId/members/:userId',
  requireResourcePermission('workspace', 'workspace.manage_members'),
  async (req, res, next) => {
    try {
      const { workspaceId, userId } = req.params;
      const wsRole = await getWorkspaceRole(req.user.id, workspaceId);
      if (!roleAtLeast(wsRole, 'ADMIN')) return res.status(403).json({ error: 'Workspace admin required' });
      await query(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, [
        workspaceId,
        userId,
      ]);
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
  }
);

module.exports = router;
module.exports.listWorkspaces = listWorkspaces;
