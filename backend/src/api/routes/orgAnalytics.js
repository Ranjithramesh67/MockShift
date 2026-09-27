'use strict';

// ============================================================================
// Organization analytics (org admins / managers; global admins bypass).
//
// Mounted at /api, so the paths resolve to:
//   GET /api/orgs/:orgId/analytics
//   GET /api/orgs/:orgId/analytics/members
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const { requireOrgPermission } = require('../permissions');

const router = Router();
router.use(requireAuth);

const ORG_WORKSPACES = `SELECT id FROM workspaces WHERE organization_id = $1`;

// --------------------------------------------------------------- summary
router.get('/orgs/:orgId/analytics', requireOrgPermission('org.manage_members'), async (req, res, next) => {
  try {
    const { orgId } = req.params;

    const summaryPromise = query(
      `SELECT
         (SELECT count(*)::int FROM organization_members WHERE org_id = $1) AS members,
         (SELECT count(*)::int FROM workspaces WHERE organization_id = $1) AS workspaces,
         (SELECT count(*)::int FROM projects WHERE organization_id = $1) AS projects,
         (SELECT count(*)::int FROM collections c
            JOIN workspaces w ON w.id = c.workspace_id
           WHERE w.organization_id = $1) AS collections,
         (SELECT count(*)::int FROM folders f
            JOIN collections c ON c.id = f.collection_id
            JOIN workspaces w ON w.id = c.workspace_id
           WHERE w.organization_id = $1) AS folders,
         (SELECT count(*)::int FROM api_requests r
            JOIN collections c ON c.id = r.collection_id
            JOIN workspaces w ON w.id = c.workspace_id
           WHERE w.organization_id = $1) AS requests,
         (SELECT count(*)::int FROM mock_servers ms
            JOIN projects p ON p.id = ms.project_id
           WHERE p.organization_id = $1) AS mock_servers,
         (SELECT count(*)::int FROM mock_servers ms
            JOIN projects p ON p.id = ms.project_id
           WHERE p.organization_id = $1 AND ms.enabled) AS active_mock_servers,
         (SELECT count(*)::int FROM request_revisions rr
           WHERE rr.workspace_id IN (${ORG_WORKSPACES})) AS request_revisions,
         (SELECT count(*)::int FROM run_history rh
            JOIN api_requests r ON r.id = rh.request_id
            JOIN collections c ON c.id = r.collection_id
            JOIN workspaces w ON w.id = c.workspace_id
           WHERE w.organization_id = $1) AS runs,
         (SELECT count(*)::int FROM run_history rh
            JOIN api_requests r ON r.id = rh.request_id
            JOIN collections c ON c.id = r.collection_id
            JOIN workspaces w ON w.id = c.workspace_id
           WHERE w.organization_id = $1
             AND rh.started_at >= date_trunc('month', now())) AS runs_this_month`,
      [orgId]
    );

    const mostTriggeredPromise = query(
      `SELECT r.id AS request_id, r.name, r.method, r.url,
              c.name AS collection_name, p.name AS project_name,
              count(rh.id)::int AS runs,
              max(rh.started_at) AS last_run_at
         FROM run_history rh
         JOIN api_requests r ON r.id = rh.request_id
         JOIN collections c ON c.id = r.collection_id
         JOIN workspaces w ON w.id = c.workspace_id
         LEFT JOIN projects p ON p.id = c.project_id
        WHERE w.organization_id = $1
        GROUP BY r.id, r.name, r.method, r.url, c.name, p.name
        ORDER BY runs DESC, last_run_at DESC NULLS LAST
        LIMIT 10`,
      [orgId]
    );

    const trendPromise = query(
      `SELECT to_char(date_trunc('day', rh.started_at), 'YYYY-MM-DD') AS day,
              count(*)::int AS runs
         FROM run_history rh
         JOIN api_requests r ON r.id = rh.request_id
         JOIN collections c ON c.id = r.collection_id
         JOIN workspaces w ON w.id = c.workspace_id
        WHERE w.organization_id = $1
          AND rh.started_at >= now() - interval '13 days'
        GROUP BY 1
        ORDER BY 1`,
      [orgId]
    );

    const [summary, mostTriggered, trend] = await Promise.all([
      summaryPromise,
      mostTriggeredPromise,
      trendPromise,
    ]);

    res.json({
      orgId,
      summary: summary.rows[0] || {},
      mostTriggered: mostTriggered.rows,
      runTrend: trend.rows,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------- member leaderboard
router.get(
  '/orgs/:orgId/analytics/members',
  requireOrgPermission('org.manage_members'),
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      const { rows } = await query(
        `SELECT om.user_id, u.name, u.username, u.email, om.role::text AS role,
                COALESCE(pj.c, 0)::int  AS projects_created,
                COALESCE(ws.c, 0)::int  AS workspaces_created,
                COALESCE(col.c, 0)::int AS collections_created,
                COALESCE(fd.c, 0)::int  AS folders_created,
                COALESCE(req.c, 0)::int AS requests_created,
                COALESCE(ms.c, 0)::int  AS mock_servers_created,
                COALESCE(rev.c, 0)::int AS revisions_created,
                COALESCE(runs.c, 0)::int AS runs
           FROM organization_members om
           JOIN users u ON u.id = om.user_id
           LEFT JOIN (
             SELECT created_by, count(*)::int AS c FROM projects
              WHERE organization_id = $1 AND created_by IS NOT NULL
              GROUP BY created_by
           ) pj ON pj.created_by = om.user_id
           LEFT JOIN (
             SELECT created_by, count(*)::int AS c FROM workspaces
              WHERE organization_id = $1 AND created_by IS NOT NULL
              GROUP BY created_by
           ) ws ON ws.created_by = om.user_id
           LEFT JOIN (
             SELECT c.created_by, count(*)::int AS c
               FROM collections c
               JOIN workspaces w ON w.id = c.workspace_id
              WHERE w.organization_id = $1 AND c.created_by IS NOT NULL
              GROUP BY c.created_by
           ) col ON col.created_by = om.user_id
           LEFT JOIN (
             SELECT f.created_by, count(*)::int AS c
               FROM folders f
               JOIN collections c ON c.id = f.collection_id
               JOIN workspaces w ON w.id = c.workspace_id
              WHERE w.organization_id = $1 AND f.created_by IS NOT NULL
              GROUP BY f.created_by
           ) fd ON fd.created_by = om.user_id
           LEFT JOIN (
             SELECT rr.created_by, count(DISTINCT rr.request_id)::int AS c
               FROM request_revisions rr
              WHERE rr.workspace_id IN (${ORG_WORKSPACES})
                AND rr.change_kind = 'create' AND rr.created_by IS NOT NULL
              GROUP BY rr.created_by
           ) req ON req.created_by = om.user_id
           LEFT JOIN (
             SELECT ms.created_by, count(*)::int AS c
               FROM mock_servers ms
               JOIN projects p ON p.id = ms.project_id
              WHERE p.organization_id = $1 AND ms.created_by IS NOT NULL
              GROUP BY ms.created_by
           ) ms ON ms.created_by = om.user_id
           LEFT JOIN (
             SELECT rr.created_by, count(*)::int AS c
               FROM request_revisions rr
              WHERE rr.workspace_id IN (${ORG_WORKSPACES}) AND rr.created_by IS NOT NULL
              GROUP BY rr.created_by
           ) rev ON rev.created_by = om.user_id
           LEFT JOIN (
             SELECT rh.user_id, count(*)::int AS c
               FROM run_history rh
               JOIN api_requests r ON r.id = rh.request_id
               JOIN collections c ON c.id = r.collection_id
               JOIN workspaces w ON w.id = c.workspace_id
              WHERE w.organization_id = $1 AND rh.user_id IS NOT NULL
              GROUP BY rh.user_id
            ) runs ON runs.user_id = om.user_id
          WHERE om.org_id = $1
          ORDER BY (
            COALESCE(pj.c, 0) + COALESCE(ws.c, 0) + COALESCE(col.c, 0) +
            COALESCE(fd.c, 0) + COALESCE(req.c, 0) + COALESCE(ms.c, 0)
          ) DESC,
          COALESCE(runs.c, 0) DESC,
          u.name`,
        [orgId]
      );
      res.json({ orgId, members: rows });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
