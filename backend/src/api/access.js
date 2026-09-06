'use strict';

const { query } = require('./db');
const { readSessionToken, verifySession } = require('./authLib');

const ROLE_RANK = { ADMIN: 4, MANAGER: 3, EDITOR: 2, VIEWER: 1 };

function roleAtLeast(role, min) {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

async function loadUserById(userId) {
  const { rows } = await query(
    `SELECT id, email, username, name, role, is_active, created_at
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Express middleware: verifies the session cookie and attaches req.user.
 */
async function requireAuth(req, res, next) {
  try {
    const payload = verifySession(readSessionToken(req));
    if (!payload) return res.status(401).json({ error: 'Not authenticated' });
    const user = await loadUserById(payload.userId);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Express middleware: requires the user's global role to be ADMIN.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

/**
 * Effective role a user has in a workspace.
 * Priority: direct workspace membership > team membership (via sharing) >
 * org admin. Returns null when the user has no access.
 */
async function getWorkspaceRole(userId, workspaceId) {
  const { rows } = await query(
    `WITH direct AS (
       SELECT role FROM workspace_members WHERE workspace_id = $2 AND user_id = $1
     ), via_team AS (
       SELECT MAX(tm.role)::text AS role
         FROM workspace_teams wt
         JOIN team_members tm ON tm.team_id = wt.team_id
        WHERE wt.workspace_id = $2 AND tm.user_id = $1
     ), org_admin AS (
       SELECT w.organization_id AS org_id
         FROM workspaces w WHERE w.id = $2
     )
     SELECT
       (SELECT role FROM direct)                    AS direct_role,
       (SELECT role FROM via_team)                  AS team_role,
       EXISTS (SELECT 1 FROM organization_members om
                JOIN org_admin oa ON oa.org_id = om.org_id
                WHERE om.user_id = $1 AND om.role = 'ADMIN') AS is_org_admin`,
    [userId, workspaceId]
  );
  const row = rows[0];
  if (!row) return null;

  const candidates = [];
  if (row.direct_role) candidates.push(row.direct_role);
  if (row.team_role) candidates.push(row.team_role);
  if (row.is_org_admin) candidates.push('ADMIN');

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
  return candidates[0];
}

async function canReadWorkspace(userId, workspaceId) {
  const role = await getWorkspaceRole(userId, workspaceId);
  if (role) return true;
  const { rows } = await query(
    `SELECT w.visibility FROM workspaces w
       JOIN organization_members om ON om.org_id = w.organization_id
      WHERE w.id = $1 AND om.user_id = $2 AND w.visibility = 'PUBLIC'`,
    [workspaceId, userId]
  );
  if (rows.length > 0) return true;
  const grant = await query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_managers pm ON pm.project_id = p.id AND pm.user_id = $2
       LEFT JOIN project_members pme ON pme.project_id = p.id AND pme.user_id = $2
      WHERE p.workspace_id = $1 AND (pm.user_id IS NOT NULL OR pme.user_id IS NOT NULL)
      LIMIT 1`,
    [workspaceId, userId]
  );
  return grant.rows.length > 0;
}

async function canMutateWorkspace(userId, workspaceId) {
  const role = await getWorkspaceRole(userId, workspaceId);
  return roleAtLeast(role, 'EDITOR');
}

async function requireWorkspaceAccess(req, res, next) {
  try {
    const { workspaceId } = req.params;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const ok = await canReadWorkspace(req.user.id, workspaceId);
    if (!ok) return res.status(403).json({ error: 'No access to this workspace' });
    req.workspaceRole = await getWorkspaceRole(req.user.id, workspaceId);
    next();
  } catch (err) {
    next(err);
  }
}

async function requireWorkspaceWrite(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const ok = await canMutateWorkspace(req.user.id, workspaceId);
    if (!ok) return res.status(403).json({ error: 'Editor or admin access required' });
    req.workspaceRole = await getWorkspaceRole(req.user.id, workspaceId);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Express middleware: requires the user's global role to be MANAGER or ADMIN.
 */
function requireManagerOrAdmin(req, res, next) {
  if (!req.user || !['ADMIN', 'MANAGER'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Manager or admin privileges required' });
  }
  next();
}

/**
 * Organization IDs the user belongs to.
 */
async function getOrgIdsForUser(userId) {
  const { rows } = await query(
    `SELECT org_id FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.org_id);
}

/**
 * Effective access a user has to a project. Priority:
 *   global ADMIN  > org admin > project MANAGER > project member
 *   > workspace role.
 * Returns null when the user has no access.
 */
async function getProjectAccess(userId, projectId) {
  const { rows } = await query(
    `SELECT p.workspace_id,
            w.organization_id,
            (SELECT role FROM users WHERE id = $1) AS global_role,
            EXISTS (SELECT 1 FROM organization_members om
                     WHERE om.org_id = w.organization_id AND om.user_id = $1 AND om.role = 'ADMIN') AS is_org_admin,
            EXISTS (SELECT 1 FROM project_managers pm
                     WHERE pm.project_id = p.id AND pm.user_id = $1) AS is_manager,
            (SELECT pm.role FROM project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = $1) AS member_role
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = $2`,
    [userId, projectId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.global_role === 'ADMIN' || row.is_org_admin) {
    return { level: 'ADMIN', workspaceRole: 'ADMIN', isManager: false };
  }
  if (row.is_manager) {
    return { level: 'MANAGER', workspaceRole: 'MANAGER', isManager: true };
  }
  if (row.member_role) {
    return { level: row.member_role, workspaceRole: row.member_role, isManager: false };
  }
  const workspaceRole = await getWorkspaceRole(userId, row.workspace_id);
  if (!workspaceRole) return null;
  return { level: workspaceRole, workspaceRole, isManager: false };
}

async function canReadProject(userId, projectId) {
  return Boolean(await getProjectAccess(userId, projectId));
}

async function canWriteProject(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

async function requireProjectRead(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const access = await getProjectAccess(req.user.id, projectId);
    if (!access) return res.status(403).json({ error: 'No access to this project' });
    req.projectAccess = access;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireProjectWrite(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const access = await getProjectAccess(req.user.id, projectId);
    if (!access || !roleAtLeast(access.level, 'EDITOR')) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    req.projectAccess = access;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  ROLE_RANK,
  roleAtLeast,
  loadUserById,
  requireAuth,
  requireAdmin,
  requireManagerOrAdmin,
  getOrgIdsForUser,
  getWorkspaceRole,
  getProjectAccess,
  canReadProject,
  canWriteProject,
  canReadWorkspace,
  canMutateWorkspace,
  requireWorkspaceAccess,
  requireWorkspaceWrite,
  requireProjectRead,
  requireProjectWrite,
};
