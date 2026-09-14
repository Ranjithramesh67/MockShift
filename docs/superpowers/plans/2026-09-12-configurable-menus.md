# Admin-Configurable Menu Enable/Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin disable any feature "menu" for a whole organization or for one specific project; disabled menus disappear from the left rail and their backend routes reject direct API access with `403 menu_disabled`.

**Architecture:** A new append-only migration adds `menu_settings` (override rows only; absence = enabled). A single resolver `effectiveMenus()` collapses org-scoped rows then project-scoped rows on top, and is used by both `GET /api/menu-access` (frontend rail/route guard) and a `requireMenuEnabled(menuKey)` Express middleware mounted at each feature router in `server.js`. The frontend caches the effective flags in a new `MenuAccessProvider` and hides rail items / shows a disabled screen; the backend is the source of truth and always enforces.

**Tech Stack:** PostgreSQL 15 (raw SQL migrations), Express (CommonJS), Node `node:test` for backend unit + integration tests, Next.js 14 / React 18 / TypeScript for the frontend, `node --test` for framework-free frontend unit tests.

## Global Constraints

- Never wipe the dev `apihub` DB on 5432. Integration suites run against a scratch cluster on port 5441 with `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub`.
- Migrations are append-only and run in filename order; latest existing is `039_organizations_identity.sql`. Add `040_menu_settings.sql` only.
- Backend code is CommonJS (`'use strict';`, `require`, `module.exports`); raw SQL via `require('../db').query`, never an ORM.
- Backend connects as privileged `postgres` so RLS is bypassed; real authorization lives in the route layer. Still add RLS DDL for defense in depth, mirroring migration 035.
- Toggleable menu keys are exactly: `teams`, `automations`, `history`, `docs`, `contracts`, `monitors`, `mock-scenarios`, `copilot`, `collab`, `manage`. `apis` (workspace core) and `admin` (role-gated) are never toggleable.
- Commits use Conventional Commits, scoped, e.g. `feat(menus): ...`. Do NOT add the `Co-authored-by` trailer manually — a hook appends it.
- Never stage `docs/superpowers/` or `frontend/tsconfig.tsbuildinfo`.
- Frontend: `apiFetch`/`ApiError` for API calls, `data-testid` on new UI, scoped `*.module.css` for new component styles unless an existing global class fits.
- Do not run `next build` while the frontend dev server owns `.next`.

---

### Task 1: `menu_settings` migration + resolver/gate module + unit tests

**Files:**
- Create: `db/migrations/040_menu_settings.sql`
- Create: `backend/src/api/menuAccess.js`
- Modify: `backend/src/api/entitlements.js` (export `primaryOrgFor`)
- Modify: `backend/src/api/access.js` (early-return in `requireAuth` when `req.user` already set)
- Test: `backend/src/api/__tests__/menuAccess.test.cjs`

**Interfaces:**
- Consumes: `query` from `backend/src/api/db.js`; `requireAuth` from `backend/src/api/access.js`; `primaryOrgFor` from `backend/src/api/entitlements.js`; `app.is_org_member` SQL helper from migration 001.
- Produces:
  - `MENU_KEYS: readonly string[]`
  - `isMenuKey(key) => boolean`
  - `mergeMenuRows(rows) => Record<string, boolean>`
  - `menuDisabledBody(menuKey, { projectId }) => { error, code: 'menu_disabled', menuKey }`
  - `resolveMenuContext({ userId, projectId, workspaceId }) => Promise<{ projectId, orgId }>`
  - `effectiveMenus({ userId, projectId, workspaceId }) => Promise<{ projectId, orgId, menus }>`
  - `setEffectiveMenus(fn)` / `resetEffectiveMenus()` (test seam)
  - `requireMenuEnabled(menuKey) => express middleware`
  - `primaryOrgFor(userId) => Promise<string|null>` now exported from `entitlements.js`

- [ ] **Step 1: Write the migration**

Create `db/migrations/040_menu_settings.sql`:

```sql
-- ============================================================================
-- API Hub — 040_menu_settings.sql
-- Admin-configurable menu (feature) visibility.
--
-- A platform admin may disable a rail feature either for a whole organization
-- (all of its projects) or for one specific project. The table stores OVERRIDES
-- ONLY: the absence of a row means the feature is enabled (default-on).
--
-- Scope invariants:
--   scope='org'     -> organization_id set, project_id null
--   scope='project' -> project_id set,      organization_id null
--
-- When both an org row and a project row exist for the same menu_key, the
-- project row wins (more specific). Merge order lives in menuAccess.js.
-- ============================================================================

CREATE TABLE menu_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_key        text NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('org', 'project')),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_settings_scope_target CHECK (
    (scope = 'org'     AND organization_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL      AND organization_id IS NULL)
  )
);

-- One override per (menu, org) and per (menu, project).
CREATE UNIQUE INDEX menu_settings_org_uidx
  ON menu_settings (menu_key, organization_id) WHERE scope = 'org';
CREATE UNIQUE INDEX menu_settings_project_uidx
  ON menu_settings (menu_key, project_id) WHERE scope = 'project';

CREATE INDEX menu_settings_organization_idx ON menu_settings (organization_id) WHERE scope = 'org';
CREATE INDEX menu_settings_project_idx      ON menu_settings (project_id)      WHERE scope = 'project';

COMMENT ON TABLE menu_settings IS
  'Per-org / per-project feature (menu) enable/disable overrides. No row = enabled.';
COMMENT ON COLUMN menu_settings.menu_key IS
  'Toggleable feature id (teams, docs, copilot, ...). Validated in the app; not enumerated here so new menus need no migration.';
COMMENT ON COLUMN menu_settings.enabled IS
  'false hides the rail item and makes requireMenuEnabled() reject API access for the scoped org/project.';

-- Defense in depth (app connects as a privileged role today; real authz is in
-- the admin route). Members of the owning org may read the effective flag.
ALTER TABLE menu_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_settings_select ON menu_settings FOR SELECT
  USING (
    (scope = 'org' AND app.is_org_member(app.current_user_id(), organization_id)) OR
    (scope = 'project' AND EXISTS (
       SELECT 1 FROM projects p
         JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = menu_settings.project_id
          AND app.is_org_member(app.current_user_id(), w.organization_id)
    ))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON menu_settings TO app_user;
```

