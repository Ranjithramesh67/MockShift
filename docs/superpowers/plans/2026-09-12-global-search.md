# Global Search + Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a Cmd/Ctrl-K command palette that fuzzy-searches requests, collections, folders, docs, contracts, monitors and mock scenarios, respecting the caller's read access, and navigates to the result.

**Architecture:** Add a single authenticated `GET /api/search` endpoint that runs scoped `ILIKE` queries (backed by `pg_trgm` GIN indexes), filters each result through the existing read-access helpers and menu gates, and returns grouped results with a rank. Mount a palette in the Next shell (`AppShell`) triggered by Cmd/Ctrl-K and a TopBar button, navigating via the existing `WorkspaceStore`/`router` patterns.

**Tech Stack:** Express + PostgreSQL (`pg_trgm`), Next.js 14, Node `node:test`.

## Global Constraints

- Backend raw SQL via `require('../db')`; no ORM.
- Migrations append-only; this plan uses `043` (does not conflict with the access-request plan's `042`).
- Reuse `canReadProject` / `canReadWorkspace` (`backend/src/api/access.js`) and `canReadPage` (`backend/src/api/routes/docs.js`) for scoping; do not re-derive permissions.
- Search must respect configurable menus via `effectiveMenus` (`backend/src/api/menuAccess.js`).
- Frontend calls via `apiFetch`/`ApiError`; unit-testable helpers must be CommonJS `.js` under `frontend/src/lib/`.
- Testids kebab-case; commit style Conventional Commits; never stage `docs/superpowers/`.

---

## File Structure

- Create `db/migrations/043_search_indexes.sql`.
- Create `backend/src/api/search.js` - pure helpers (query parsing/escaping, ranking, grouping, menu-key map).
- Create `backend/src/api/routes/search.js` - the endpoint.
- Modify `backend/src/api/routes/docs.js` - export `canReadPage`.
- Modify `backend/src/api/server.js` - mount `/api/search`.
- Create `backend/src/api/__tests__/search.test.cjs`.
- Create `backend/tests/search.integration.test.cjs`.
- Modify `frontend/src/lib/api.ts` - `searchApi`.
- Create `frontend/src/lib/searchPalette.js` + `frontend/src/lib/__tests__/searchPalette.test.cjs`.
- Create `frontend/src/components/CommandPalette.tsx`.
- Create `frontend/src/components/useGlobalSearchShortcut.ts`.
- Modify `frontend/src/components/AppShell.tsx`, `frontend/src/components/TopBar.tsx`, `frontend/src/components/icons.tsx`, `frontend/app/globals.css`.
- Modify `docs/FEATURES.md`, `session_v2.md`.

---

## Task 1: Search indexes migration

**Files:**
- Create: `db/migrations/043_search_indexes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Trigram indexes for global search (ILIKE '%q%' on name/title columns).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS workspaces_name_trgm      ON workspaces    USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_name_trgm        ON projects      USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS collections_name_trgm     ON collections   USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS folders_name_trgm         ON folders       USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS api_requests_name_trgm    ON api_requests  USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS api_requests_url_trgm     ON api_requests  USING gin (url   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS doc_pages_title_trgm      ON doc_pages     USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contract_specs_name_trgm  ON contract_specs USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS monitors_name_trgm        ON monitors      USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS mock_scenarios_name_trgm  ON mock_scenarios USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS workflow_chains_name_trgm ON workflow_chains USING gin (name gin_trgm_ops);
```

- [ ] **Step 2: Apply to the dev database**

Run: `cd /workspace && set -a && . /tmp/pgenv && set +a && psql -h 127.0.0.1 -U postgres -d apihub -f db/migrations/043_search_indexes.sql`
Expected: `CREATE EXTENSION`, then `CREATE INDEX` per index, no error.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/043_search_indexes.sql
git commit -m "feat(db): add trigram indexes for global search"
```

---

## Task 2: Pure search helpers

**Files:**
- Create: `backend/src/api/search.js`
- Test: `backend/src/api/__tests__/search.test.cjs`

**Interfaces:**
- Produces: `escapeLike(text)` -> string
- Produces: `normalizeQuery(raw)` -> `{ q, limit, ok }`
- Produces: `rankResult(result, q)` -> number (lower is better)
- Produces: `menuKeyForType(type)` -> `'docs'|'contracts'|'monitors'|'mock-scenarios'|'apis'`
- Produces: `flattenGroups(groups)` -> sorted array with `type` attached

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups } = require('../search');

test('escapeLike escapes % _ and backslash', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('normalizeQuery trims, caps limit and rejects blanks', () => {
  assert.equal(normalizeQuery('  api  ').ok, true);
  assert.equal(normalizeQuery('  api  ').q, 'api');
  assert.equal(normalizeQuery('x', 9999).limit, 50);
  assert.equal(normalizeQuery('   ').ok, false);
});

test('rankResult prefers prefix then substring', () => {
  assert.ok(rankResult({ name: 'Users' }, 'use') < rankResult({ name: 'List users' }, 'use'));
});

test('menuKeyForType maps feature menus', () => {
  assert.equal(menuKeyForType('doc'), 'docs');
  assert.equal(menuKeyForType('contract'), 'contracts');
  assert.equal(menuKeyForType('monitor'), 'monitors');
  assert.equal(menuKeyForType('mockScenario'), 'mock-scenarios');
  assert.equal(menuKeyForType('request'), 'apis');
});

test('flattenGroups attaches type and sorts by rank then name', () => {
  const flat = flattenGroups({ request: [{ id: '1', name: 'zebra', rank: 9 }, { id: '2', name: 'Apple api', rank: 1 }] });
  assert.deepEqual(flat.map((r) => r.id), ['2', '1']);
  assert.equal(flat[0].type, 'request');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test src/api/__tests__/search.test.cjs`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

const TYPE_MENU = {
  workspace: 'apis',
  project: 'apis',
  collection: 'apis',
  folder: 'apis',
  request: 'apis',
  workflow: 'apis',
  doc: 'docs',
  contract: 'contracts',
  monitor: 'monitors',
  mockScenario: 'mock-scenarios',
};

function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function normalizeQuery(raw, limit) {
  const q = String(raw == null ? '' : raw).trim();
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 20;
  return { q, limit: capped, ok: q.length > 0 };
}

function rankResult(result, q) {
  const needle = String(q).toLowerCase();
  const name = String((result && (result.name || result.title)) || '').toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  const idx = name.indexOf(needle);
  if (idx >= 0) return 10 + idx;
  return 1000;
}

function menuKeyForType(type) {
  return TYPE_MENU[type] || 'apis';
}

function flattenGroups(groups) {
  const out = [];
  for (const [type, rows] of Object.entries(groups || {})) {
    for (const row of rows || []) out.push({ ...row, type });
  }
  out.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(a.name || a.title).localeCompare(String(b.name || b.title)));
  return out;
}

