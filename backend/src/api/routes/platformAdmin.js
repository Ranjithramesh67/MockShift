'use strict';

// ============================================================================
// Platform superadmin routes (global users.role = 'ADMIN').
//
// Mounted at /api/platform behind requireAuth + requireAdmin. These endpoints
// deliberately span every organization — they are the cross-org read surface
// used by the superadmin dashboard. Per-org drills reuse /api/orgs/:orgId/... .
//
//   GET /api/platform/overview
//   GET /api/platform/organizations
//   GET /api/platform/mock-servers
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, requireAdmin } = require('../access');

const router = Router();
router.use(requireAuth, requireAdmin);

const MAX_LIMIT = 500;

function clampLimit(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// ------------------------------------------------------------- global overview
router.get('/overview', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT count(*)::int FROM organizations) AS organizations,
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM workspaces) AS workspaces,
         (SELECT count(*)::int FROM projects) AS projects,
         (SELECT count(*)::int FROM collections) AS collections,
         (SELECT count(*)::int FROM folders) AS folders,
         (SELECT count(*)::int FROM api_requests) AS requests,
         (SELECT count(*)::int FROM mock_servers) AS mock_servers,
         (SELECT count(*)::int FROM mock_servers WHERE enabled) AS active_mock_servers,
         (SELECT count(*)::int FROM run_history) AS runs,
         (SELECT count(*)::int FROM audit_logs) AS audit_entries,
         (SELECT count(*)::int FROM organizations
           WHERE created_at >= now() - interval '30 days') AS organizations_30d,
         (SELECT count(*)::int FROM users
           WHERE created_at >= now() - interval '30 days') AS users_30d,
         (SELECT count(*)::int
            FROM projects
           WHERE created_by IS NULL) AS projects_unattributed,
         (SELECT count(*)::int
            FROM mock_servers
           WHERE created_by IS NULL) AS mock_servers_unattributed`
    );
    const counts = rows[0] || {};
    res.json({ scope: 'all', counts });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- all organizations
router.get('/organizations', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE o.name ILIKE $${params.length} OR o.domain ILIKE $${params.length}`;
    }
    const { rows } = await query(
      `SELECT o.id, o.name, o.kind, o.domain, o.created_at,
              o.owner_id,
              owner.name  AS owner_name,
              owner.email AS owner_email,
              (SELECT count(*)::int FROM organization_members om
                WHERE om.org_id = o.id) AS members,
              (SELECT count(*)::int FROM workspaces w
                WHERE w.organization_id = o.id) AS workspaces,
              (SELECT count(*)::int FROM projects p
                WHERE p.organization_id = o.id) AS projects,
              (SELECT count(*)::int FROM collections c
                 JOIN workspaces w ON w.id = c.workspace_id
                WHERE w.organization_id = o.id) AS collections,
              (SELECT count(*)::int FROM folders f
                 JOIN collections c ON c.id = f.collection_id
                 JOIN workspaces w ON w.id = c.workspace_id
                WHERE w.organization_id = o.id) AS folders,
              (SELECT count(*)::int FROM api_requests r
                 JOIN collections c ON c.id = r.collection_id
                 JOIN workspaces w ON w.id = c.workspace_id
                WHERE w.organization_id = o.id) AS requests,
              (SELECT count(*)::int FROM mock_servers ms
                 JOIN projects p ON p.id = ms.project_id
                WHERE p.organization_id = o.id) AS mock_servers,
              (SELECT count(*)::int FROM mock_servers ms
                 JOIN projects p ON p.id = ms.project_id
                WHERE p.organization_id = o.id AND ms.enabled) AS active_mock_servers,
              (SELECT count(*)::int FROM run_history rh
                 JOIN api_requests r ON r.id = rh.request_id
                 JOIN collections c ON c.id = r.collection_id
                 JOIN workspaces w ON w.id = c.workspace_id
                WHERE w.organization_id = o.id) AS runs
         FROM organizations o
         LEFT JOIN users owner ON owner.id = o.owner_id
         ${where}
        ORDER BY o.created_at DESC, o.name`,
      params
    );
    res.json({ organizations: rows });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------- all mock servers + creator
router.get('/mock-servers', async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 200);
    const activeOnly = req.query.active === 'true' || req.query.active === '1';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const params = [];
    const filters = [];
    if (activeOnly) filters.push('ms.enabled = true');
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(ms.name ILIKE $${params.length} OR p.name ILIKE $${params.length}
                     OR o.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await query(
      `SELECT ms.id, ms.name, ms.enabled, ms.created_at, ms.created_by,
              u.name  AS created_by_name,
              u.email AS created_by_email,
              p.id AS project_id, p.name AS project_name,
              w.id AS workspace_id, w.name AS workspace_name,
              o.id AS organization_id, o.name AS organization_name,
              (SELECT count(*)::int FROM mock_routes mr
                WHERE mr.mock_server_id = ms.id) AS route_count
         FROM mock_servers ms
         JOIN projects p ON p.id = ms.project_id
         LEFT JOIN workspaces w ON w.id = p.workspace_id
         LEFT JOIN organizations o ON o.id = p.organization_id
         LEFT JOIN users u ON u.id = ms.created_by
         ${where}
        ORDER BY ms.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ mockServers: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
