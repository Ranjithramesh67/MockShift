'use strict';

// ============================================================================
// Admin-configurable menu (feature) visibility.
//
// A platform admin disables a feature either for an organization (all of its
// projects) or for one project. Absence of a menu_settings row means ENABLED
// (default-on). Project-scoped rows win over org-scoped rows.
//
// effectiveMenus() is the single resolver used by:
//   - GET /api/menu-access   (feeds the frontend rail + route guards)
//   - requireMenuEnabled()    (backend gate on feature routers)
//
// The DB-backed resolver is injectable (setEffectiveMenus/resetEffectiveMenus)
// so the gate can be unit-tested without a database, mirroring llm.js.
// ============================================================================

const { query } = require('./db');
const { requireAuth } = require('./access');
const { primaryOrgFor } = require('./entitlements');

// Rail features an admin may disable. 'apis' (workspace core) and 'admin'
// (already role-gated) are intentionally not toggleable.
const MENU_KEYS = Object.freeze([
  'teams',
  'automations',
  'history',
  'docs',
  'contracts',
  'monitors',
  'mock-scenarios',
  'copilot',
  'collab',
  'manage',
]);

function isMenuKey(key) {
  return MENU_KEYS.includes(key);
}

// Pure: collapse raw menu_settings rows into { [key]: boolean }, starting from
// "all enabled" and applying org rows first then project rows on top.
function mergeMenuRows(rows) {
  const menus = {};
  for (const key of MENU_KEYS) menus[key] = true;
  const list = Array.isArray(rows) ? rows : [];
  for (const scope of ['org', 'project']) {
    for (const row of list) {
      if (!row || row.scope !== scope) continue;
      if (isMenuKey(row.menu_key)) menus[row.menu_key] = row.enabled !== false;
    }
  }
  return menus;
}

// Pure: standard 403 body for a blocked feature.
function menuDisabledBody(menuKey, { projectId = null } = {}) {
  return {
    error: `The "${menuKey}" feature is disabled for this ${projectId ? 'project' : 'organization'}.`,
    code: 'menu_disabled',
    menuKey,
  };
}

// Resolve the (projectId, orgId) a menu decision applies to.
async function resolveMenuContext({ userId = null, projectId = null, workspaceId = null } = {}) {
  let orgId = null;
  if (projectId) {
    const { rows } = await query(
      `SELECT w.organization_id
         FROM projects p JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = $1`,
      [projectId]
    );
    orgId = rows[0] ? rows[0].organization_id : null;
  } else if (workspaceId) {
    const { rows } = await query(
      `SELECT organization_id FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    orgId = rows[0] ? rows[0].organization_id : null;
  } else if (userId) {
    orgId = await primaryOrgFor(userId);
  }
  return { projectId: projectId || null, orgId };
}

async function defaultEffectiveMenus({ userId = null, projectId = null, workspaceId = null } = {}) {
  const ctx = await resolveMenuContext({ userId, projectId, workspaceId });
  const params = [];
  const clauses = [];
  if (ctx.projectId) {
    params.push(ctx.projectId);
    clauses.push(`(scope = 'project' AND project_id = $${params.length})`);
  }
  if (ctx.orgId) {
    params.push(ctx.orgId);
    clauses.push(`(scope = 'org' AND organization_id = $${params.length})`);
  }
  if (clauses.length === 0) return { ...ctx, menus: mergeMenuRows([]) };
  const { rows } = await query(
    `SELECT menu_key, scope, enabled FROM menu_settings WHERE ${clauses.join(' OR ')}`,
    params
  );
  return { ...ctx, menus: mergeMenuRows(rows) };
}

// Injectable seam for tests.
let effectiveMenusImpl = defaultEffectiveMenus;

function setEffectiveMenus(fn) {
  effectiveMenusImpl = typeof fn === 'function' ? fn : defaultEffectiveMenus;
}

function resetEffectiveMenus() {
  effectiveMenusImpl = defaultEffectiveMenus;
}

async function effectiveMenus(input) {
  return effectiveMenusImpl(input);
}

// Express middleware factory: 403 menu_disabled when the feature is disabled for
// the resolved context. Authenticates first when the route's own requireAuth
// has not run yet (mount-time gates sit before the router).
function requireMenuEnabled(menuKey) {
  if (!isMenuKey(menuKey)) {
    // Unknown key (typo) must never take a feature offline.
    return (req, res, next) => next();
  }
  const check = async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const projectId = req.params.projectId || req.query.projectId || body.projectId || null;
      const workspaceId = req.params.workspaceId || req.query.workspaceId || body.workspaceId || null;
      const result = await effectiveMenus({ userId: req.user.id, projectId, workspaceId });
      if (result.menus[menuKey] === false) {
        return res.status(403).json(menuDisabledBody(menuKey, { projectId: result.projectId }));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  return (req, res, next) => {
    if (req.user) return check(req, res, next);
    return requireAuth(req, res, () => check(req, res, next));
  };
}

module.exports = {
  MENU_KEYS,
  isMenuKey,
  mergeMenuRows,
  menuDisabledBody,
  resolveMenuContext,
  defaultEffectiveMenus,
  setEffectiveMenus,
  resetEffectiveMenus,
  effectiveMenus,
  requireMenuEnabled,
};
