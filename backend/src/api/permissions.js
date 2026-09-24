'use strict';

// ============================================================================
// IAM permission catalog + resolvers.
//
// Organization-scoped IAM roles (iam_roles) layer additively on the legacy
// enum stored on organization_members.role. A system role is identified by
// `system_key` (ADMIN/MANAGER/EDITOR/VIEWER/SUPPORT) and always resolves its
// permissions from SYSTEM_ROLE_PERMISSIONS below; a custom role stores its
// granted keys in iam_role_permissions.
//
// The `'*'` wildcard expands to every catalog key and is never persisted: an
// ADMIN's [ '* '] resolves to the full key list at read time.
// ============================================================================

const { query } = require('./db');

const PERMISSION_GROUPS = [
  {
    key: 'org',
    label: 'Organization',
    permissions: [
      { key: 'org.manage_members', label: 'Manage members' },
      { key: 'org.manage_roles', label: 'Manage roles' },
      { key: 'org.manage_billing', label: 'Manage billing' },
      { key: 'org.view_audit', label: 'View audit log' },
    ],
  },
  {
    key: 'project',
    label: 'Projects',
    permissions: [
      { key: 'project.view', label: 'View projects' },
      { key: 'project.create', label: 'Create projects' },
      { key: 'project.update', label: 'Update projects' },
      { key: 'project.delete', label: 'Delete projects' },
      { key: 'project.manage_members', label: 'Manage project members' },
    ],
  },
  {
    key: 'workspace',
    label: 'Workspaces',
    permissions: [
      { key: 'workspace.view', label: 'View workspaces' },
      { key: 'workspace.create', label: 'Create workspaces' },
      { key: 'workspace.update', label: 'Update workspaces' },
      { key: 'workspace.delete', label: 'Delete workspaces' },
      { key: 'workspace.manage_members', label: 'Manage workspace members' },
      { key: 'workspace.write', label: 'Write workspace content' },
    ],
  },
  {
    key: 'team',
    label: 'Teams',
    permissions: [{ key: 'team.manage', label: 'Manage teams' }],
  },
  {
    key: 'content',
    label: 'Content',
    permissions: [
      { key: 'request.send', label: 'Send requests' },
      { key: 'mock.manage', label: 'Manage mock servers' },
      { key: 'docs.manage', label: 'Manage documentation' },
      { key: 'automation.manage', label: 'Manage automations' },
    ],
  },
];

const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

// Catalog grants per system role. ADMIN is the wildcard; MANAGER is the full
// catalog minus role/billing management so only owners/admins can escalate.
const SYSTEM_ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  MANAGER: ALL_PERMISSION_KEYS.filter(
    (key) => key !== 'org.manage_roles' && key !== 'org.manage_billing'
  ),
  EDITOR: [
    'project.view',
    'workspace.view',
    'workspace.write',
    'request.send',
    'docs.manage',
    'mock.manage',
  ],
  VIEWER: ['project.view', 'workspace.view'],
  SUPPORT: ['project.view', 'workspace.view', 'org.view_audit'],
};

const LEGACY_ROLE_RANK = { ADMIN: 5, MANAGER: 4, EDITOR: 3, VIEWER: 2, SUPPORT: 2 };
const SYSTEM_ROLE_KEYS = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER', 'SUPPORT'];

function isValidPermissionKey(key) {
  return typeof key === 'string' && PERMISSION_KEY_SET.has(key);
}

function expandPermissions(keys) {
  const list = Array.isArray(keys) ? keys : [];
  if (list.includes('*')) return [...ALL_PERMISSION_KEYS];
  return list.filter((key) => PERMISSION_KEY_SET.has(key));
}

/**
 * Resolve the expanded permission keys granted by a system role. Unknown or
 * missing system keys yield an empty list.
 */
function resolveSystemRolePermissions(systemKey) {
  const raw = SYSTEM_ROLE_PERMISSIONS[systemKey];
  if (!raw) return [];
  return expandPermissions(raw);
}

/**
 * Idempotently ensure the five system roles exist for an organization.
 * Accepts an optional transaction executor (`client.query`) so the signup
 * path can seed roles inside its own transaction.
 */
