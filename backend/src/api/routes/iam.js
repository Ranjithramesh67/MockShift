'use strict';

// ============================================================================
// IAM routes: org-scoped custom roles + permission catalog.
//
// Mounted at /api, so the paths below resolve to:
//   GET    /api/permissions
//   GET    /api/orgs
//   GET    /api/orgs/:orgId/members
//   GET    /api/orgs/:orgId/roles
//   POST   /api/orgs/:orgId/roles
//   PATCH  /api/orgs/:orgId/roles/:roleId
//   DELETE /api/orgs/:orgId/roles/:roleId
//   PUT    /api/orgs/:orgId/members/:userId/roles
//   GET    /api/orgs/:orgId/me/permissions
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth } = require('../access');
const {
  PERMISSION_GROUPS,
  LEGACY_ROLE_RANK,
  isValidPermissionKey,
  expandPermissions,
  resolveSystemRolePermissions,
  ensureSystemRolesForOrg,
  getEffectivePermissions,
  requireOrgMember,
  requireOrgPermission,
} = require('../permissions');

const router = Router();
router.use(requireAuth);

const MAX_ROLE_NAME = 80;

function normalizePermissions(input) {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'permissions must be an array' };
  }
  const seen = new Set();
  const permissions = [];
  for (const raw of input) {
    if (!isValidPermissionKey(raw)) {
      return { ok: false, error: `Unknown permission: ${String(raw)}` };
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      permissions.push(raw);
    }
  }
  if (permissions.length === 0) {
    return { ok: false, error: 'At least one permission is required' };
  }
  return { ok: true, permissions };
}

// Map a raw iam_roles row (with aggregated permissions + member_count) to the
// API shape. System roles always resolve their permissions from the catalog.
function serializeRole(row) {
  const permissions = row.system_key
    ? resolveSystemRolePermissions(row.system_key)
    : expandPermissions(row.permissions || []);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemKey: row.system_key || null,
    isSystem: row.is_system === true,
    permissions,
    memberCount: Number(row.member_count || 0),
    createdAt: row.created_at,
  };
}

// ------------------------------------------------------------------ catalog
router.get('/permissions', (req, res) => {
  res.json({ groups: PERMISSION_GROUPS });
});