- [ ] **Step 2: Export `primaryOrgFor` from entitlements**

In `backend/src/api/entitlements.js`, find the `module.exports = {` block (around line 518) and add `primaryOrgFor`:

```js
module.exports = {
  CANONICAL_KEYS,
  canonicalLimits,
  resolveLimits,
  countPoolUsage,
  currentRunUsage,
  checkCountGate,
  checkSeatGate,
  checkPublicSharingGate,
  chargeRuns,
  orgOfWorkspace,
  orgOfProject,
  orgOfCollection,
  planLimitBody,
  primaryOrgFor,
};
```

- [ ] **Step 3: Early-return in `requireAuth` when already authenticated**

In `backend/src/api/access.js`, change the start of `requireAuth` (line 34) so a middleware chain that already authenticated does not re-load the user:

```js
async function requireAuth(req, res, next) {
  if (req.user) return next();
  try {
    const sessionPayload = verifySession(readSessionToken(req));
```

Leave the rest of the function unchanged.

- [ ] **Step 4: Write `menuAccess.js`**

Create `backend/src/api/menuAccess.js`:

```js
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
```

- [ ] **Step 5: Write the failing unit test**

Create `backend/src/api/__tests__/menuAccess.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MENU_KEYS,
  isMenuKey,
  mergeMenuRows,
  menuDisabledBody,
  setEffectiveMenus,
  resetEffectiveMenus,
  requireMenuEnabled,
} = require('../menuAccess');

test('MENU_KEYS excludes core and admin', () => {
  assert.ok(MENU_KEYS.includes('docs'));
  assert.ok(MENU_KEYS.includes('mock-scenarios'));
  assert.ok(!MENU_KEYS.includes('apis'));
  assert.ok(!MENU_KEYS.includes('admin'));
  assert.equal(isMenuKey('docs'), true);
  assert.equal(isMenuKey('bogus'), false);
});

test('mergeMenuRows defaults every key on and lets project override org', () => {
  const menus = mergeMenuRows([
    { menu_key: 'docs', scope: 'org', enabled: false },
    { menu_key: 'docs', scope: 'project', enabled: true },
    { menu_key: 'copilot', scope: 'org', enabled: false },
  ]);
  for (const key of MENU_KEYS) assert.equal(typeof menus[key], 'boolean');
  assert.equal(menus.docs, true);
  assert.equal(menus.copilot, false);
  assert.equal(menus.contracts, true);
});

test('mergeMenuRows ignores unknown keys and malformed rows', () => {
  const menus = mergeMenuRows([{ menu_key: 'bogus', scope: 'org', enabled: false }, null]);
  assert.ok(!('bogus' in menus));
});

test('menuDisabledBody names the scope', () => {
  assert.equal(menuDisabledBody('docs', { projectId: 'p1' }).code, 'menu_disabled');
  assert.equal(
    menuDisabledBody('docs', { projectId: 'p1' }).error,
    'The "docs" feature is disabled for this project.'
  );
  assert.equal(
    menuDisabledBody('docs', {}).error,
    'The "docs" feature is disabled for this organization.'
  );
});

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('gate blocks with 403 when the resolver disables the menu', async () => {
  setEffectiveMenus(async () => ({ menus: { docs: false }, projectId: null, orgId: 'o1' }));
  const mw = requireMenuEnabled('docs');
  const res = fakeRes();
  let nextCalled = false;
  await mw({ user: { id: 'u1' }, params: {}, query: {}, body: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'menu_disabled');
  resetEffectiveMenus();
});

test('gate passes when enabled and ignores unknown keys', async () => {
  setEffectiveMenus(async () => ({ menus: { docs: true }, projectId: null, orgId: 'o1' }));
  const mw = requireMenuEnabled('docs');
  const res = fakeRes();
  let nextCalled = false;
  await mw({ user: { id: 'u1' }, params: {}, query: {}, body: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);

  const unknown = requireMenuEnabled('bogus');
  let unknownNext = false;
  await unknown({}, fakeRes(), () => {
    unknownNext = true;
  });
  assert.equal(unknownNext, true);
  resetEffectiveMenus();
});
```

- [ ] **Step 6: Run the unit test (should pass; it only needs the module)**

