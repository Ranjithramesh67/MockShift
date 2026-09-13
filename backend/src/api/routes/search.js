'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, canReadProject, canReadWorkspace } = require('../access');
const { effectiveMenus } = require('../menuAccess');
const { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups } = require('../search');
// Require the docs router to reuse its exported `canReadPage` access helper.
const docsRoutes = require('./docs');

const router = Router();
router.use(requireAuth);

function makeMatcher(user, cache) {
  // cache: Map of `${type}:${projectId|workspaceId}` -> Promise<boolean>
  return async (type, row) => {
    const menuKey = menuKeyForType(type);
    const projectId = row.project_id || null;
    const workspaceId = row.workspace_id || null;
    const scopeKey = `${menuKey}:${projectId || workspaceId || 'org'}`;
    if (!cache.has(scopeKey)) {
      cache.set(scopeKey, effectiveMenus({ userId: user.id, projectId, workspaceId }));
    }
    const menus = await cache.get(scopeKey);
    if (menus.menus[menuKey] === false) return false;
    if (type === 'workspace') return canReadWorkspace(user.id, row.id);
    if (type === 'project') return canReadProject(user.id, row.id);
    if (type === 'doc') return docsRoutes.canReadPage(user, row);
    if (projectId) return canReadProject(user.id, projectId);
    return false;
  };
}

router.get('/', async (req, res, next) => {
  const { q, limit, ok } = normalizeQuery(req.query.q, req.query.limit);
  if (!ok) return res.status(400).json({ error: 'q is required' });
  const like = `%${escapeLike(q)}%`;
  const cache = new Map();
  const allowed = makeMatcher(req.user, cache);
  const groups = {};

  async function collect(type, sql, params, map) {
    const { rows } = await query(sql, [...params, like, limit]);
    const kept = [];
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await allowed(type, row))) continue;
      const item = map(row);
      item.rank = rankResult(item, q);
      kept.push(item);
    }
    if (kept.length) groups[type] = kept;
  }

  try {
    await collect(
      'workspace',
      `SELECT id, name, organization_id, NULL::uuid AS workspace_id, NULL::uuid AS project_id
         FROM workspaces WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, workspaceId: r.id })
    );
    await collect(
      'project',
      `SELECT id, name, workspace_id, id AS project_id, NULL::uuid AS project_ref
         FROM projects WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, workspaceId: r.workspace_id, projectId: r.id })
    );
    await collect(
      'collection',
      `SELECT c.id, c.name, p.id AS project_id, p.workspace_id
         FROM collections c JOIN projects p ON p.id = c.project_id
        WHERE c.name ILIKE $1 ESCAPE '\\' ORDER BY c.name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, projectId: r.project_id, workspaceId: r.workspace_id })
    );
    await collect(
      'folder',
      `SELECT f.id, f.name, c.id AS collection_id, c.name AS collection_name, p.id AS project_id, p.workspace_id
         FROM folders f JOIN collections c ON c.id = f.collection_id JOIN projects p ON p.id = c.project_id
        WHERE f.name ILIKE $1 ESCAPE '\\' ORDER BY f.name LIMIT $2`,
      [],
      (r) => ({
        id: r.id,
        name: r.name,
        collectionId: r.collection_id,
        collectionName: r.collection_name,
        projectId: r.project_id,
        workspaceId: r.workspace_id,
      })
    );
    await collect(
      'request',
      `SELECT r.id, r.name, r.method, r.url, p.id AS project_id, p.workspace_id
         FROM api_requests r JOIN collections c ON c.id = r.collection_id JOIN projects p ON p.id = c.project_id
        WHERE (r.name ILIKE $1 ESCAPE '\\' OR r.url ILIKE $1 ESCAPE '\\')
        ORDER BY r.name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, method: r.method, url: r.url, projectId: r.project_id, workspaceId: r.workspace_id })
    );
    await collect(
      'doc',
      `SELECT id, title AS name, workspace_id, project_id, visibility, parent_id, created_by
         FROM doc_pages
        WHERE title ILIKE $1 ESCAPE '\\' ORDER BY title LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, workspaceId: r.workspace_id, projectId: r.project_id })
    );
    await collect(
      'contract',
      `SELECT id, name, project_id FROM contract_specs
        WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, projectId: r.project_id })
    );
    await collect(
      'monitor',
      `SELECT id, name, project_id FROM monitors
        WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, projectId: r.project_id })
    );
    await collect(
      'mockScenario',
      `SELECT id, name, project_id, description FROM mock_scenarios
        WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, projectId: r.project_id, subtitle: r.description })
    );

    res.json({ query: q, groups, results: flattenGroups(groups) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
