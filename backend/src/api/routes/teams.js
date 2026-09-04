'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, roleAtLeast, getWorkspaceRole } = require('../access');
const { listWorkspaces } = require('./workspaces');

const router = Router();
router.use(requireAuth);

async function teamRole(userId, teamId) {
  const { rows } = await query(
    `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return rows[0]?.role || null;
}

async function teamWithMembers(teamId) {
  const { rows } = await query(
    `SELECT tm.user_id AS id, u.email, u.name, tm.role
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1 ORDER BY u.name`,
    [teamId]
  );
  return rows;
}

// Teams the user is a member of.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.name, t.organization_id, o.name AS organization_name
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         JOIN organizations o ON o.id = t.organization_id
        WHERE tm.user_id = $1
        ORDER BY t.name`,
      [req.user.id]
    );
    const teams = [];
    for (const t of rows) {
      teams.push({ ...t, members: await teamWithMembers(t.id), myRole: await teamRole(req.user.id, t.id) });
    }
    res.json({ teams });
  } catch (err) {
    next(err);
  }
});

// Team-scoped grouping for navigation: teams the user participates in (as a
// member, or as an org admin) each with the workspaces shared to that team,
// followed by an "other" bucket holding the user's remaining workspaces
// (direct membership / public) that no participating team shares.
router.get('/groups', async (req, res, next) => {
  try {
    const { rows: teams } = await query(
      `SELECT DISTINCT t.id, t.name, t.organization_id, o.name AS organization_name
         FROM teams t
         JOIN organizations o ON o.id = t.organization_id
        WHERE EXISTS (SELECT 1 FROM team_members tm
                       WHERE tm.team_id = t.id AND tm.user_id = $1)
           OR EXISTS (SELECT 1 FROM organization_members om
                       WHERE om.org_id = t.organization_id
                         AND om.user_id = $1 AND om.role = 'ADMIN')
        ORDER BY t.name`,
      [req.user.id]
    );

    const groupedIds = new Set();
    const groups = [];
    for (const t of teams) {
      const myRole = await teamRole(req.user.id, t.id);
      const { rows: wsRows } = await query(
        `SELECT w.id, w.name, w.visibility, w.organization_id, o.name AS organization_name
           FROM workspaces w
           JOIN workspace_teams wt ON wt.workspace_id = w.id
           JOIN organizations o ON o.id = w.organization_id
          WHERE wt.team_id = $1
          ORDER BY w.name`,
        [t.id]
      );
      const workspaces = [];
      for (const w of wsRows) {
        groupedIds.add(w.id);
        const role = await getWorkspaceRole(req.user.id, w.id);
        workspaces.push({ ...w, role });
      }
      groups.push({ ...t, myRole, workspaces });
    }

    const all = await listWorkspaces(req.user.id);
    const other = all.filter((w) => !groupedIds.has(w.id));
    res.json({ groups, other });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { organizationId, name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });

    let orgId = organizationId;
    if (!orgId) {
      const { rows } = await query(
        `SELECT org_id FROM organization_members WHERE user_id = $1 ORDER BY role DESC, org_id LIMIT 1`,
        [req.user.id]
      );
      orgId = rows[0]?.org_id;
    }
    if (!orgId) return res.status(400).json({ error: 'You are not part of any organization' });
    const inOrg = await query(
      `SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, req.user.id]
    );
    if (inOrg.rows.length === 0) return res.status(403).json({ error: 'Not a member of that organization' });

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO teams (name, organization_id) VALUES ($1, $2) RETURNING id`,
        [name.trim(), orgId]
      );
      const teamId = rows[0].id;
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
        [teamId, req.user.id]
      );
      await client.query('COMMIT');
      res.status(201).json({ team: { id: teamId, name: name.trim(), organization_id: orgId, members: await teamWithMembers(teamId), myRole: 'ADMIN' } });
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

router.delete('/:teamId', async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const myRole = await teamRole(req.user.id, teamId);
    if (!roleAtLeast(myRole, 'ADMIN')) return res.status(403).json({ error: 'Team admin required' });
    await query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:teamId/members', async (req, res, next) => {  try {
    const role = await teamRole(req.user.id, req.params.teamId);
    if (!role) return res.status(403).json({ error: 'Not a member of this team' });
    res.json({ members: await teamWithMembers(req.params.teamId) });
  } catch (err) {
    next(err);
  }
});

router.post('/:teamId/members', async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { email, role } = req.body || {};
    const myRole = await teamRole(req.user.id, teamId);
    if (!roleAtLeast(myRole, 'ADMIN')) return res.status(403).json({ error: 'Team admin required' });
    if (!email) return res.status(400).json({ error: 'email is required' });

    const memberRole = role === 'VIEWER' || role === 'EDITOR' ? role : 'EDITOR';
    const target = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: `No user with email ${email}` });
    }
    await query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [teamId, target.rows[0].id, memberRole]
    );
    res.status(201).json({ members: await teamWithMembers(teamId) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:teamId/members/:userId', async (req, res, next) => {
  try {
    const { teamId, userId } = req.params;
    const { role } = req.body || {};
    const myRole = await teamRole(req.user.id, teamId);
    if (!roleAtLeast(myRole, 'ADMIN')) return res.status(403).json({ error: 'Team admin required' });
    if (role !== 'ADMIN' && role !== 'EDITOR' && role !== 'VIEWER') {
      return res.status(400).json({ error: 'Invalid role' });
    }
    // Prevent removing the last admin.
    if (role !== 'ADMIN') {
      const admins = await query(
        `SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'ADMIN'`,
        [teamId]
      );
      const isTargetAdmin = await query(
        `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'ADMIN'`,
        [teamId, userId]
      );
      if (admins.rows[0].n <= 1 && isTargetAdmin.rows.length > 0) {
        return res.status(400).json({ error: 'Cannot demote the last team admin' });
      }
    }
    await query(
      `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3`,
      [role, teamId, userId]
    );
    res.json({ members: await teamWithMembers(teamId) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:teamId/members/:userId', async (req, res, next) => {
  try {
    const { teamId, userId } = req.params;
    const myRole = await teamRole(req.user.id, teamId);
    if (!roleAtLeast(myRole, 'ADMIN')) return res.status(403).json({ error: 'Team admin required' });
    const admins = await query(
      `SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'ADMIN'`,
      [teamId]
    );
    const isTargetAdmin = await query(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'ADMIN'`,
      [teamId, userId]
    );
    if (admins.rows[0].n <= 1 && isTargetAdmin.rows.length > 0) {
      return res.status(400).json({ error: 'Cannot remove the last team admin' });
    }
    await query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
    res.json({ members: await teamWithMembers(teamId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