Run: `cd backend && npm run test:api:unit`
Expected: all existing unit tests plus the 6 new `menuAccess` tests pass.

- [ ] **Step 7: Apply the migration to the scratch DB and verify it parses**

Run:
```bash
PGPORT=5441 PGDATABASE=apihub PGUSER=postgres PGPASSWORD=postgres psql -v ON_ERROR_STOP=1 -f /workspace/db/migrations/040_menu_settings.sql
```
Expected: no error (table already exists only if re-run; a fresh scratch DB has been migrated by the integration harness in Task 2).

- [ ] **Step 8: Commit**

```bash
cd /workspace
git add db/migrations/040_menu_settings.sql backend/src/api/menuAccess.js backend/src/api/entitlements.js backend/src/api/access.js backend/src/api/__tests__/menuAccess.test.cjs
git commit -m "feat(menus): add menu_settings table, resolver and API gate"
```

---

### Task 2: Menu-access endpoint, admin CRUD and server wiring + integration tests

**Files:**
- Create: `backend/src/api/routes/menuAccess.js`
- Modify: `backend/src/api/routes/admin.js` (import + three `/menus` handlers)
- Modify: `backend/src/api/server.js` (require + mounts/gates)
- Test: `backend/tests/menus.integration.test.cjs`

**Interfaces:**
- Consumes: `effectiveMenus`, `MENU_KEYS`, `isMenuKey`, `requireMenuEnabled` from Task 1; `logAudit` from `backend/src/api/audit.js`.
- Produces (HTTP):
  - `GET /api/menu-access?workspaceId=&projectId=` → `{ menus, projectId, orgId, keys }`
  - `GET /api/admin/menus` → `{ keys, settings, organizations, projects }`
  - `PUT /api/admin/menus` `{ menuKey, scope, organizationId|projectId, enabled }` → `{ setting }`
  - `DELETE /api/admin/menus/:id` → `{ ok: true }`

- [ ] **Step 1: Create the menu-access route**

Create `backend/src/api/routes/menuAccess.js`:

```js
'use strict';

const { Router } = require('express');
const { requireAuth } = require('../access');
const { effectiveMenus, MENU_KEYS } = require('../menuAccess');

const router = Router();
router.use(requireAuth);

// GET /api/menu-access?workspaceId=&projectId=
// Effective feature flags for the caller's current context. `projectId` (when
// known) makes project-scoped overrides apply; otherwise the workspace's org
// (or the user's primary org) is used.
router.get('/', async (req, res, next) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : null;
    const result = await effectiveMenus({ userId: req.user.id, projectId, workspaceId });
    res.json({ menus: result.menus, projectId: result.projectId, orgId: result.orgId, keys: MENU_KEYS });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: Add admin menu CRUD**

In `backend/src/api/routes/admin.js`, update the imports at the top:

```js
const { checkSeatGate, orgOfProject, orgOfWorkspace } = require('../entitlements');
const { MENU_KEYS, isMenuKey } = require('../menuAccess');
```

Then insert these three handlers immediately before `module.exports = router;` at the end of the file:

```js
// ------------------------------------------------------------ menu settings
// Platform-admin control of per-org / per-project feature visibility.
router.get('/menus', async (req, res, next) => {
  try {
    const [settings, organizations, projects] = await Promise.all([
      query(
        `SELECT ms.id, ms.menu_key, ms.scope, ms.enabled, ms.updated_at,
                ms.organization_id, o.name AS organization_name,
                ms.project_id, p.name AS project_name, w.name AS workspace_name
           FROM menu_settings ms
           LEFT JOIN organizations o ON o.id = ms.organization_id
           LEFT JOIN projects p ON p.id = ms.project_id
           LEFT JOIN workspaces w ON w.id = p.workspace_id
          ORDER BY ms.menu_key, ms.scope, ms.updated_at DESC`
      ),
      query(`SELECT id, name, kind FROM organizations ORDER BY kind, name`),
      query(
        `SELECT p.id, p.name, w.name AS workspace_name
           FROM projects p JOIN workspaces w ON w.id = p.workspace_id
          ORDER BY w.name, p.name`
      ),
    ]);
    res.json({
      keys: MENU_KEYS,
      settings: settings.rows,
      organizations: organizations.rows,
      projects: projects.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/menus', async (req, res, next) => {
  try {
    const { menuKey, scope, organizationId, projectId, enabled } = req.body || {};
    if (!isMenuKey(menuKey)) return res.status(400).json({ error: 'Unknown menu key' });
    if (scope !== 'org' && scope !== 'project') {
      return res.status(400).json({ error: 'scope must be "org" or "project"' });
    }
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });

    let setting;
    if (scope === 'org') {
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
      const org = await query(`SELECT id FROM organizations WHERE id = $1`, [organizationId]);
      if (org.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
      const { rows } = await query(
        `INSERT INTO menu_settings (menu_key, scope, organization_id, enabled, updated_by)
         VALUES ($1, 'org', $2, $3, $4)
         ON CONFLICT (menu_key, organization_id) WHERE scope = 'org'
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [menuKey, organizationId, enabled, req.user.id]
      );
      setting = rows[0];
    } else {
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      const project = await query(`SELECT id FROM projects WHERE id = $1`, [projectId]);
      if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
      const { rows } = await query(
        `INSERT INTO menu_settings (menu_key, scope, project_id, enabled, updated_by)
         VALUES ($1, 'project', $2, $3, $4)
         ON CONFLICT (menu_key, project_id) WHERE scope = 'project'
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [menuKey, projectId, enabled, req.user.id]
      );
      setting = rows[0];
    }

    await logAudit({
      actorId: req.user.id,
      entityType: scope === 'org' ? 'organization' : 'project',
      entityId: scope === 'org' ? organizationId : projectId,
      action: 'set_menu_setting',
      detail: { menuKey, scope, enabled },
      ip: req.ip,
    });
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});

router.delete('/menus/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM menu_settings WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Menu setting not found' });
    await logAudit({
      actorId: req.user.id,
      entityType: 'menu_setting',
      entityId: req.params.id,
      action: 'delete_menu_setting',
      detail: { menuKey: rows[0].menu_key, scope: rows[0].scope },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Wire the gate and route into `server.js`**

In `backend/src/api/server.js`, add the requires near the other route requires (after line 31, `const sdkRoutes = ...`):

```js
const menuAccessRoutes = require('./routes/menuAccess');
const { requireMenuEnabled } = require('./menuAccess');
```

Mount the feature flags endpoint after `app.use('/api/auth', authRoutes);`:

```js
  app.use('/api/menu-access', menuAccessRoutes);
```

Now change the feature mounts. Replace each line below with its gated form (order matters: a gate registered at a prefix must come before the router that serves that prefix):

```js
  app.use('/api/manage', requireMenuEnabled('manage'), manageRoutes);
  app.use('/api/teams', requireMenuEnabled('teams'), teamRoutes);
  app.use('/api/automations', requireMenuEnabled('automations'));
  app.use('/api/history', requireMenuEnabled('history'), historyRoutes);
  app.use('/api/docs', requireMenuEnabled('docs'), docsRoutes);
  app.use('/api/contracts', requireMenuEnabled('contracts'), contractsRoutes);
  app.use('/api/monitors', requireMenuEnabled('monitors'), monitorRoutes);
  app.use('/api/copilot', requireMenuEnabled('copilot'), copilotRoutes);
  app.use('/api/mock-scenarios', requireMenuEnabled('mock-scenarios'));
  app.use('/api/mock-routes', requireMenuEnabled('mock-scenarios'));
  app.use('/api/comments', requireMenuEnabled('collab'));
  app.use('/api/reviews', requireMenuEnabled('collab'));
```

Keep the existing `app.use('/api', automationRoutes);`, `app.use('/api', mockScenarioRoutes);`, `app.use('/api', commentRoutes);`, `app.use('/api', reviewRoutes);` mounts where they are — they run after the prefix gates above. The existing `app.use('/api/docs/public', docsRoutes.publicRouter);` stays before the `/api/docs` gate so public docs links remain reachable.

- [ ] **Step 4: Write the integration test**

Create `backend/tests/menus.integration.test.cjs`:

```js
'use strict';

// Integration tests for admin-configurable menus:
//   - admin CRUD: PUT/GET/DELETE /api/admin/menus
//   - GET /api/menu-access resolves org vs project scope
//   - a disabled feature router returns 403 menu_disabled
//   - non-admins cannot mutate menu settings

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

let server;
let base;

function makeClient() {
  let cookie = '';
  async function api(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api };
}

let admin;
let editor;
let orgId;
let projectId;
let workspaceId;

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/menu-access', require('../src/api/routes/menuAccess'));
  app.use('/api/admin', require('../src/api/routes/admin'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api/docs', require('../src/api/menuAccess').requireMenuEnabled('docs'), require('../src/api/routes/docs'));

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'menusadmin@test.io',
    password: 'adminpass123',
    name: 'Menus Admin',
  });
  assert.equal(signup.status, 201);
  orgId = signup.json.user.organizations[0].id;

  const ws = await admin.api('GET', '/api/workspaces');
  workspaceId = ws.json.workspaces[0].id;
  const content = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  projectId = content.json.projects[0].id;

  editor = makeClient();
  const editorSignup = await editor.api('POST', '/api/auth/signup', {
    email: 'menuseditor@test.io',
    password: 'editorpass123',
    name: 'Menus Editor',
  });
  assert.equal(editorSignup.status, 201);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('GET /api/menu-access defaults every toggleable key to enabled', async () => {
  const res = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.menus.docs, true);
  assert.equal(res.json.menus.copilot, true);
  assert.equal(res.json.orgId, orgId);
});

test('non-admin cannot read or write menu settings', async () => {
  const read = await editor.api('GET', '/api/admin/menus');
  assert.equal(read.status, 403);
  const write = await editor.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(write.status, 403);
});

test('org-scoped disable hides the menu and blocks the feature route', async () => {
  const put = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(put.status, 200);
  const settingId = put.json.setting.id;

  const access = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(access.json.menus.docs, false);

  const blocked = await admin.api('GET', '/api/docs');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'menu_disabled');
  assert.equal(blocked.json.menuKey, 'docs');

  const del = await admin.api('DELETE', `/api/admin/menus/${settingId}`);
  assert.equal(del.status, 200);
  const restored = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}`);
  assert.equal(restored.json.menus.docs, true);
});

test('project override wins over an org disable', async () => {
  await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  const projectOn = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'project',
    projectId,
    enabled: true,
  });
  assert.equal(projectOn.status, 200);

  const access = await admin.api('GET', `/api/menu-access?workspaceId=${workspaceId}&projectId=${projectId}`);
  assert.equal(access.json.menus.docs, true);

  const allowed = await admin.api('GET', `/api/docs?projectId=${projectId}`);
  assert.notEqual(allowed.status, 403);
});