module.exports = { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test src/api/__tests__/search.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/search.js backend/src/api/__tests__/search.test.cjs
git commit -m "feat(search): add pure search helpers"
```

---

## Task 3: Export `canReadPage`

**Files:**
- Modify: `backend/src/api/routes/docs.js` (end of file, near `module.exports`)

- [ ] **Step 1: Implement**

At the bottom of `docs.js`, next to `module.exports.publicRouter = publicDocRouter;`, add:

```js
// Reused by the global search endpoint to scope doc-page results.
module.exports.canReadPage = canReadPage;
```

- [ ] **Step 2: Sanity check**

Run: `cd backend && node -e "const d=require('./src/api/routes/docs'); console.log(typeof d.canReadPage)"`
Expected: `function` (it prints `function`, even though requiring pulls in `../db`; no query runs at require time).

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/routes/docs.js
git commit -m "chore(docs): export canReadPage for search scoping"
```

---

## Task 4: Search endpoint

**Files:**
- Create: `backend/src/api/routes/search.js`
- Test: `backend/tests/search.integration.test.cjs`

**Interfaces:**
- Consumes: `normalizeQuery`, `escapeLike`, `rankResult`, `menuKeyForType` (Task 2); `canReadProject`, `canReadWorkspace` (`access.js`); `canReadPage` (Task 3); `effectiveMenus` (`menuAccess.js`).
- Produces: `GET /api/search?q=&limit=` -> `{ query, groups, results }` where `results` is the flattened ranked list.

- [ ] **Step 1: Write the failing integration test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Reuse the harness from accessRequests.integration.test.cjs (createApp/signupAndLogin/api).

test('search returns only entities the caller can read', async (t) => {
  // user A creates workspace "Searchable WS" + project "Alpha API" + request "Get user"
  // user B (unrelated org) creates "Secret WS"
  // GET /api/search?q=search as A -> includes Searchable WS, excludes Secret WS
  // GET /api/search?q=secret as A -> empty
});

test('search omits results for disabled menus', async (t) => {
  // create a monitor named "Latency probe"
  // admin PUT /api/menu-access? disable 'monitors' for org
  // GET /api/search?q=latency -> no monitor results
});

test('search rejects blank queries with 400', async (t) => {
  // GET /api/search?q= -> 400
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/search.integration.test.cjs`
Expected: FAIL - 404.

- [ ] **Step 3: Implement the route**

```js
'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, canReadProject, canReadWorkspace } = require('../access');
const { effectiveMenus } = require('../menuAccess');
const { escapeLike, normalizeQuery, rankResult, menuKeyForType, flattenGroups } = require('../search');
// Lazy-require docs to avoid a require cycle through the huge router module.
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
      `SELECT f.id, f.name, p.id AS project_id, p.workspace_id
         FROM folders f JOIN collections c ON c.id = f.collection_id JOIN projects p ON p.id = c.project_id
        WHERE f.name ILIKE $1 ESCAPE '\\' ORDER BY f.name LIMIT $2`,
      [],
      (r) => ({ id: r.id, name: r.name, projectId: r.project_id, workspaceId: r.workspace_id })
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
```

Note: the workspace query's `collect` matcher receives no `project_id`; `makeMatcher` reads `row.project_id` (null) and `row.id` for `canReadWorkspace`. Each SQL aliases `project_id`/`workspace_id` consistently for the matcher.

- [ ] **Step 4: Mount in `server.js`**

After `const menuAccessRoutes = require('./routes/menuAccess');` add `const searchRoutes = require('./routes/search');`, and after `app.use('/api', projectRoutes);` (`:101`) add:

```js
app.use('/api/search', searchRoutes);
```

- [ ] **Step 5: Run tests**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/search.integration.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/search.js backend/src/api/server.js backend/tests/search.integration.test.cjs
git commit -m "feat(search): add scoped global search endpoint"
```

---

## Task 5: Frontend API + pure palette helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/searchPalette.js`
- Create: `frontend/src/lib/__tests__/searchPalette.test.cjs`

**Interfaces:**
- Produces: `SearchResult = { id, name, type, rank, projectId?, workspaceId?, method?, url?, subtitle? }`
- Produces: `SearchResponse = { query, groups, results }`
- Produces: `searchApi.query(q)`.
- Produces: `flattenResults(results)`, `groupLabel(type)`, `takeTop(results, n)`.

- [ ] **Step 1: Write the failing unit test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupLabel, takeTop } = require('../searchPalette.js');

test('groupLabel maps types to human labels', () => {
  assert.equal(groupLabel('request'), 'Requests');
  assert.equal(groupLabel('mockScenario'), 'Mock scenarios');
  assert.equal(groupLabel('unknown'), 'Other');
});

test('takeTop limits and preserves order', () => {
  assert.deepEqual(takeTop([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(takeTop(null, 2), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/searchPalette.test.cjs`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement helpers**

```js
'use strict';

const LABELS = {
  workspace: 'Workspaces',
  project: 'Projects',
  collection: 'Collections',
  folder: 'Folders',
  request: 'Requests',
  doc: 'Docs',
  contract: 'Contracts',
  monitor: 'Monitors',
  mockScenario: 'Mock scenarios',
  workflow: 'Workflows',
};

function groupLabel(type) {
  return LABELS[type] || 'Other';
}

function takeTop(rows, n) {
  return (rows || []).slice(0, n);
}

function flattenResults(results) {
  return (results || []).slice();
}

module.exports = { groupLabel, takeTop, flattenResults };
```

- [ ] **Step 4: Add `searchApi` in `api.ts`**

```ts
export interface SearchResult {
  id: string;
  name: string;
  type: string;
  rank: number;
  projectId?: string | null;
  workspaceId?: string | null;
  method?: string | null;
  url?: string | null;
  subtitle?: string | null;
}

export const searchApi = {
  query: (q: string, limit = 20) =>
    apiFetch<{ query: string; groups: Record<string, SearchResult[]>; results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && node --test src/lib/__tests__/searchPalette.test.cjs && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/searchPalette.js frontend/src/lib/__tests__/searchPalette.test.cjs
git commit -m "feat(search): frontend search api and palette helpers"
```

---

## Task 6: Command palette + shortcut + TopBar trigger

**Files:**
- Create: `frontend/src/components/CommandPalette.tsx`
- Create: `frontend/src/components/useGlobalSearchShortcut.ts`
- Modify: `frontend/src/components/AppShell.tsx:128-241`
- Modify: `frontend/src/components/TopBar.tsx:128-334`
- Modify: `frontend/src/components/icons.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `searchApi`, `groupLabel`, `takeTop`; `useWorkspace` (`selectWorkspace`, `selectRequest`, `selectCollection`); `useNav().setView`; `next/navigation` `useRouter`.

- [ ] **Step 1: Shortcut hook** (mirror `useCloseRequestTabShortcut.ts:16-43`)

```ts
import { useEffect } from 'react';
import { isEditableTarget } from './useRequestHistoryShortcuts';

export function useGlobalSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onOpen]);
}
```

(If `isEditableTarget` is not exported, export it from `useRequestHistoryShortcuts.ts`.)

- [ ] **Step 2: Palette component**

`CommandPalette({ open, onClose })`: input `data-testid="command-palette-input"` autofocused; 200 ms debounce calling `searchApi.query`; render grouped results using `groupLabel`; keyboard Up/Down/Enter/Escape; clicking navigates and closes. Navigation per type:

```ts
const ws = useWorkspace();
const nav = useNav();
const router = useRouter();

async function openResult(r: SearchResult) {
  onClose();
  if (r.type === 'doc') { router.push(`/docs?p=${encodeURIComponent(r.id)}`); return; }
  if (r.type === 'workspace') { router.push('/'); nav.setView('workspace'); await ws.selectWorkspace(r.id); return; }
  if (r.type === 'project') { router.push('/'); nav.setView('workspace'); await ws.selectWorkspace(r.workspaceId!); await ws.selectProjectOverview({ id: r.id, name: r.name }); return; }
  if (r.type === 'collection') { router.push('/'); nav.setView('workspace'); await ws.selectWorkspace(r.workspaceId!); await ws.selectCollection(r.id, r.name); return; }
  if (r.type === 'request') { router.push('/'); nav.setView('workspace'); await ws.selectWorkspace(r.workspaceId!); await ws.selectRequest(r.id); return; }
  const route: Record<string, string> = { monitor: '/monitors', contract: '/contracts', mockScenario: '/mock-scenarios' };
  if (route[r.type]) router.push(route[r.type]);
}
```

Add testids: `command-palette`, `command-palette-input`, `command-palette-empty`, `command-result-${type}-${id}`, `command-palette-close`.

- [ ] **Step 3: Mount in `AppShell`**

Add `const [searchOpen, setSearchOpen] = useState(false);` near `:134`; call `useGlobalSearchShortcut(() => setSearchOpen(true))`; pass `onOpenSearch={() => setSearchOpen(true)}` to `<TopBar>`; render `<CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />` next to `<CurlModal>`/`<ToastHost>`.

- [ ] **Step 4: TopBar trigger**

Extend `TopBarProps` with `onOpenSearch`; render a `ghost-button` with `data-testid="global-search-button"` before the views menu showing a search icon + the hint `Ctrl K` / `Cmd K`. Add a `SearchIcon` to `icons.tsx` following the existing icon component pattern.

- [ ] **Step 5: Styles**

Add `.command-palette-backdrop`, `.command-palette`, `.command-palette-input`, `.command-palette-group`, `.command-result`, `.command-result-active` to `globals.css`.

- [ ] **Step 6: Typecheck + unit tests**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CommandPalette.tsx frontend/src/components/useGlobalSearchShortcut.ts frontend/src/components/AppShell.tsx frontend/src/components/TopBar.tsx frontend/src/components/icons.tsx frontend/app/globals.css
git commit -m "feat(search): add Cmd/Ctrl-K command palette"
```

---

## Task 7: Docs + session log

**Files:**
- Modify: `docs/FEATURES.md` (add a Global search section)
- Modify: `session_v2.md`

- [ ] **Step 1: Update `docs/FEATURES.md`**
Add "Global search" describing `GET /api/search`, scoping, menu gating, and the Cmd/Ctrl-K palette. Remove "global search" from the Known gaps list if present.

- [ ] **Step 2: Append to `session_v2.md`** a "Global search + command palette" completed bullet + details.

- [ ] **Step 3: Commit + push**

```bash
git add docs/FEATURES.md session_v2.md
git commit -m "docs: record global search and command palette"
git push origin master
```

---

## Self-Review

- Spec coverage: endpoint (T4), indexes (T1), access scoping (T4 via `canReadPage`/`canReadProject`/`canReadWorkspace`), menu gating (T4), palette + shortcut (T6), navigation (T6), tests (T2/T4/T5), docs (T7). Covered.
- Placeholder scan: no TBDs; navigation map and testids are explicit.
- Type consistency: `SearchResult` fields (`id,name,type,rank,projectId,workspaceId,method,url,subtitle`) match backend `collect` mappers; `flattenGroups`/`groupLabel` names consistent across tasks.
- Known v1 limitation: doc results use `canReadPage`, which covers workspace, public-in-org, and share grants; no separate search-over-block-content (title only) in v1.
