'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getWorkspaceRole, roleAtLeast } = require('../access');

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

router.post('/', async (req, res, next) => {
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

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO workspaces (organization_id, name, visibility) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, name.trim(), vis]
      );
      const wsId = rows[0].id;
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
        [wsId, req.user.id]
      );
      await client.query(
        `INSERT INTO projects (workspace_id, name) VALUES ($1, $2)`,
        [wsId, 'Default Project']
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

router.patch('/:workspaceId', async (req, res, next) => {
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
      sets.push(`visibility = $${params.length + 1}`);
      params.push(visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE');
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    await query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = $1`, params);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Teams in workspace
router.get('/:workspaceId/teams', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT wt.id AS share_id, t.id AS team_id, t.name, wt.role
         FROM workspace_teams wt JOIN teams t ON t.id = wt.team_id
        WHERE wt.workspace_id = $1 ORDER BY t.name`,
      [req.params.workspaceId]
    );
    res.json({ teams: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:workspaceId/teams', async (req, res, next) => {
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

router.delete('/:workspaceId/teams/:teamId', async (req, res, next) => {
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

module.exports = router;