test('PUT rejects unknown menu keys and bad scope', async () => {
  const badKey = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'nope',
    scope: 'org',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(badKey.status, 400);
  const badScope = await admin.api('PUT', '/api/admin/menus', {
    menuKey: 'docs',
    scope: 'team',
    organizationId: orgId,
    enabled: false,
  });
  assert.equal(badScope.status, 400);
});
```

- [ ] **Step 5: Run the integration test**

Run:
```bash
cd /workspace/backend
PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/menus.integration.test.cjs
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /workspace
git add backend/src/api/routes/menuAccess.js backend/src/api/routes/admin.js backend/src/api/server.js backend/tests/menus.integration.test.cjs
git commit -m "feat(menus): expose menu-access endpoint, admin CRUD and route gates"
```

---

### Task 3: Frontend menu-access store + rail/route filtering

**Files:**
- Create: `frontend/src/lib/menuKeys.js`
- Test: `frontend/src/lib/__tests__/menuKeys.test.cjs`
- Create: `frontend/src/store/MenuAccessStore.tsx`
- Modify: `frontend/src/lib/api.ts` (types + `menuApi`)
- Modify: `frontend/app/layout.tsx` (wrap with provider)
- Modify: `frontend/src/components/Sidebar.tsx` (hide disabled rail items)
- Modify: `frontend/src/components/AppShell.tsx` (disabled screen for a blocked view)

**Interfaces:**
- Consumes: `GET /api/menu-access`; `useWorkspace()` (`activeWorkspaceId`, `activeCollectionId`, `tree`); `apiFetch`.
- Produces:
  - `frontend/src/lib/menuKeys.js`: `TOGGLEABLE_MENU_KEYS`, `defaultMenus()`, `isMenuEnabled(menus, key)`
  - `frontend/src/store/MenuAccessStore.tsx`: `MenuAccessProvider`, `useMenuAccess()` returning `{ menus, loading, isEnabled, refresh }`
  - `frontend/src/lib/api.ts`: `MenuKey`, `MenuAccessResponse`, `menuApi.get({ workspaceId, projectId })`

- [ ] **Step 1: Add the pure helper module**

Create `frontend/src/lib/menuKeys.js`:

```js
'use strict';

// Framework-free menu helpers shared by the rail, the route guard and the unit
// tests. The backend is the source of truth; the frontend fails OPEN (unknown
// or not-yet-loaded keys are treated as enabled) so a slow fetch never hides a
// feature that is actually available.
const TOGGLEABLE_MENU_KEYS = [
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
];

function defaultMenus() {
  const menus = {};
  for (const key of TOGGLEABLE_MENU_KEYS) menus[key] = true;
  return menus;
}

function isMenuEnabled(menus, key) {
  if (!TOGGLEABLE_MENU_KEYS.includes(key)) return true;
  if (!menus || typeof menus !== 'object') return true;
  return menus[key] !== false;
}

module.exports = { TOGGLEABLE_MENU_KEYS, defaultMenus, isMenuEnabled };
```

- [ ] **Step 2: Write the failing helper test**

Create `frontend/src/lib/__tests__/menuKeys.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TOGGLEABLE_MENU_KEYS, defaultMenus, isMenuEnabled } = require('../menuKeys');

test('defaultMenus enables every toggleable key', () => {
  const menus = defaultMenus();
  for (const key of TOGGLEABLE_MENU_KEYS) assert.equal(menus[key], true);
  assert.equal('apis' in menus, false);
});

test('isMenuEnabled fails open for unknown keys and missing maps', () => {
  assert.equal(isMenuEnabled(undefined, 'docs'), true);
  assert.equal(isMenuEnabled({}, 'docs'), true);
  assert.equal(isMenuEnabled({ docs: false }, 'apis'), true);
});