// ------------------------------------------------------------- user's orgs
router.get('/orgs', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.id, o.name, om.role::text AS role,
              (u.role = 'ADMIN' OR om.role = 'ADMIN') AS is_admin
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         JOIN users u ON u.id = om.user_id
        WHERE om.user_id = $1
        ORDER BY o.name`,
      [req.user.id]
    );
    res.json({
      organizations: rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        isAdmin: r.is_admin === true,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- org members
router.get(
  '/orgs/:orgId/members',
  requireOrgPermission('org.manage_members'),
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      await ensureSystemRolesForOrg(orgId);
      const [members, roleRows] = await Promise.all([
        query(
          `SELECT om.user_id, u.name, u.username, u.email, om.role::text AS legacy_role,
                  (o.owner_id = om.user_id) AS is_owner
             FROM organization_members om
             JOIN users u ON u.id = om.user_id
             JOIN organizations o ON o.id = om.org_id
            WHERE om.org_id = $1
            ORDER BY u.name`,
          [orgId]
        ),
        query(
          `SELECT mr.user_id, r.id, r.name, r.system_key, r.is_system
             FROM iam_member_roles mr
             JOIN iam_roles r ON r.id = mr.role_id
            WHERE mr.organization_id = $1
            ORDER BY r.is_system DESC, r.name`,
          [orgId]
        ),
      ]);

      const byUser = new Map();
      for (const r of roleRows.rows) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id).push({
          id: r.id,
          name: r.name,
          systemKey: r.system_key || null,
          isSystem: r.is_system === true,
        });
      }

      res.json({
        members: members.rows.map((m) => ({
          userId: m.user_id,
          name: m.name,
          username: m.username,
          email: m.email,
          legacyRole: m.legacy_role,
          isOwner: m.is_owner === true,
          roles: byUser.get(m.user_id) || [],
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------------- org roles
router.get('/orgs/:orgId/roles', requireOrgMember, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    await ensureSystemRolesForOrg(orgId);
    const { rows } = await query(
      `SELECT r.id, r.name, r.description, r.system_key, r.is_system, r.created_at,
              COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
              (SELECT COUNT(*)::int FROM iam_member_roles mr WHERE mr.role_id = r.id) AS member_count
         FROM iam_roles r
         LEFT JOIN iam_role_permissions rp ON rp.role_id = r.id
        WHERE r.organization_id = $1
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name`,
      [orgId]
    );
    res.json({ roles: rows.map(serializeRole) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/orgs/:orgId/roles',
  requireOrgPermission('org.manage_roles'),
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      const body = req.body || {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > MAX_ROLE_NAME) {
        return res.status(400).json({ error: 'Role name must be 1-80 characters' });
      }
      const norm = normalizePermissions(body.permissions);
      if (!norm.ok) return res.status(400).json({ error: norm.error });
      const description =
        typeof body.description === 'string' ? body.description.trim() : null;

      const dup = await query(
        `SELECT 1 FROM iam_roles WHERE organization_id = $1 AND lower(name) = lower($2)`,
        [orgId, name]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'A role with that name already exists' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO iam_roles (organization_id, name, description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, description, system_key, is_system, created_at`,
          [orgId, name, description, req.user.id]
        );
        const role = rows[0];
        for (const key of norm.permissions) {
          await client.query(
            `INSERT INTO iam_role_permissions (role_id, permission_key) VALUES ($1, $2)`,
            [role.id, key]
          );
        }
        await client.query('COMMIT');
        res.status(201).json({
          role: {
            id: role.id,
            name: role.name,
            description: role.description,
            systemKey: null,
            isSystem: false,
            permissions: norm.permissions,
            memberCount: 0,
            createdAt: role.created_at,
          },
        });
      } catch (err) {
        await client.query('ROLLBACK');
        if (err && err.code === '23505') {
          return res.status(409).json({ error: 'A role with that name already exists' });
        }
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/orgs/:orgId/roles/:roleId',
  requireOrgPermission('org.manage_roles'),
  async (req, res, next) => {
    try {
      const { orgId, roleId } = req.params;
      const body = req.body || {};

      const { rows: existing } = await query(
        `SELECT id, system_key, is_system FROM iam_roles WHERE id = $1 AND organization_id = $2`,
        [roleId, orgId]
      );
      const role = existing[0];
      if (!role) return res.status(404).json({ error: 'Role not found' });
      if (role.is_system) {
        return res.status(403).json({ error: 'System roles cannot be modified' });
      }

      let newName = null;
      if (body.name !== undefined) {
        newName = typeof body.name === 'string' ? body.name.trim() : '';
        if (!newName || newName.length > MAX_ROLE_NAME) {
          return res.status(400).json({ error: 'Role name must be 1-80 characters' });
        }
      }
      let hasDescription = false;
      let newDescription = null;
      if (body.description !== undefined) {
        hasDescription = true;
        newDescription =
          body.description === null
            ? null
            : typeof body.description === 'string'
              ? body.description.trim()
              : null;
      }
      let permissions = null;
      if (body.permissions !== undefined) {
        const norm = normalizePermissions(body.permissions);
        if (!norm.ok) return res.status(400).json({ error: norm.error });
        permissions = norm.permissions;
      }

      if (newName !== null) {
        const dup = await query(
          `SELECT 1 FROM iam_roles WHERE organization_id = $1 AND lower(name) = lower($2) AND id <> $3`,
          [orgId, newName, roleId]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ error: 'A role with that name already exists' });
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const sets = [];
        const params = [roleId];
        if (newName !== null) {
          params.push(newName);
          sets.push(`name = $${params.length}`);
        }
        if (hasDescription) {
          params.push(newDescription);
          sets.push(`description = $${params.length}`);
        }
        sets.push(`updated_at = now()`);
        await client.query(`UPDATE iam_roles SET ${sets.join(', ')} WHERE id = $1`, params);

        if (permissions) {
          await client.query(`DELETE FROM iam_role_permissions WHERE role_id = $1`, [roleId]);
          for (const key of permissions) {
            await client.query(
              `INSERT INTO iam_role_permissions (role_id, permission_key) VALUES ($1, $2)`,
              [roleId, key]
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        if (err && err.code === '23505') {
          return res.status(409).json({ error: 'A role with that name already exists' });
        }
        throw err;
      } finally {
        client.release();
      }

      const { rows } = await query(
        `SELECT r.id, r.name, r.description, r.system_key, r.is_system, r.created_at,
                COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
                (SELECT COUNT(*)::int FROM iam_member_roles mr WHERE mr.role_id = r.id) AS member_count
           FROM iam_roles r
           LEFT JOIN iam_role_permissions rp ON rp.role_id = r.id
          WHERE r.id = $1 AND r.organization_id = $2
          GROUP BY r.id`,
        [roleId, orgId]
      );
      res.json({ role: serializeRole(rows[0]) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/orgs/:orgId/roles/:roleId',
  requireOrgPermission('org.manage_roles'),
  async (req, res, next) => {
    try {
      const { orgId, roleId } = req.params;
      const { rows } = await query(
        `SELECT id, is_system FROM iam_roles WHERE id = $1 AND organization_id = $2`,
        [roleId, orgId]
      );
      const role = rows[0];
      if (!role) return res.status(404).json({ error: 'Role not found' });
      if (role.is_system) {
        return res.status(400).json({ error: 'System roles cannot be modified' });
      }
      await query(`DELETE FROM iam_roles WHERE id = $1 AND organization_id = $2`, [roleId, orgId]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------- assign roles to an org member
router.put(
  '/orgs/:orgId/members/:userId/roles',
  requireOrgPermission('org.manage_members'),
  async (req, res, next) => {
    try {
      const { orgId, userId } = req.params;
      const body = req.body || {};
      if (!Array.isArray(body.roleIds)) {
        return res.status(400).json({ error: 'roleIds must be an array' });
      }
      const roleIds = [...new Set(body.roleIds)];

      const { rows: memberRows } = await query(
        `SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId]
      );
      if (memberRows.length === 0) {
        return res.status(404).json({ error: 'User is not a member of this organization' });
      }

      await ensureSystemRolesForOrg(orgId);

      const { rows: roleRows } = await query(
        `SELECT id, name, system_key, is_system
           FROM iam_roles
          WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [orgId, roleIds]
      );
      if (roleRows.length !== roleIds.length) {
        return res.status(400).json({ error: 'One or more roles do not belong to this organization' });
      }

      const { rows: orgRows } = await query(`SELECT owner_id FROM organizations WHERE id = $1`, [
        orgId,
      ]);
      const ownerId = orgRows[0] ? orgRows[0].owner_id : null;

      // Resulting system-role assignment for every member after the change.
      const { rows: current } = await query(
        `SELECT mr.user_id, r.system_key
           FROM iam_member_roles mr
           JOIN iam_roles r ON r.id = mr.role_id
          WHERE mr.organization_id = $1 AND mr.user_id <> $2`,
        [orgId, userId]
      );
      const resulting = new Map();
      for (const row of current) {
        if (!row.system_key) continue;
        if (!resulting.has(row.user_id)) resulting.set(row.user_id, new Set());
        resulting.get(row.user_id).add(row.system_key);
      }
      const targetSet = new Set(roleRows.map((r) => r.system_key).filter(Boolean));
      resulting.set(userId, targetSet);

      const retainsAdmin = [...resulting.values()].some((set) => set.has('ADMIN'));
      if (!retainsAdmin) {
        return res
          .status(400)
          .json({ error: 'The organization must retain at least one member with the ADMIN role' });
      }
      if (ownerId && !(resulting.get(ownerId) && resulting.get(ownerId).has('ADMIN'))) {
        return res
          .status(400)
          .json({ error: 'The organization owner must retain the ADMIN role' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM iam_member_roles WHERE organization_id = $1 AND user_id = $2`,
          [orgId, userId]
        );
        for (const role of roleRows) {
          await client.query(
            `INSERT INTO iam_member_roles (organization_id, user_id, role_id, granted_by)
             VALUES ($1, $2, $3, $4)`,
            [orgId, userId, role.id, req.user.id]
          );
        }

        // Legacy mirror: highest-ranked assigned system role. SUPPORT maps to
        // VIEWER for the legacy enum (which has no SUPPORT in this app's org
        // membership path). Custom-only assignments leave the legacy role as-is.
        let best = null;
        for (const role of roleRows) {
          if (!role.system_key) continue;
          const rank = LEGACY_ROLE_RANK[role.system_key] || 0;
          if (!best || rank > best.rank) best = { key: role.system_key, rank };
        }
        if (best) {
          const legacyRole = best.key === 'SUPPORT' ? 'VIEWER' : best.key;
          await client.query(
            `UPDATE organization_members SET role = $1 WHERE org_id = $2 AND user_id = $3`,
            [legacyRole, orgId, userId]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      res.json({
        roles: roleRows.map((r) => ({
          id: r.id,
          name: r.name,
          systemKey: r.system_key || null,
          isSystem: r.is_system === true,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// --------------------------------------------------- my effective permissions
router.get('/orgs/:orgId/me/permissions', requireOrgMember, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const effective = await getEffectivePermissions(req.user.id, orgId);
    res.json({
      permissions: [...effective.permissions],
      roles: effective.roles,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