async function ensureSystemRolesForOrg(orgId, exec) {
  const run = typeof exec === 'function' ? exec : query;
  await run(
    `INSERT INTO iam_roles (organization_id, name, description, system_key, is_system)
     SELECT $1, v.name, v.description, v.system_key, true
       FROM (VALUES
         ('ADMIN',   'Full control of the organization',         'ADMIN'),
         ('Manager', 'Manage projects, workspaces and members',  'MANAGER'),
         ('Editor',  'Create and edit requests and collections', 'EDITOR'),
         ('Viewer',  'Read-only access',                         'VIEWER'),
         ('Support', 'Read access plus audit visibility',        'SUPPORT')
       ) AS v(name, description, system_key)
     ON CONFLICT DO NOTHING`,
    [orgId]
  );
  // Mirror legacy org memberships that have never received an IAM assignment.
  // Members with at least one assignment are authoritative and left untouched,
  // so a custom-only grant is never clobbered by the legacy enum.
  await run(
    `INSERT INTO iam_member_roles (organization_id, user_id, role_id)
     SELECT om.org_id, om.user_id, r.id
       FROM organization_members om
       JOIN iam_roles r
         ON r.organization_id = om.org_id
        AND r.system_key = om.role::text
        AND r.is_system
      WHERE om.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM iam_member_roles mr
           WHERE mr.organization_id = om.org_id AND mr.user_id = om.user_id
        )
     ON CONFLICT (organization_id, user_id, role_id) DO NOTHING`,
    [orgId]
  );
}

/**
 * Effective IAM permissions for a user in an organization.
 *   { isAdmin, permissions:Set<string>, roles:[{id,name,systemKey,isSystem,permissions}] }
 * A global `users.role = 'ADMIN'` short-circuits to every catalog key.
 */
async function getEffectivePermissions(userId, orgId) {
  await ensureSystemRolesForOrg(orgId);

  const { rows: userRows } = await query(`SELECT role FROM users WHERE id = $1`, [userId]);
  const isAdmin = Boolean(userRows[0] && userRows[0].role === 'ADMIN');

  const { rows } = await query(
    `SELECT r.id, r.name, r.system_key, r.is_system,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM iam_member_roles mr
       JOIN iam_roles r ON r.id = mr.role_id
       LEFT JOIN iam_role_permissions rp ON rp.role_id = r.id
      WHERE mr.user_id = $1 AND mr.organization_id = $2
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name`,
    [userId, orgId]
  );

  const permissions = new Set();
  const roles = rows.map((r) => {
    const granted = r.system_key
      ? resolveSystemRolePermissions(r.system_key)
      : expandPermissions(r.permissions || []);
    for (const key of granted) permissions.add(key);
    return {
      id: r.id,
      name: r.name,
      systemKey: r.system_key || null,
      isSystem: r.is_system === true,
      permissions: granted,
    };
  });

  if (isAdmin) {
    for (const key of ALL_PERMISSION_KEYS) permissions.add(key);
  }

  return { isAdmin, permissions, roles };
}

async function hasPermission(userId, orgId, key) {
  if (!isValidPermissionKey(key)) return false;
  const { isAdmin, permissions } = await getEffectivePermissions(userId, orgId);
  return isAdmin || permissions.has(key);
}

// Resolve the organization id a route is scoped to.
function orgIdFromParams(req) {
  return (req.params && (req.params.orgId || req.params.id)) || null;
}

/**
 * Express middleware: the caller must be a member of the org (or a global
 * ADMIN).
 */
async function requireOrgMember(req, res, next) {
  try {
    const orgId = orgIdFromParams(req);
    if (!orgId) return res.status(400).json({ error: 'orgId required' });
    if (req.user && req.user.role === 'ADMIN') return next();
    const { rows } = await query(
      `SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, req.user.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Not an organization member' });
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Express middleware factory: the caller must hold `permissionKey` in the org
 * (global ADMIN bypasses).
 */
function requireOrgPermission(permissionKey) {
  return async function requireOrgPermissionMiddleware(req, res, next) {
    try {
      const orgId = orgIdFromParams(req);
      if (!orgId) return res.status(400).json({ error: 'orgId required' });
      if (req.user && req.user.role === 'ADMIN') return next();
      const { permissions } = await getEffectivePermissions(req.user.id, orgId);
      if (!permissions.has(permissionKey)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  LEGACY_ROLE_RANK,
  isValidPermissionKey,
  expandPermissions,
  resolveSystemRolePermissions,
  ensureSystemRolesForOrg,
  getEffectivePermissions,
  hasPermission,
  requireOrgMember,
  requireOrgPermission,
};