test('isMenuEnabled respects explicit false', () => {
  assert.equal(isMenuEnabled({ docs: false }, 'docs'), false);
  assert.equal(isMenuEnabled({ docs: true }, 'docs'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `cd frontend && npm test`
Expected: the new `menuKeys` tests pass with the module from Step 1. (If Step 1 had not been written, the require would fail.)

- [ ] **Step 4: Add API types and client**

In `frontend/src/lib/api.ts`, add the menu types and client. Place this right after the `export const authApi = { ... };` block (around line 291):

```ts
export type MenuKey =
  | 'teams'
  | 'automations'
  | 'history'
  | 'docs'
  | 'contracts'
  | 'monitors'
  | 'mock-scenarios'
  | 'copilot'
  | 'collab'
  | 'manage';

export interface MenuAccessResponse {
  menus: Record<MenuKey, boolean>;
  projectId: string | null;
  orgId: string | null;
  keys: MenuKey[];
}

export const menuApi = {
  get: (params: { workspaceId?: string | null; projectId?: string | null } = {}) => {
    const qs = new URLSearchParams();
    if (params.workspaceId) qs.set('workspaceId', params.workspaceId);
    if (params.projectId) qs.set('projectId', params.projectId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<MenuAccessResponse>(`/api/menu-access${suffix}`);
  },
};
```

- [ ] **Step 5: Create the MenuAccess store**

Create `frontend/src/store/MenuAccessStore.tsx`:

```tsx
'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { menuApi, type MenuKey } from '@/lib/api';
import { defaultMenus, isMenuEnabled as isEnabled } from '@/lib/menuKeys';
import { useWorkspace } from '@/store/WorkspaceStore';

interface MenuAccessState {
  menus: Record<string, boolean>;
  loading: boolean;
  isEnabled: (key: MenuKey) => boolean;
  refresh: () => Promise<void>;
}

const MenuAccessContext = createContext<MenuAccessState | null>(null);

export function MenuAccessProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId, activeCollectionId, tree } = useWorkspace();
  const [menus, setMenus] = useState<Record<string, boolean>>(() => defaultMenus());
  const [loading, setLoading] = useState(false);

  // The app has no global "active project"; derive it from the selected
  // collection when one is open so project-scoped overrides apply.
  const projectId = useMemo(() => {
    if (!activeCollectionId || !tree) return null;
    return tree.collections.find((c) => c.id === activeCollectionId)?.project_id ?? null;
  }, [activeCollectionId, tree]);

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const res = await menuApi.get({ workspaceId: activeWorkspaceId, projectId });
      setMenus({ ...defaultMenus(), ...res.menus });
    } catch {
      // Fail open; the backend still enforces.
      setMenus(defaultMenus());
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<MenuAccessState>(
    () => ({
      menus,
      loading,
      isEnabled: (key: MenuKey) => isEnabled(menus, key),
      refresh,
    }),
    [menus, loading, refresh]
  );

  return <MenuAccessContext.Provider value={value}>{children}</MenuAccessContext.Provider>;
}

export function useMenuAccess(): MenuAccessState {
  const ctx = useContext(MenuAccessContext);
  if (!ctx) throw new Error('useMenuAccess must be used inside <MenuAccessProvider>');
  return ctx;
}
```

- [ ] **Step 6: Wrap the app with the provider**

In `frontend/app/layout.tsx`, import the provider and nest it inside `WorkspaceProvider` (it reads workspace state):

```tsx
import { WorkspaceProvider } from '@/store/WorkspaceStore';
import { MenuAccessProvider } from '@/store/MenuAccessStore';
```

```tsx
            <WorkspaceProvider>
              <MenuAccessProvider>
                <NavProvider initialView="workspace">
                  <RouteViewSync />
                  {children}
                </NavProvider>
              </MenuAccessProvider>
            </WorkspaceProvider>
```

- [ ] **Step 7: Hide disabled rail items in the Sidebar**

In `frontend/src/components/Sidebar.tsx`, add the import below the other store imports (after `import { useNav } from '@/store/NavStore';`, line 8):

```tsx
import { useMenuAccess } from '@/store/MenuAccessStore';
```

Inside `Sidebar`, after `const { view, setView } = useNav();` (line 1056) add:

```tsx
  const menu = useMenuAccess();
```

Then wrap each toggleable `<Link>` with `{menu.isEnabled('<key>') && ( ... )}`. The keys are: `automations`, `history`, `docs`, `contracts`, `monitors`, `mock-scenarios`, `copilot`, `collab`, `manage`, `teams`. For example, the Automations link (line 1200) becomes:

```tsx
        {menu.isEnabled('automations') && (
          <Link
            href="/automations"
            className={`rail-button ${view === 'automations' ? 'active' : ''}`}
            data-testid="rail-automations"
            title="Automations"
            aria-label="Automations"
            onClick={() => {
              setView('automations');
              onRequestClose?.();
            }}
          >
            <BoltIcon size={17} />
          </Link>
        )}
```

Apply the same wrapping to: the Teams button (line 1185, key `teams`), History (1213, `history`), Docs (1226, `docs`), Contracts (1239, `contracts`), Monitors (1252, `monitors`), Mock scenarios (1265, `mock-scenarios`), AI copilot (1278, `copilot`), Collaboration (1291, `collab`), and the `canManage` Manage link (1304, `manage`). Leave `rail-apis` and `rail-admin` unwrapped.

- [ ] **Step 8: Add a disabled screen in AppShell**

In `frontend/src/components/AppShell.tsx`, add imports:

```tsx
import { useMenuAccess } from '@/store/MenuAccessStore';
import type { MenuKey } from '@/lib/api';
```

Add a mapping and a small component near the top of the file (after the `dynamic(...)` declarations):

```tsx
const VIEW_MENU_KEY: Partial<Record<string, MenuKey>> = {
  automations: 'automations',
  manage: 'manage',
  history: 'history',
  docs: 'docs',
  contracts: 'contracts',
  monitors: 'monitors',
  'mock-scenarios': 'mock-scenarios',
  copilot: 'copilot',
  collab: 'collab',
};

function FeatureDisabled({ menuKey }: { menuKey: string }) {
  return (
    <div className="auth-screen" data-testid="feature-disabled">
      <div className="auth-card">
        <h1 className="auth-title">Feature unavailable</h1>
        <p>An administrator has disabled the "{menuKey}" feature for this organization.</p>
      </div>
    </div>
  );
}
```

Inside the `AppShell` component, add `const menu = useMenuAccess();` with the other hooks, and change the non-workspace branch (line 169-196) so a disabled view shows the screen instead of the panel:

```tsx
          ) : (() => {
            const menuKey = VIEW_MENU_KEY[view];
            if (menuKey && !menu.isEnabled(menuKey)) return <FeatureDisabled menuKey={menuKey} />;
            return (
              <div className="admin-view">
                {view === 'automations' ? (
                  <AutomationsView />
                ) : view === 'manage' ? (
                  <ManageView />
                ) : view === 'history' ? (
                  <HistoryView />
                ) : view === 'docs' ? (
                  <DocsView />
                ) : view === 'inbox' ? (
                  <InboxView />
                ) : view === 'settings' ? (
                  <ApiTokensView />
                ) : view === 'contracts' ? (
                  <ContractPanel />
                ) : view === 'monitors' ? (
                  <MonitorsPanel />
                ) : view === 'mock-scenarios' ? (
                  <MockScenariosPanel projectId={mockProjectId} />
                ) : view === 'copilot' ? (
                  <CopilotPanel />
                ) : view === 'collab' ? (
                  <CollabView />
                ) : (
                  <AdminView />
                )}
              </div>
            );
          })()}
```

- [ ] **Step 9: Typecheck and unit test**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: `tsc` clean; unit suite passes including `menuKeys`.

- [ ] **Step 10: Commit**

```bash
cd /workspace
git add frontend/src/lib/menuKeys.js frontend/src/lib/__tests__/menuKeys.test.cjs frontend/src/store/MenuAccessStore.tsx frontend/src/lib/api.ts frontend/app/layout.tsx frontend/src/components/Sidebar.tsx frontend/src/components/AppShell.tsx
git commit -m "feat(menus): filter rail and routes from effective menu flags"
```

---

### Task 4: Admin "Menus" tab

**Files:**
- Modify: `frontend/src/lib/api.ts` (admin menu types + methods)
- Modify: `frontend/src/components/views/AdminView.tsx` (new `menus` tab + `MenusTab`)

**Interfaces:**
- Consumes: `adminApi` (existing), `MenuKey` from Task 3.
- Produces: `adminApi.menus()`, `adminApi.setMenu(input)`, `adminApi.deleteMenu(id)`, and an admin UI to manage overrides.

- [ ] **Step 1: Add admin menu types and client methods**

In `frontend/src/lib/api.ts`, extend the `adminApi` object (after `access`, around line 447). Add the types near `AdminAccessOverview`:

```ts
export interface AdminMenuSettingRow {
  id: string;
  menu_key: MenuKey;
  scope: 'org' | 'project';
  enabled: boolean;
  updated_at: string;
  organization_id: string | null;
  organization_name: string | null;
  project_id: string | null;
  project_name: string | null;
  workspace_name: string | null;
}

export interface AdminMenusResponse {
  keys: MenuKey[];
  settings: AdminMenuSettingRow[];
  organizations: Array<{ id: string; name: string; kind: string }>;
  projects: Array<{ id: string; name: string; workspace_name: string }>;
}
```

Add to `adminApi`:

```ts
  menus: () => apiFetch<AdminMenusResponse>('/api/admin/menus'),
  setMenu: (input: {
    menuKey: MenuKey;
    scope: 'org' | 'project';
    organizationId?: string;
    projectId?: string;
    enabled: boolean;
  }) => apiFetch<{ setting: AdminMenuSettingRow }>('/api/admin/menus', { method: 'PUT', body: input }),
  deleteMenu: (id: string) => apiFetch<{ ok: true }>(`/api/admin/menus/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Add the Menus tab to AdminView**

In `frontend/src/components/views/AdminView.tsx`, update the `Tab` union and `TABS` (lines 15-20):

```tsx
type Tab = 'users' | 'access' | 'menus';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'access', label: 'Access' },
  { id: 'menus', label: 'Menus' },
];
```

Update the import from `@/lib/api` to include the new types:

```tsx
import {
  adminApi,
  type AdminUser,
  type UserRole,
  type AdminAccessOverview,
  type AdminAccessProject,
  type AdminAccessWorkspace,
  type AdminMenuSettingRow,
  type AdminMenusResponse,
  type MenuKey,
} from '@/lib/api';
```

Add the tab render below `{tab === 'access' && ( ... )}` (line 153):

```tsx
      {tab === 'menus' && <MenusTab busy={busy} onRun={run} />}
```

- [ ] **Step 3: Implement `MenusTab`**

Append this component to the end of `frontend/src/components/views/AdminView.tsx`:

```tsx
function MenusTab({ busy, onRun }: {
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [data, setData] = useState<AdminMenusResponse | null>(null);
  const [scope, setScope] = useState<'org' | 'project'>('org');
  const [menuKey, setMenuKey] = useState<MenuKey>('docs');
  const [targetId, setTargetId] = useState('');
  const [enabled, setEnabled] = useState(false);

  const load = async () => {
    try {
      setData(await adminApi.menus());
    } catch (err) {
      await onRun(err instanceof Error ? err.message : 'Failed to load menus', () => Promise.reject(new Error('load')));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="hint">Loading menu settings…</p>;

  const targets = scope === 'org' ? data.organizations : data.projects;
  const scopeLabel = (s: AdminMenuSettingRow) =>
    s.scope === 'org' ? s.organization_name : `${s.workspace_name ?? ''} / ${s.project_name ?? ''}`;

  return (
    <div data-testid="admin-menus-section">
      <p className="hint">
        Disable a feature for an entire organization or a single project. A missing override means the
        feature is enabled. Project overrides beat organization overrides.
      </p>

      <div className="admin-access-add" style={{ marginTop: 12 }}>
        <select
          className="compact-select"
          data-testid="menu-key"
          value={menuKey}
          disabled={busy}
          onChange={(e) => setMenuKey(e.target.value as MenuKey)}
        >
          {data.keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          data-testid="menu-scope"
          value={scope}
          disabled={busy}
          onChange={(e) => {
            setScope(e.target.value as 'org' | 'project');
            setTargetId('');
          }}
        >
          <option value="org">Organization</option>
          <option value="project">Project</option>
        </select>
        <select
          className="compact-select"
          data-testid="menu-target"
          value={targetId}
          disabled={busy}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="" disabled>
            Choose a target…
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {scope === 'org' ? t.name : `${(t as { workspace_name?: string }).workspace_name} / ${t.name}`}
            </option>
          ))}
        </select>
        <label className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            data-testid="menu-enabled"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enabled</span>
        </label>
        <button
          type="button"
          className="primary-button small"
          data-testid="menu-save"
          disabled={busy || !targetId}
          onClick={() =>
            onRun(`Menu "${menuKey}" override saved.`, async () => {
              await adminApi.setMenu({
                menuKey,
                scope,
                organizationId: scope === 'org' ? targetId : undefined,
                projectId: scope === 'project' ? targetId : undefined,
                enabled,
              });
              await load();
            })}
        >
          Save override
        </button>
      </div>

      <div className="table-wrap table-stack" style={{ marginTop: 16 }}>
        <table className="admin-table" data-testid="admin-menus-table">
          <thead>
            <tr>
              <th>Menu</th>
              <th>Scope</th>
              <th>Target</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.settings.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No overrides — every feature is enabled.
                </td>
              </tr>
            )}
            {data.settings.map((s) => (
              <tr key={s.id} data-testid={`menu-setting-${s.id}`}>
                <td data-label="Menu">{s.menu_key}</td>
                <td data-label="Scope">{s.scope}</td>
                <td data-label="Target">{scopeLabel(s)}</td>
                <td data-label="State">
                  <span className={`vis-badge ${s.enabled ? 'vis-active' : 'vis-inactive'}`}>
                    {s.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost-button small danger"
                    disabled={busy}
                    data-testid={`menu-remove-${s.id}`}
                    onClick={() =>
                      onRun('Override removed.', async () => {
                        await adminApi.deleteMenu(s.id);
                        await load();
                      })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and unit test**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: `tsc` clean; unit suite passes.

- [ ] **Step 5: Mock-less compile check**

With the frontend dev server running, load `/admin` and confirm the Menus tab renders and saving an override updates the table. (If no dev server is running, start it per the project README; do not run `next build` while it owns `.next`.)

- [ ] **Step 6: Commit**

```bash
cd /workspace
git add frontend/src/lib/api.ts frontend/src/components/views/AdminView.tsx
git commit -m "feat(menus): add admin Menus tab for per-org and per-project overrides"
```

---

### Task 5: Session docs

**Files:**
- Modify: `docs/SESSION.md` (append a new numbered subsection)
- Modify: `session.md` (append a `## Completed` bullet)

- [ ] **Step 1: Update `docs/SESSION.md`**

Append a subsection (use the next free `10.x` number, matching the existing heading style) describing: the `menu_settings` override model (default-on, org vs project, project wins), `GET /api/menu-access`, the `requireMenuEnabled` gate and the exact route prefixes it guards, the non-toggleable `apis`/`admin` menus, and the frontend fail-open behavior.

- [ ] **Step 2: Update `session.md`**

Add a bullet under the current `## Completed` list:

```markdown
- Admin-configurable menus: `menu_settings` overrides (org/project), `GET /api/menu-access`, `requireMenuEnabled` backend gate on feature routers, rail/route filtering, and the admin Menus tab.
```

- [ ] **Step 3: Commit**

```bash
cd /workspace
git add docs/SESSION.md session.md
git commit -m "docs(session): admin-configurable menus"
```

---

## Self-Review

**Spec coverage:**
- Per-menu enable/disable with org or project scope: Task 1 (table + resolver), Task 2 (admin CRUD), Task 4 (UI).
- Hide the rail item entirely: Task 3 Steps 7-8.
- Backend rejects direct API access: Task 1 `requireMenuEnabled`, Task 2 Step 3 wiring, Task 2 integration test.
- `apis`/`admin` intentionally always on: documented in Global Constraints and `menuAccess.js`.

**Placeholder scan:** no `TBD`/`TODO`; every code step shows the full code; every command lists expected output.

**Type consistency:** `MenuKey` (frontend) matches `MENU_KEYS` (backend); `menuDisabledBody` shape `{ error, code, menuKey }` is asserted in both unit and integration tests; `effectiveMenus` returns `{ projectId, orgId, menus }` and is consumed verbatim by the route and the store.
