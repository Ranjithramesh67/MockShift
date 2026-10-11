# apihub-sdk + Route Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a publishable `apihub-sdk` JavaScript library (Express first) that reads the routes an app defines and idempotently syncs them into a linked MockShift workspace/project as collections, nested folders and requests, using a project- or workspace-bound API key.

**Architecture:** A zero-runtime-dependency SDK records routes via an Express adapter, turns them into a JSON *manifest* (folders + requests + assertions) using an easily configurable folder/structure mapping, and POSTs that manifest to a new token-authenticated backend endpoint `POST /api/sdk/sync`. The backend resolves the target project/collection, upserts folders and requests by a stable `external_key` (so re-syncs update instead of duplicating), and records a sync run. Existing personal API tokens gain an optional `project_id`/`workspace_id` binding and an `sdk` scope, managed from the existing API-tokens UI.

**Tech Stack:** Node.js >= 18 (CommonJS), Express 5, PostgreSQL 15 (raw SQL via `pg`), Next.js 14 + React 18 (TypeScript, strict), `node --test` for unit/integration tests, Playwright for e2e. The SDK has **zero runtime dependencies** (global `fetch`), with `express` as an optional peer dependency.

## Global Constraints

- Node.js `>=18.0.0`; backend and SDK are CommonJS (`'use strict';`, `require`). Frontend is TypeScript with `strict: true` and `@/* → ./src/*`.
- Backend database access uses `const { query, pool } = require('../db')` — raw SQL only, no ORM. Prisma at `/workspace/prisma` is NOT used at runtime.
- Migrations are append-only files `db/migrations/NNN_name.sql`; the next number is **037**. Never edit or renumber existing migrations.
- Hierarchy is `organization → workspace → project → collection → folder (self-nesting parent_id) → api_requests`. Sibling name uniqueness is case-insensitive and auto-suffixed ` (copy)`, ` (copy) 2`, … (see `backend/src/api/routes/content.js:24`).
- Auth: browser session cookie OR `Authorization: Bearer <token>`. Tokens are `api_tokens` rows; only a SHA-256 digest is stored (`backend/src/api/tokenAuth.js`). Existing scopes are `read|write|runs`.
- New machine endpoints must use `tokenAuth` (`backend/src/api/tokenAuth.js:81`) and reject missing/insufficient scopes with 403.
- Count entitlements: gate NEW collections with `checkCountGate({ key: 'collections' })` and NEW requests with `checkCountGate({ key: 'api_requests', extra })` (`backend/src/api/entitlements.js`), mirroring `backend/src/api/routes/contracts.js:175-199`.
- Tests:
  - Backend integration: `node --test backend/tests/*.integration.test.cjs` (via `npm run test:api` in `backend/`); DB overridable through `INTEGRATION_PGDATABASE` / `INTEGRATION_PGPORT` (defaults `apihub` / `5432`, user `postgres`/`postgres`).
  - Backend unit: `node --test "backend/src/api/__tests__/*.test.cjs"` (`npm run test:api:unit`).
  - SDK/CLI: `node --test "sdk/test/*.test.js"`.
  - Frontend: `npm test` (`node --test src/lib/__tests__/*.test.cjs`), `npx tsc --noEmit`, Playwright `e2e/*.spec.ts`.
- NEVER run the integration suite against the shared dev `apihub` DB: run it with a separate scratch DB, e.g. `INTEGRATION_PGDATABASE=apihub_sdk_test`. The dev DB on port 5432 must not be dropped.
- Do not run `next build` while the frontend dev server is using `.next` (it corrupts the running server). Never commit `frontend/tsconfig.tsbuildinfo`.
- Commit style: Conventional Commits `feat(scope): …` / `fix(scope): …` / `docs(session): …`, with trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. Push to `master`.
- `apihub-sdk` must declare `"private": false`, a `files` allow-list, `engines.node >=18`, `exports`, `license`, and no runtime dependencies. It is verified with `npm pack --dry-run` / `npm publish --dry-run`; the real publish is run by the human owner with their npm token.

---

## File Structure

**Backend (new)**
- `db/migrations/037_sdk_sync.sql` — token binding columns + `sdk` scope, external-key columns, `sdk_sync_runs`.
- `backend/src/api/sdkManifest.js` — pure, DB-free helpers: manifest validation, folder nesting plan, URL joining, name uniquing.
- `backend/src/api/__tests__/sdkManifest.test.cjs` — unit tests for the above.
- `backend/src/api/routes/sdk.js` — `POST /api/sdk/sync`.

**Backend (modified)**
- `backend/src/api/routes/tokens.js` — accept/store/return `projectId`/`workspaceId` + `sdk` scope.
- `backend/src/api/server.js` — mount `app.use('/api/sdk', sdkRoutes);`.

**Backend tests (new)**
- `backend/tests/sdkSync.integration.test.cjs`.

**Frontend (modified)**
- `frontend/src/lib/tokens.ts` — `sdk` scope, binding fields on `ApiToken`/create input.
- `frontend/src/components/ApiTokensView.tsx` — binding selector + binding display.
- `frontend/app/settings/api-tokens/api-tokens.css` — small styles for the binding row.

**SDK package (new, `/workspace/sdk`)**
- `sdk/package.json`, `sdk/README.md`, `sdk/LICENSE`
- `sdk/src/index.js` — `attach`, `createHub`, public exports.
- `sdk/src/config.js` — resolve options + env.
- `sdk/src/errors.js` — `ApiHubError` / `ApiHubConfigError`.
- `sdk/src/assertions.js` — `normalizeExpects`.
- `sdk/src/folders.js` — folder-path resolution + nesting plan.
- `sdk/src/manifest.js` — `buildManifest`.
- `sdk/src/client.js` — `createClient` (fetch → `/api/sdk/sync`).
- `sdk/src/adapters/express.js` — `createExpressAdapter`.
- `sdk/src/cli.js` + `sdk/bin/apihub-sdk.js` — `apihub-sdk sync`.
- `sdk/test/*.test.js` — `config`, `assertions`, `folders`, `manifest`, `client`, `express`, `cli`.

**Docs**
- `docs/SESSION.md` §5 entry + `session.md` current/roadmap — recorded in the final task.

---

## Task 1: Migration 037 — SDK sync schema

**Files:**
- Create: `db/migrations/037_sdk_sync.sql`

**Interfaces:**
- Consumes: existing tables `api_tokens`, `api_requests`, `folders`, `collections`, `projects`, `workspaces`, `users`.
- Produces: `api_tokens.project_id`, `api_tokens.workspace_id`, scope value `sdk`; `api_requests.external_key/source/source_file/synced_at`; `folders.external_key/source`; `collections.source`; table `sdk_sync_runs`.

- [ ] **Step 1: Write the migration**

Create `db/migrations/037_sdk_sync.sql`:

```sql
-- ============================================================================
-- API Hub — 037_sdk_sync.sql
-- Route sync for the apihub-sdk JS library (round 5).
--
--   api_tokens.project_id / workspace_id  optional binding: a key scoped to a
--                                         single project OR workspace (not both)
--   scope 'sdk'                           allows POST /api/sdk/sync
--   api_requests.external_key             stable SDK identity -> idempotent upsert
--   folders.external_key                  stable SDK identity -> idempotent upsert
--   sdk_sync_runs                         one audit row per sync call
--
-- Idempotency: the SDK sends a stable `key` per folder/request (e.g.
-- "GET /users/:id"). The route upserts on (collection_id, external_key) so
-- repeated syncs update the same rows instead of duplicating them.
-- ============================================================================

-- ------------------------------------------------------ token binding + scope
ALTER TABLE api_tokens
  ADD COLUMN project_id   uuid REFERENCES projects(id)   ON DELETE CASCADE,
  ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE api_tokens DROP CONSTRAINT IF EXISTS api_tokens_scopes_check;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_scopes_check
  CHECK (scopes <@ ARRAY['read', 'write', 'runs', 'sdk']::text[]);

ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_binding_check
  CHECK (NOT (project_id IS NOT NULL AND workspace_id IS NOT NULL));

CREATE INDEX api_tokens_project_idx   ON api_tokens (project_id)   WHERE project_id IS NOT NULL;
CREATE INDEX api_tokens_workspace_idx ON api_tokens (workspace_id) WHERE workspace_id IS NOT NULL;

COMMENT ON COLUMN api_tokens.project_id   IS 'When set, this key may only sync/create content inside this project.';
COMMENT ON COLUMN api_tokens.workspace_id IS 'When set, this key may create/find a project by name inside this workspace and sync into it.';

-- --------------------------------------------------- idempotent external keys
ALTER TABLE api_requests
  ADD COLUMN external_key text,
  ADD COLUMN source       text,
  ADD COLUMN source_file  text,
  ADD COLUMN synced_at    timestamptz;

CREATE UNIQUE INDEX api_requests_external_key_uidx
  ON api_requests (collection_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE folders
  ADD COLUMN external_key text,
  ADD COLUMN source       text;

CREATE UNIQUE INDEX folders_external_key_uidx
  ON folders (collection_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE collections
  ADD COLUMN source text;

-- ------------------------------------------------------------- sync run log
CREATE TABLE sdk_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id      uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  collection_id uuid REFERENCES collections(id)         ON DELETE SET NULL,
  source        text,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sdk_sync_runs_project_idx ON sdk_sync_runs (project_id, created_at DESC);

COMMENT ON TABLE sdk_sync_runs IS
  'One row per apihub-sdk sync call; summary holds { folders:{created,updated}, requests:{created,updated,pruned} }.';

-- ------------------------------------------------------------------ Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON sdk_sync_runs TO app_user;

-- ------------------------------------------------------------- RLS policies
ALTER TABLE sdk_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdk_sync_runs_select ON sdk_sync_runs FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY sdk_sync_runs_insert ON sdk_sync_runs FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
```

- [ ] **Step 2: Apply the migration to a scratch DB and verify columns**

Run:

```bash
createdb -h 127.0.0.1 -U postgres apihub_sdk_test 2>/dev/null || true
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d apihub_sdk_test -v ON_ERROR_STOP=1 -f db/migrations/037_sdk_sync.sql
```

Expected: `ALTER TABLE` × several, `CREATE INDEX`, `CREATE TABLE`, `CREATE POLICY`. No errors. (Full-schema apply is exercised by the integration suite in Task 3.)

- [ ] **Step 3: Verify the scope CHECK rejects bad values**

Run:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d apihub_sdk_test -c \
"INSERT INTO api_tokens (user_id, name, prefix, token_hash, scopes) VALUES (gen_random_uuid(),'x','p','h', ARRAY['bogus']);"
```

Expected: error `violates check constraint "api_tokens_scopes_check"`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/037_sdk_sync.sql
git commit -m "feat(db): SDK sync schema, bound tokens and external keys (round 5)"
```

---

## Task 2: Pure manifest helpers (`sdkManifest.js`)

**Files:**
- Create: `backend/src/api/sdkManifest.js`
- Test: `backend/src/api/__tests__/sdkManifest.test.cjs`

**Interfaces:**
- Produces:
  - `normalizeKey(method, path) -> string` (e.g. `normalizeKey('get','/users/:id') === 'GET /users/:id'`)
  - `normalizeManifest(body) -> { source, project, workspace, collection, targetBaseUrl, prune, folders: Array, requests: Array }` (throws `Error` on invalid shape)
  - `nestFolders(folders) -> Array<{ key, name, parent, depth }>` ordered parents-first
  - `joinUrl(base, path) -> string`
  - `pickUniqueName(desired, usedNames) -> string`

- [ ] **Step 1: Write the failing unit test**

Create `backend/src/api/__tests__/sdkManifest.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKey,
  normalizeManifest,
  nestFolders,
  joinUrl,
  pickUniqueName,
} = require('../sdkManifest');

test('normalizeKey upper-cases the method and trims the path', () => {
  assert.equal(normalizeKey('get', '/users/:id'), 'GET /users/:id');
  assert.equal(normalizeKey('POST', 'users'), 'POST /users');
});

test('nestFolders orders parents before children and assigns depth', () => {
  const out = nestFolders([
    { key: 'Users/Admin', name: 'Admin', parent: 'Users' },
    { key: 'Users', name: 'Users', parent: null },
  ]);
  assert.deepEqual(out.map((f) => f.key), ['Users', 'Users/Admin']);
  assert.equal(out[0].depth, 0);
  assert.equal(out[1].depth, 1);
  assert.equal(out[1].parent, 'Users');
});

test('nestFolders rejects an unknown parent key', () => {
  assert.throws(
    () => nestFolders([{ key: 'a', name: 'A', parent: 'missing' }]),
    /unknown parent/
  );
});

test('nestFolders rejects cycles', () => {
  assert.throws(
    () => nestFolders([
      { key: 'a', name: 'A', parent: 'b' },
      { key: 'b', name: 'B', parent: 'a' },
    ]),
    /cycle/
  );
});

test('joinUrl avoids duplicate slashes', () => {
  assert.equal(joinUrl('http://x/', '/users'), 'http://x/users');
  assert.equal(joinUrl('http://x', 'users'), 'http://x/users');
  assert.equal(joinUrl('', '/users'), '/users');
});

test('pickUniqueName suffixes collisions case-insensitively', () => {
  assert.equal(pickUniqueName('Users', []), 'Users');
  assert.equal(pickUniqueName('users', ['Users']), 'users (copy)');
  assert.equal(pickUniqueName('Users', ['Users', 'Users (copy)']), 'Users (copy) 2');
});

test('normalizeManifest validates the shape and defaults', () => {
  const m = normalizeManifest({
    source: 'express',
    requests: [{ method: 'get', path: '/health' }],
  });
  assert.equal(m.source, 'express');
  assert.equal(m.prune, false);
  assert.deepEqual(m.folders, []);
  assert.equal(m.requests[0].method, 'GET');
  assert.equal(m.requests[0].key, 'GET /health');
  assert.equal(m.requests[0].name, 'GET /health');
  assert.equal(m.requests[0].url, '/health');
});

test('normalizeManifest rejects non-array folders/requests', () => {
  assert.throws(() => normalizeManifest({ requests: 'nope' }), /requests must be an array/);
});

test('normalizeManifest rejects a request without method or path', () => {
  assert.throws(() => normalizeManifest({ requests: [{ method: 'GET' }] }), /requires method and path/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test src/api/__tests__/sdkManifest.test.cjs`
Expected: FAIL — `Cannot find module '../sdkManifest'`.

- [ ] **Step 3: Implement `sdkManifest.js`**

Create `backend/src/api/sdkManifest.js`:

```js
'use strict';

// Pure helpers for POST /api/sdk/sync. No DB, no network — unit-testable.

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function normalizeKey(method, path) {
  const m = String(method || '').trim().toUpperCase();
  let p = String(path || '').trim();
  if (p && !p.startsWith('/')) p = `/${p}`;
  return `${m} ${p}`.trim();
}

function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  const withSlash = p.startsWith('/') ? p : `/${p}`;
  return `${b}${withSlash}`;
}

function pickUniqueName(desired, usedNames) {
  const base = String(desired || '').trim() || 'Untitled';
  const taken = new Set(usedNames.map((n) => String(n).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const copy = `${base} (copy)`;
  if (!taken.has(copy.toLowerCase())) return copy;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${copy} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${copy} ${Date.now()}`;
}

// Order folders parents-first (stable), assign depth, and validate parent
// references + cycles.
function nestFolders(folders) {
  const list = (folders || []).map((f) => ({
    key: String(f.key || '').trim(),
    name: String(f.name || f.key || '').trim(),
    parent: f.parent ? String(f.parent).trim() : null,
  }));
  const byKey = new Map(list.map((f) => [f.key, f]));
  for (const f of list) {
    if (!f.key) throw new Error('folder key is required');
    if (f.parent && !byKey.has(f.parent)) {
      throw new Error(`folder "${f.key}" references unknown parent "${f.parent}"`);
    }
  }
  const out = [];
  const state = new Map(); // key -> 'visiting' | 'done'
  const visit = (folder, depth, stack) => {
    if (state.get(folder.key) === 'done') return;
    if (state.get(folder.key) === 'visiting') {
      throw new Error(`folder cycle detected at "${folder.key}" (${stack.join(' -> ')})`);
    }
    state.set(folder.key, 'visiting');
    if (folder.parent) visit(byKey.get(folder.parent), depth - 1, [...stack, folder.key]);
    out.push({ ...folder, depth });
    state.set(folder.key, 'done');
  };
  for (const f of list) visit(f, 0, [f.key]);
  // Recompute real depth from resolved parent chain (visit pushed bottom-up).
  const depthOf = (key) => {
    let d = 0;
    let cur = byKey.get(key);
    const seen = new Set();
    while (cur && cur.parent && !seen.has(cur.key)) {
      seen.add(cur.key);
      d += 1;
      cur = byKey.get(cur.parent);
    }
    return d;
  };
  out.sort((a, b) => depthOf(a.key) - depthOf(b.key));
  return out.map((f) => ({
    key: f.key,
    name: f.name,
    parent: f.parent,
    depth: depthOf(f.key),
  }));
}

function normalizeRequest(raw, baseUrl, defaultSource) {
  if (!raw || typeof raw !== 'object') throw new Error('each request must be an object');
  const method = String(raw.method || '').trim().toUpperCase();
  const path = String(raw.path || '').trim();
  if (!method || !path) throw new Error(`request "${raw.key || '(unknown)'}" requires method and path`);
  if (!HTTP_METHODS.has(method)) throw new Error(`request "${path}" has invalid method "${method}"`);
  const key = raw.key ? String(raw.key).trim() : normalizeKey(method, path);
  return {
    key,
    name: String(raw.name || key).trim(),
    method,
    path,
    url: raw.url ? String(raw.url).trim() : joinUrl(baseUrl, path),
    apiType: raw.apiType || 'REST',
    folder: raw.folder ? String(raw.folder).trim() : null,
    headers: Array.isArray(raw.headers) ? raw.headers : [],
    queryParams: Array.isArray(raw.queryParams) ? raw.queryParams : [],
    bodyType: raw.bodyType || 'NONE',
    bodyJson: raw.bodyJson === undefined ? null : raw.bodyJson,
    bodyText: raw.bodyText === undefined ? null : raw.bodyText,
    assertions: Array.isArray(raw.assertions) ? raw.assertions : [],
    sourceFile: raw.sourceFile ? String(raw.sourceFile) : null,
    source: raw.source || defaultSource || null,
  };
}

function normalizeManifest(body) {
  const input = body || {};
  if (input.folders !== undefined && !Array.isArray(input.folders)) {
    throw new Error('folders must be an array');
  }
  if (input.requests !== undefined && !Array.isArray(input.requests)) {
    throw new Error('requests must be an array');
  }
  const source = input.source ? String(input.source).trim() : 'sdk';
  const targetBaseUrl = input.targetBaseUrl ? String(input.targetBaseUrl).trim() : '';
  const requests = (input.requests || []).map((r) => normalizeRequest(r, targetBaseUrl, source));
  const folders = nestFolders(input.folders || []);
  return {
    source,
    project: input.project ? String(input.project).trim() : null,
    workspace: input.workspace ? String(input.workspace).trim() : null,
    collection: input.collection ? String(input.collection).trim() : null,
    projectId: input.projectId || null,
    workspaceId: input.workspaceId || null,
    targetBaseUrl,
    prune: Boolean(input.prune),
    folders,
    requests,
  };
}

module.exports = {
  HTTP_METHODS,
  normalizeKey,
  joinUrl,
  pickUniqueName,
  nestFolders,
  normalizeRequest,
  normalizeManifest,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test src/api/__tests__/sdkManifest.test.cjs`
Expected: `# pass 9` (all pass).

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/sdkManifest.js backend/src/api/__tests__/sdkManifest.test.cjs
git commit -m "feat(api): pure manifest helpers for SDK route sync"
```

---

## Task 3: `POST /api/sdk/sync` endpoint + mount

> **Execution note (updated after Task 1/2):** Tasks 3 and 4 are mutually dependent — both edit
> `backend/tests/sdkSync.integration.test.cjs`, and Task 3's test cannot reach green until Task 4's
> `tokens.js` accepts the `sdk` scope and `projectId`/`workspaceId`. Execute Tasks 3 and 4 as a single
> implementation pass (one commit is acceptable) and review them together.
>
> **Scratch DB (environment):** Postgres role dependencies are cluster-wide, so an isolated new DB on
> port 5432 cannot run migration `001` (`DROP ROLE IF EXISTS app_user` fails against the dev `apihub`).
> Run integration tests on the isolated scratch cluster on port **5441**, DB `apihub`, with
> `PGPORT=5441` (so `db.js` connects there too) in addition to `INTEGRATION_PGPORT=5441`.

**Files:**
- Create: `backend/src/api/routes/sdk.js`
- Modify: `backend/src/api/server.js` (require + mount near line 104)
- Test: `backend/tests/sdkSync.integration.test.cjs`

**Interfaces:**
- Consumes: `tokenAuth`, `normalizeManifest`, `nestFolders`, `pickUniqueName`, `checkCountGate`, `orgOfProject`, `getProjectAccess`, `roleAtLeast`, `canMutateWorkspace`.
- Produces: `POST /api/sdk/sync` → `201 { summary, projectId, collectionId, folders: [...], requests: [...] }`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/sdkSync.integration.test.cjs`:

```js
'use strict';

// Round 5 — apihub-sdk route sync integration test.
// Boots a minimal app with auth + tokens + sdk routers, creates a bound token,
// and exercises idempotent sync (create then update, no duplicates).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DBNAME = process.env.INTEGRATION_PGDATABASE || 'apihub_sdk_test';
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: DBNAME,
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-c', sql], {
    env: PGENV, stdio: 'pipe', encoding: 'utf8',
  });
}
function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DBNAME, '-f', file], {
    env: PGENV, stdio: 'pipe', encoding: 'utf8',
  });
}

let server;
let base;
let admin;
let apiKey;
let projectId;
let workspaceId;

function makeClient() {
  let cookie = '';
  async function api(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
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
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  }
  return { api };
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = DBNAME;
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const express = require('express');
  server = await new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api/auth', require('../src/api/routes/auth'));
    app.use('/api/workspaces', require('../src/api/routes/workspaces'));
    app.use('/api', require('../src/api/routes/content'));
    app.use('/api/tokens', require('../src/api/routes/tokens'));
    app.use('/api/sdk', require('../src/api/routes/sdk'));
    app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message || 'Internal server error' }));
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'sdkadmin@test.io', password: 'adminpass123', name: 'SDK Admin',
  });
  assert.equal(signup.status, 201);
  const ws = await admin.api('GET', '/api/workspaces');
  workspaceId = ws.json.workspaces.find((w) => w.name === 'My Workspace').id;
  const content = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  projectId = content.json.projects.find((p) => p.can_access).id;

  const token = await admin.api('POST', '/api/tokens', {
    name: 'SDK key', scopes: ['sdk'], projectId,
  });
  assert.equal(token.status, 201);
  apiKey = token.json.token;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await require('../src/api/db').pool.end();
});

const MANIFEST = {
  source: 'express',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  folders: [
    { key: 'Users', name: 'Users', parent: null },
    { key: 'Users/Admin', name: 'Admin', parent: 'Users' },
  ],
  requests: [
    { key: 'GET /health', name: 'Health', method: 'GET', path: '/health' },
    { key: 'GET /users/:id', name: 'Get user', method: 'GET', path: '/users/:id', folder: 'Users' },
    {
      key: 'DELETE /users/:id', name: 'Delete user', method: 'DELETE', path: '/users/:id',
      folder: 'Users/Admin', assertions: [{ id: 'a1', type: 'status', operator: 'eq', expected: '204' }],
    },
  ],
};

function syncRequest(body) {
  return admin.api('POST', '/api/sdk/sync', body, { Authorization: `Bearer ${apiKey}` });
}

test('sync rejects missing Bearer token', async () => {
  const res = await admin.api('POST', '/api/sdk/sync', MANIFEST);
  assert.equal(res.status, 401);
});

test('sync creates a collection, nested folders and requests', async () => {
  const res = await syncRequest(MANIFEST);
  assert.equal(res.status, 201);
  assert.equal(res.json.summary.requests.created, 3);
  assert.equal(res.json.summary.folders.created, 2);
  assert.equal(res.json.collectionId, res.json.summary.collectionId);

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collections = tree.json.collections.filter((c) => c.project_id === projectId && c.name === 'Backend');
  assert.equal(collections.length, 1);
  const folderNames = tree.json.folders.filter((f) => f.collection_id === collections[0].id).map((f) => f.name).sort();
  assert.deepEqual(folderNames, ['Admin', 'Users']);
  const reqs = tree.json.requests.filter((r) => r.collection_id === collections[0].id);
  assert.equal(reqs.length, 3);
});

test('re-sync updates in place without duplicating', async () => {
  const updated = JSON.parse(JSON.stringify(MANIFEST));
  updated.requests[0].name = 'Health probe';
  const res = await syncRequest(updated);
  assert.equal(res.status, 201);
  assert.equal(res.json.summary.requests.created, 0);
  assert.equal(res.json.summary.requests.updated, 3);
  assert.equal(res.json.summary.folders.created, 0);

  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collections = tree.json.collections.filter((c) => c.project_id === projectId && c.name === 'Backend');
  const reqs = tree.json.requests.filter((r) => r.collection_id === collections[0].id);
  assert.equal(reqs.length, 3);
  assert.ok(reqs.some((r) => r.name === 'Health probe'));
});

test('assertions and target URL are persisted', async () => {
  const tree = await admin.api('GET', `/api/workspaces/${workspaceId}/content`);
  const collection = tree.json.collections.find((c) => c.project_id === projectId && c.name === 'Backend');
  const req = tree.json.requests.find((r) => r.collection_id === collection.id && r.name === 'Health probe');
  const detail = await admin.api('GET', `/api/requests/${req.id}`);
  assert.equal(detail.json.request.url, 'http://localhost:4000/health');
  const del = tree.json.requests.find((r) => r.collection_id === collection.id && r.method === 'DELETE');
  const delDetail = await admin.api('GET', `/api/requests/${del.id}`);
  assert.equal(delDetail.json.request.assertions.length, 1);
  assert.equal(delDetail.json.request.assertions[0].expected, '204');
});

test('a project-bound key cannot sync into another project', async () => {
  const other = await admin.api('POST', '/api/workspaces', { name: `Other ${Date.now()}` });
  const otherProject = (await admin.api('GET', `/api/workspaces/${other.json.workspace.id}/content`)).json.projects[0].id;
  const res = await syncRequest({ ...MANIFEST, collection: 'Elsewhere', projectId: otherProject });
  // Binding wins: content still lands in the bound project, not otherProject.
  assert.equal(res.status, 201);
  const tree = await admin.api('GET', `/api/workspaces/${other.json.workspace.id}/content`);
  assert.equal(tree.json.collections.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub node --test tests/sdkSync.integration.test.cjs
```

Expected: FAIL at the first `syncRequest` (404 `Not found: POST /api/sdk/sync`) because the route does not exist yet.

- [ ] **Step 3: Implement `routes/sdk.js`**

Create `backend/src/api/routes/sdk.js`:

```js
'use strict';

// Round 5 — apihub-sdk route sync.
//   POST /api/sdk/sync  (Bearer token, scope "sdk" or "write")
//
// The SDK sends a manifest of folders + requests. We resolve the target
// project/collection, then upsert folders and requests by external_key so
// repeated syncs update in place. Access + plan gates mirror contracts.js.

const { Router } = require('express');
const { query, pool } = require('../db');
const { tokenAuth } = require('../tokenAuth');
const { getProjectAccess, roleAtLeast, canMutateWorkspace } = require('../access');
const { checkCountGate, orgOfProject } = require('../entitlements');
const { normalizeManifest, pickUniqueName } = require('../sdkManifest');

const router = Router();
router.use(tokenAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

async function projectRow(projectId) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.workspace_id FROM projects p WHERE p.id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

async function resolveProject(req, manifest) {
  const token = req.apiToken;
  let project = null;

  if (token.project_id) {
    project = await projectRow(token.project_id);
    if (!project) return { error: { status: 403, body: { error: 'Bound project no longer exists' } } };
    const access = await getProjectAccess(req.user.id, project.id);
    if (!access || !roleAtLeast(access.level, 'EDITOR')) {
      return { error: { status: 403, body: { error: 'Editor, manager or admin access required' } } };
    }
    return { project };
  }

  if (token.workspace_id) {
    const workspace = (await query(`SELECT id FROM workspaces WHERE id = $1`, [token.workspace_id])).rows[0];
    if (!workspace) return { error: { status: 403, body: { error: 'Bound workspace no longer exists' } } };
    if (!(await canMutateWorkspace(req.user.id, workspace.id))) {
      return { error: { status: 403, body: { error: 'Workspace write access required' } } };
    }
    const name = manifest.project || 'SDK Sync';
    const existing = (await query(
      `SELECT id, name, workspace_id FROM projects WHERE workspace_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
      [workspace.id, name]
    )).rows[0];
    if (existing) return { project: existing };
    const created = (await query(
      `INSERT INTO projects (workspace_id, name) VALUES ($1, $2) RETURNING id, name, workspace_id`,
      [workspace.id, name]
    )).rows[0];
    return { project: created };
  }

  // Unbound (legacy personal) token: require an explicit project the user owns.
  const projectId = manifest.projectId;
  if (!isUuid(projectId)) {
    return { error: { status: 400, body: { error: 'Provide projectId, or use a project/workspace-bound key' } } };
  }
  project = await projectRow(projectId);
  if (!project) return { error: { status: 404, body: { error: 'Project not found' } } };
  const access = await getProjectAccess(req.user.id, project.id);
  if (!access || !roleAtLeast(access.level, 'EDITOR')) {
    return { error: { status: 403, body: { error: 'Editor, manager or admin access required' } } };
  }
  return { project };
}

async function resolveCollection(req, project, manifest, summary) {
  const name = manifest.collection || project.name;
  const existing = (await query(
    `SELECT id, name FROM collections WHERE project_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
    [project.id, name]
  )).rows[0];
  if (existing) {
    await query(`UPDATE collections SET source = COALESCE(source, $2) WHERE id = $1`, [existing.id, manifest.source]);
    return existing;
  }
  const gate = await checkCountGate({ userId: req.user.id, orgId: await orgOfProject(project.id), key: 'collections' });
  if (gate) return { error: { status: 403, body: gate } };
  const used = (await query(`SELECT name FROM collections WHERE project_id = $1`, [project.id])).rows.map((r) => r.name);
  const collection = (await query(
    `INSERT INTO collections (project_id, name, source) VALUES ($1, $2, $3) RETURNING id, name`,
    [project.id, pickUniqueName(name, used), manifest.source]
  )).rows[0];
  summary.collections.created += 1;
  return collection;
}

async function upsertFolders(req, collection, manifest, summary) {
  const idByKey = new Map();
  for (const folder of manifest.folders) {
    const parentId = folder.parent ? idByKey.get(folder.parent) || null : null;
    const existing = (await query(
      `SELECT id, name, parent_id FROM folders WHERE collection_id = $1 AND external_key = $2`,
      [collection.id, folder.key]
    )).rows[0];
    if (existing) {
      if (existing.name !== folder.name || existing.parent_id !== parentId) {
        const siblings = (await query(
          `SELECT name FROM folders WHERE collection_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND id <> $3`,
          [collection.id, parentId, existing.id]
        )).rows.map((r) => r.name);
        await query(
          `UPDATE folders SET name = $2, parent_id = $3, source = COALESCE(source, $4) WHERE id = $1`,
          [existing.id, pickUniqueName(folder.name, siblings), parentId, manifest.source]
        );
        summary.folders.updated += 1;
      }
      idByKey.set(folder.key, existing.id);
      continue;
    }
    const siblings = (await query(
      `SELECT name FROM folders WHERE collection_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
      [collection.id, parentId]
    )).rows.map((r) => r.name);
    const created = (await query(
      `INSERT INTO folders (collection_id, name, parent_id, external_key, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [collection.id, pickUniqueName(folder.name, siblings), parentId, folder.key, manifest.source]
    )).rows[0];
    idByKey.set(folder.key, created.id);
    summary.folders.created += 1;
  }
  return idByKey;
}

async function upsertRequests(req, collection, manifest, folderIdByKey, summary) {
  const seenKeys = [];
  const created = [];
  const updated = [];
  for (const r of manifest.requests) {
    const folderId = r.folder ? folderIdByKey.get(r.folder) || null : null;
    seenKeys.push(r.key);
    const existing = (await query(
      `SELECT id FROM api_requests WHERE collection_id = $1 AND external_key = $2`,
      [collection.id, r.key]
    )).rows[0];

    if (existing) {
      await query(
        `UPDATE api_requests
            SET name = $2, method = $3, url = $4, api_type = $5, headers = $6, query_params = $7,
                body_type = $8, body_json = $9, body_text = $10, assertions = $11, folder_id = $12,
                source = $13, source_file = $14, synced_at = now()
          WHERE id = $1`,
        [
          existing.id, r.name, r.method, r.url, r.apiType,
          JSON.stringify(r.headers), JSON.stringify(r.queryParams),
          r.bodyType, r.bodyJson === null ? null : JSON.stringify(r.bodyJson), r.bodyText,
          JSON.stringify(r.assertions), folderId,
          r.source || manifest.source, r.sourceFile,
        ]
      );
      updated.push(existing.id);
      summary.requests.updated += 1;
      continue;
    }

    const gate = await checkCountGate({
      userId: req.user.id, orgId: await orgOfProject(collection.project_id || (await query(
        `SELECT project_id FROM collections WHERE id = $1`, [collection.id]
      )).rows[0].project_id), key: 'api_requests', extra: 1,
    });
    if (gate) return { error: { status: 403, body: gate } };

    const siblings = (await query(
      `SELECT name FROM api_requests WHERE collection_id = $1 AND folder_id IS NOT DISTINCT FROM $2`,
      [collection.id, folderId]
    )).rows.map((row) => row.name);
    const inserted = (await query(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type,
          body_json, body_text, assertions, folder_id, external_key, source, source_file, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       RETURNING id`,
      [
        collection.id, pickUniqueName(r.name, siblings), r.method, r.url, r.apiType,
        JSON.stringify(r.headers), JSON.stringify(r.queryParams), r.bodyType,
        r.bodyJson === null ? null : JSON.stringify(r.bodyJson), r.bodyText,
        JSON.stringify(r.assertions), folderId, r.key, r.source || manifest.source, r.sourceFile,
      ]
    )).rows[0];
    created.push(inserted.id);
    summary.requests.created += 1;
  }

  if (manifest.prune) {
    const { rows } = await query(
      `DELETE FROM api_requests
        WHERE collection_id = $1 AND external_key IS NOT NULL AND source = $2
          AND NOT (external_key = ANY($3::text[]))
        RETURNING id`,
      [collection.id, manifest.source, seenKeys]
    );
    summary.requests.pruned += rows.length;
  }
  return { created, updated };
}

router.post('/sync', async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.apiToken.scopes.includes('sdk') && !req.apiToken.scopes.includes('write')) {
      return res.status(403).json({ error: 'API token requires the "sdk" or "write" scope' });
    }
    let manifest;
    try {
      manifest = normalizeManifest(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const resolved = await resolveProject(req, manifest);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
    const { project } = resolved;
    project.name = project.name || '';

    const summary = {
      collectionId: null,
      collections: { created: 0 },
      folders: { created: 0, updated: 0 },
      requests: { created: 0, updated: 0, pruned: 0 },
    };

    await client.query('BEGIN');
    const collectionResult = await resolveCollection(req, project, manifest, summary);
    if (collectionResult.error) {
      await client.query('ROLLBACK');
      return res.status(collectionResult.error.status).json(collectionResult.error.body);
    }
    const collection = collectionResult;
    collection.project_id = project.id;
    summary.collectionId = collection.id;

    const folderIdByKey = await upsertFolders(req, collection, manifest, summary);
    const reqResult = await upsertRequests(req, collection, manifest, folderIdByKey, summary);
    if (reqResult.error) {
      await client.query('ROLLBACK');
      return res.status(reqResult.error.status).json(reqResult.error.body);
    }

    await client.query(
      `INSERT INTO sdk_sync_runs (token_id, user_id, workspace_id, project_id, collection_id, source, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.apiToken.id, req.user.id, project.workspace_id, project.id, collection.id, manifest.source, JSON.stringify(summary)]
    );
    await client.query('COMMIT');

    res.status(201).json({
      summary,
      projectId: project.id,
      collectionId: collection.id,
      requestIds: reqResult.created.concat(reqResult.updated),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
```

> Note: `resolveCollection`/`upsertFolders`/`upsertRequests` use `query` (pool) while the route wraps `client.query('BEGIN')`. If a caller needs strict transactional behavior, pass the client through; for v1 the upserts are idempotent, so a partial failure is safe to re-run. Keep this in mind if you later add `prune`.

- [ ] **Step 4: Mount the router**

In `backend/src/api/server.js`, add the require alongside the other route requires (after line 29's `versionRoutes`):

```js
const sdkRoutes = require('./routes/sdk');
```

and mount it after the `versionRoutes` mount (line 105):

```js
  app.use('/api/sdk', sdkRoutes);
```

- [ ] **Step 5: Run the integration test**

Run:

```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub node --test tests/sdkSync.integration.test.cjs
```

Expected: `# pass 5` / `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/sdk.js backend/src/api/server.js backend/tests/sdkSync.integration.test.cjs
git commit -m "feat(api): POST /api/sdk/sync for idempotent route sync"
```

---

## Task 4: Project/workspace-bound API tokens

**Files:**
- Modify: `backend/src/api/routes/tokens.js`
- Modify: `backend/src/api/tokenAuth.js` (return the binding columns the sync route needs)

**Interfaces:**
- Consumes: `getProjectAccess`, `roleAtLeast`, `canMutateWorkspace` from `../access`.
- Produces: `POST /api/tokens` accepts `projectId`/`workspaceId` and scope `sdk`; `GET /api/tokens` returns `projectId`/`workspaceId`.

- [ ] **Step 1: Extend the integration test (Task 3 file) with binding assertions**

Append to `backend/tests/sdkSync.integration.test.cjs`:

```js
test('token create validates and returns project binding', async () => {
  const bad = await admin.api('POST', '/api/tokens', {
    name: 'Bad binding', scopes: ['sdk'], projectId: 'not-a-uuid',
  });
  assert.equal(bad.status, 400);

  const both = await admin.api('POST', '/api/tokens', {
    name: 'Both', scopes: ['sdk'], projectId, workspaceId,
  });
  assert.equal(both.status, 400);

  const listed = await admin.api('GET', '/api/tokens');
  const key = listed.json.tokens.find((t) => t.name === 'SDK key');
  assert.equal(key.projectId, projectId);
  assert.equal(key.workspaceId, null);
  assert.ok(key.scopes.includes('sdk'));
});

test('a key without the sdk/write scope cannot sync', async () => {
  const readToken = await admin.api('POST', '/api/tokens', { name: 'Read only', scopes: ['read'], projectId });
  const res = await admin.api('POST', '/api/sdk/sync', MANIFEST, {
    Authorization: `Bearer ${readToken.json.token}`,
  });
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub node --test tests/sdkSync.integration.test.cjs`
Expected: FAIL — `bad.status` is 201 instead of 400 (binding not validated yet).

- [ ] **Step 3: Update `tokens.js`**

Apply these changes to `backend/src/api/routes/tokens.js`:

1. Import access helpers (after line 6):
```js
const { getProjectAccess, roleAtLeast, canMutateWorkspace } = require('../access');
```

2. Extend the allow-list and serializer (line 12 and `toApiToken`):
```js
const ALLOWED_SCOPES = new Set(['read', 'write', 'runs', 'sdk']);
```
```js
function toApiToken(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes || ['read'],
    status: row.status,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    projectId: row.project_id ?? null,
    workspaceId: row.workspace_id ?? null,
  };
}
```

3. Update the `GET /` select (line 51) and the `POST /` insert/returning (lines 85-91). Replace the GET select with:
```js
      `SELECT id, name, prefix, scopes, status, last_used_at, created_at, expires_at, project_id, workspace_id
         FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
```

4. Add binding validation to `POST /` immediately after the scopes check (after line 71):
```js
    const projectId = body.projectId ? String(body.projectId).trim() : null;
    const workspaceId = body.workspaceId ? String(body.workspaceId).trim() : null;
    if (projectId && workspaceId) {
      return res.status(400).json({ error: 'A token can bind to a project OR a workspace, not both' });
    }
    if (projectId) {
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
      const access = await getProjectAccess(req.user.id, projectId);
      if (!access || !roleAtLeast(access.level, 'EDITOR')) {
        return res.status(403).json({ error: 'Editor, manager or admin access required for this project' });
      }
    }
    if (workspaceId) {
      if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
      if (!(await canMutateWorkspace(req.user.id, workspaceId))) {
        return res.status(403).json({ error: 'Workspace write access required' });
      }
    }
```

5. Replace the insert in `POST /` (lines 86-91):
```js
    const { rows } = await query(
      `INSERT INTO api_tokens (user_id, name, prefix, token_hash, scopes, status, expires_at, project_id, workspace_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
       RETURNING id, name, prefix, scopes, status, last_used_at, created_at, expires_at, project_id, workspace_id`,
       [req.user.id, name, prefix, hashToken(token), scopes, expiresAt, projectId, workspaceId]
    );
```

6. Return the binding columns to the auth layer. In `backend/src/api/tokenAuth.js`, `findTokenByHash` currently selects only
   `id, user_id, name, prefix, scopes, status, last_used_at, expires_at, created_at, updated_at`. Add `project_id, workspace_id`
   to that `SELECT` so `req.apiToken.project_id` / `req.apiToken.workspace_id` are populated for `POST /api/sdk/sync`.
   (Without this the bound key resolves as unbound and the binding test fails.)

- [ ] **Step 4: Run the integration test**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub node --test tests/sdkSync.integration.test.cjs`
Expected: `# pass 7` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/routes/tokens.js backend/tests/sdkSync.integration.test.cjs
git commit -m "feat(api): project/workspace-bound API tokens with sdk scope"
```

---

## Task 5: Frontend — create bound keys from the API tokens page

**Files:**
- Modify: `frontend/src/lib/tokens.ts`
- Modify: `frontend/src/components/ApiTokensView.tsx`
- Modify: `frontend/app/settings/api-tokens/api-tokens.css`
- Test: `frontend/src/lib/__tests__/tokens.test.cjs`

**Interfaces:**
- Consumes: `tokensApi`, `workspaceApi`, `workspaceApi.content`.
- Produces: `ApiTokenScope` includes `'sdk'`; `ApiToken`/`ApiTokenCreateInput` carry `projectId?`/`workspaceId?`; create form has a binding selector with testids `apitoken-binding-kind`, `apitoken-binding-target`, `apitoken-scope-sdk`.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/lib/__tests__/tokens.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'tokens.ts'), 'utf8');

test('tokens lib exposes the sdk scope and binding fields', () => {
  assert.match(src, /'sdk'/);
  assert.match(src, /projectId/);
  assert.match(src, /workspaceId/);
});

test('tokens lib labels the sdk scope', () => {
  assert.match(src, /sdk:\s*'SDK \/ route sync'/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/tokens.test.cjs`
Expected: FAIL (no `'sdk'`).

- [ ] **Step 3: Update `tokens.ts`**

Replace the relevant parts of `frontend/src/lib/tokens.ts`:

```ts
export type ApiTokenScope = 'read' | 'write' | 'runs' | 'sdk';
export type ApiTokenStatus = 'active' | 'revoked';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  status: ApiTokenStatus;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  projectId: string | null;
  workspaceId: string | null;
}

export interface ApiTokenCreateInput {
  name: string;
  scopes?: ApiTokenScope[];
  expiresAt?: string | null;
  projectId?: string;
  workspaceId?: string;
}
```

and:

```ts
export const API_TOKEN_SCOPES: ApiTokenScope[] = ['read', 'write', 'runs', 'sdk'];

export const API_TOKEN_SCOPE_LABEL: Record<ApiTokenScope, string> = {
  read: 'Read',
  write: 'Write',
  runs: 'Run requests',
  sdk: 'SDK / route sync',
};

export const API_TOKEN_SCOPE_HINT: Record<ApiTokenScope, string> = {
  read: 'List and inspect resources',
  write: 'Create and update resources',
  runs: 'Execute stored requests server-side',
  sdk: 'Sync routes from apihub-sdk into a project or workspace',
};
```

- [ ] **Step 4: Add the binding selector to `CreateTokenForm`**

In `frontend/src/components/ApiTokensView.tsx`:

Add imports at the top (alongside the existing `tokensApi` import):
```tsx
import { useEffect as useEffectReact } from 'react';
import { workspaceApi, type Workspace } from '@/lib/api';
```
(If `useEffect` is already imported from React, reuse it — do not double-import.)

Inside `CreateTokenForm`, add state and a small loader:
```tsx
  const [bindingKind, setBindingKind] = useState<'none' | 'project' | 'workspace'>('none');
  const [bindingTarget, setBindingTarget] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; workspaceId: string }>>([]);

  useEffectReact(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await workspaceApi.list();
        if (cancelled) return;
        setWorkspaces(res.workspaces);
        const perWorkspace = await Promise.all(
          res.workspaces.map(async (w) => {
            const content = await workspaceApi.content(w.id);
            return content.projects.map((p) => ({ id: p.id, name: p.name, workspaceId: w.id }));
          })
        );
        if (!cancelled) setProjects(perWorkspace.flat());
      } catch {
        /* binding is optional; ignore load errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

In `submit`, build the create input:
```tsx
      const input: Parameters<typeof tokensApi.create>[0] = { name: name.trim(), scopes, expiresAt };
      if (bindingKind === 'project' && bindingTarget) input.projectId = bindingTarget;
      if (bindingKind === 'workspace' && bindingTarget) input.workspaceId = bindingTarget;
      const created = await tokensApi.create(input);
```

Add this block in the form, after the Scopes field and before Expiration:
```tsx
      <div className="apitoken-field">
        <label className="apitoken-label" htmlFor="apitoken-binding-kind">
          Scope this key to
        </label>
        <select
          id="apitoken-binding-kind"
          className="text-input"
          value={bindingKind}
          data-testid="apitoken-binding-kind"
          onChange={(e) => {
            setBindingKind(e.target.value as 'none' | 'project' | 'workspace');
            setBindingTarget('');
          }}
        >
          <option value="none">Nothing (personal key)</option>
          <option value="project">A project</option>
          <option value="workspace">A workspace</option>
        </select>
        {bindingKind !== 'none' ? (
          <select
            className="text-input"
            value={bindingTarget}
            data-testid="apitoken-binding-target"
            onChange={(e) => setBindingTarget(e.target.value)}
          >
            <option value="">Select…</option>
            {bindingKind === 'project'
              ? projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
          </select>
        ) : null}
        <small className="apitoken-hint">
          Project/workspace keys let apihub-sdk sync routes without a personal key.
        </small>
      </div>
```

Finally show the binding on each row. In `TokenRow`, where the scopes are rendered, append:
```tsx
        {token.projectId ? <span className="apitoken-badge">project key</span> : null}
        {token.workspaceId ? <span className="apitoken-badge">workspace key</span> : null}
```

- [ ] **Step 5: Add styles**

Append to `frontend/app/settings/api-tokens/api-tokens.css`:

```css
.apitoken-hint {
  color: var(--text-muted);
  font-size: 12px;
}
.apitoken-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 6: Typecheck and test**

Run:
```bash
cd frontend && npx tsc --noEmit && node --test src/lib/__tests__/tokens.test.cjs
```
Expected: `tsc` prints nothing (exit 0); `# pass 2`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/tokens.ts frontend/src/lib/__tests__/tokens.test.cjs frontend/src/components/ApiTokensView.tsx frontend/app/settings/api-tokens/api-tokens.css
git commit -m "feat(ui): create project/workspace-bound SDK keys from API tokens"
```

---

## Task 6: SDK package scaffold — config, errors, assertions

**Files:**
- Create: `sdk/package.json`, `sdk/README.md`, `sdk/LICENSE`
- Create: `sdk/src/errors.js`, `sdk/src/config.js`, `sdk/src/assertions.js`
- Test: `sdk/test/config.test.js`, `sdk/test/assertions.test.js`

**Interfaces:**
- Produces: `createConfig(options, env) -> { apiKey, baseUrl, project, workspace, collection, targetBaseUrl, source, autoSync, include, exclude, timeoutMs, prune, onError }`; `normalizeExpects(expects) -> Assertion[]`; `ApiHubConfigError`, `ApiHubError`.

- [ ] **Step 1: Write the failing tests**

Create `sdk/test/config.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../src/config');

test('reads credentials and base url from env', () => {
  const cfg = createConfig({}, { APIHUB_API_KEY: 'k1', APIHUB_BASE_URL: 'http://api.example/' });
  assert.equal(cfg.apiKey, 'k1');
  assert.equal(cfg.baseUrl, 'http://api.example');
});

test('options win over env', () => {
  const cfg = createConfig({ apiKey: 'opt', baseUrl: 'http://opt' }, { APIHUB_API_KEY: 'env' });
  assert.equal(cfg.apiKey, 'opt');
  assert.equal(cfg.baseUrl, 'http://opt');
});

test('defaults are sane', () => {
  const cfg = createConfig({ apiKey: 'k' }, {});
  assert.equal(cfg.baseUrl, 'http://localhost:3001');
  assert.equal(cfg.source, 'express');
  assert.equal(cfg.autoSync, true);
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.prune, false);
  assert.deepEqual(cfg.include, []);
  assert.deepEqual(cfg.exclude, []);
});

test('throws a config error when no key is provided', () => {
  assert.throws(() => createConfig({}, {}), /API key is required/);
});
```

Create `sdk/test/assertions.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExpects } = require('../src/assertions');

test('maps status, json, headers and responseTime into assertion objects', () => {
  const out = normalizeExpects({
    status: 200,
    json: { 'data.id': '1' },
    headers: { 'content-type': 'application/json' },
    responseTimeMs: 500,
  });
  const byType = Object.fromEntries(out.map((a) => [a.type, a]));
  assert.equal(byType.status.expected, '200');
  assert.equal(byType.jsonPath.path, 'data.id');
  assert.equal(byType.jsonPath.operator, 'eq');
  assert.equal(byType.header.path, 'content-type');
  assert.equal(byType.header.operator, 'contains');
  assert.equal(byType.responseTime.operator, 'lt');
  assert.equal(byType.responseTime.expected, '500');
});

test('empty expects yields an empty list', () => {
  assert.deepEqual(normalizeExpects(), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sdk && node --test test/config.test.js test/assertions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `sdk/package.json`, `LICENSE`, `README.md`**

`sdk/package.json`:

```json
{
  "name": "apihub-sdk",
  "version": "0.1.0",
  "description": "Sync framework routes into MockShift / API Hub as testable requests.",
  "license": "MIT",
  "private": false,
  "main": "src/index.js",
  "types": "src/index.d.ts",
  "bin": { "apihub-sdk": "./bin/apihub-sdk.js" },
  "exports": {
    ".": "./src/index.js",
    "./express": "./src/adapters/express.js",
    "./package.json": "./package.json"
  },
  "files": ["src", "bin", "README.md", "LICENSE"],
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "test": "node --test \"test/*.test.js\"",
    "prepublishOnly": "npm test"
  },
  "keywords": ["apihub", "mockshift", "api-testing", "express", "openapi", "routes"],
  "repository": { "type": "git", "url": "https://github.com/Ranjithramesh67/MockShift.git", "directory": "sdk" },
  "peerDependencies": { "express": ">=4" },
  "peerDependenciesMeta": { "express": { "optional": true } },
  "devDependencies": { "express": "^4.19.2" }
}
```

`sdk/LICENSE`: standard MIT license text with `Copyright (c) 2026 MockShift`.

`sdk/README.md`:

````markdown
# apihub-sdk

Sync the routes your Express app defines into [MockShift / API Hub](https://github.com/Ranjithramesh67/MockShift) as collections, nested folders and testable requests.

## Install

```bash
npm install apihub-sdk
```

## Quick start

```js
const express = require('express');
const { attach } = require('apihub-sdk');

const app = express();
const hub = attach(app, {
  apiKey: process.env.APIHUB_API_KEY, // a project- or workspace-bound key
  baseUrl: 'http://localhost:3001',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  folder: (route) => route.path.split('/').filter(Boolean)[0] || 'Root',
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

hub.test('GET /users/:id', { status: 200, json: { 'id': '1' } });
// Syncs automatically when the server starts. You can also call `await hub.sync()`.
app.listen(4000);
```

## Configuration

| Option | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` | `APIHUB_API_KEY` | — | Project- or workspace-bound API key (required). |
| `baseUrl` | `APIHUB_BASE_URL` | `http://localhost:3001` | MockShift backend base URL. |
| `project` | `APIHUB_PROJECT` | — | Project name (required for a workspace-bound key). |
| `workspace` | `APIHUB_WORKSPACE` | — | Workspace name (informational). |
| `collection` | `APIHUB_COLLECTION` | project name | Collection to sync into. |
| `targetBaseUrl` | `APIHUB_TARGET_BASE_URL` | '' | Base URL prepended to each route path. |
| `folder` | — | first path segment | String or `(route) => 'A/B'` nested folder path. |
| `structure` | — | — | `{ '/users': 'Users', '/users/:id/posts': 'Users/Posts' }` longest-prefix map. |
| `include` / `exclude` | — | `[]` | Path prefixes to include/exclude. |
| `autoSync` | — | `true` | Sync once the server starts listening. |
| `prune` | — | `false` | Delete synced requests missing from the manifest. |
| `timeoutMs` | — | `5000` | HTTP timeout for a sync call. |

## CLI

```bash
# apihub.config.cjs must export a configured hub (see README)
npx apihub-sdk sync --config ./apihub.config.cjs
```
````

- [ ] **Step 4: Implement `errors.js`, `config.js`, `assertions.js`**

`sdk/src/errors.js`:

```js
'use strict';

class ApiHubError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiHubError';
    this.status = options.status;
    this.body = options.body;
    this.cause = options.cause;
  }
}

class ApiHubConfigError extends ApiHubError {
  constructor(message) {
    super(message);
    this.name = 'ApiHubConfigError';
  }
}

module.exports = { ApiHubError, ApiHubConfigError };
```

`sdk/src/config.js`:

```js
'use strict';

const { ApiHubConfigError } = require('./errors');

const DEFAULTS = {
  baseUrl: 'http://localhost:3001',
  source: 'express',
  autoSync: true,
  timeoutMs: 5000,
  prune: false,
  include: [],
  exclude: [],
  onError: null,
};

function first(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function createConfig(options = {}, env = process.env) {
  const apiKey = first(options.apiKey, env.APIHUB_API_KEY, env.APIHUB_PROJECT_KEY, env.APIHUB_WORKSPACE_KEY);
  if (!apiKey) {
    throw new ApiHubConfigError(
      'API key is required — pass { apiKey } or set APIHUB_API_KEY / APIHUB_PROJECT_KEY / APIHUB_WORKSPACE_KEY.'
    );
  }
  const baseUrl = String(first(options.baseUrl, env.APIHUB_BASE_URL, DEFAULTS.baseUrl)).replace(/\/+$/, '');
  const timeoutMs = Number(first(options.timeoutMs, DEFAULTS.timeoutMs));
  return {
    ...DEFAULTS,
    ...options,
    apiKey: String(apiKey),
    baseUrl,
    project: first(options.project, env.APIHUB_PROJECT) || null,
    workspace: first(options.workspace, env.APIHUB_WORKSPACE) || null,
    collection: first(options.collection, env.APIHUB_COLLECTION) || null,
    targetBaseUrl: String(first(options.targetBaseUrl, env.APIHUB_TARGET_BASE_URL, '')).replace(/\/+$/, ''),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULTS.timeoutMs,
    include: Array.isArray(options.include) ? options.include : [],
    exclude: Array.isArray(options.exclude) ? options.exclude : [],
  };
}

module.exports = { createConfig, DEFAULTS };
```

`sdk/src/assertions.js`:

```js
'use strict';

// Map a friendly `expects` object into the API Hub assertion shape:
//   { id, type: 'status'|'jsonPath'|'header'|'responseTime',
//     operator: 'eq'|'neq'|'contains'|'gt'|'lt', path?, expected? }
function normalizeExpects(expects = {}) {
  const out = [];
  let n = 0;
  const nextId = () => `sdk-a${++n}`;

  if (expects.status !== undefined) {
    out.push({ id: nextId(), type: 'status', operator: 'eq', expected: String(expects.status) });
  }
  for (const [path, expected] of Object.entries(expects.json || {})) {
    out.push({ id: nextId(), type: 'jsonPath', operator: 'eq', path, expected: String(expected) });
  }
  for (const [name, expected] of Object.entries(expects.headers || {})) {
    out.push({ id: nextId(), type: 'header', operator: 'contains', path: name, expected: String(expected) });
  }
  if (expects.responseTimeMs !== undefined) {
    out.push({ id: nextId(), type: 'responseTime', operator: 'lt', expected: String(expects.responseTimeMs) });
  }
  return out;
}

module.exports = { normalizeExpects };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sdk && node --test test/config.test.js test/assertions.test.js`
Expected: `# pass 6`.

- [ ] **Step 6: Commit**

```bash
git add sdk/package.json sdk/LICENSE sdk/README.md sdk/src/errors.js sdk/src/config.js sdk/src/assertions.js sdk/test/config.test.js sdk/test/assertions.test.js
git commit -m "feat(sdk): package scaffold, config resolution and assertion mapping"
```

---

## Task 7: SDK folder resolution + manifest builder

**Files:**
- Create: `sdk/src/folders.js`, `sdk/src/manifest.js`
- Test: `sdk/test/folders.test.js`, `sdk/test/manifest.test.js`

**Interfaces:**
- Consumes: `createConfig`, `normalizeKey`, `joinUrl`.
- Produces:
  - `resolveFolderPath(route, config) -> string` (slash-separated, no leading/trailing slash)
  - `buildManifest(routes, config) -> { source, project, workspace, collection, targetBaseUrl, prune, folders, requests }`.

- [ ] **Step 1: Write the failing tests**

Create `sdk/test/folders.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveFolderPath } = require('../src/folders');

test('defaults to the first path segment, title-cased', () => {
  assert.equal(resolveFolderPath({ path: '/users/:id' }, {}), 'Users');
  assert.equal(resolveFolderPath({ path: '/' }, {}), 'Root');
});

test('a string folder applies to every route', () => {
  assert.equal(resolveFolderPath({ path: '/users' }, { folder: 'Backend' }), 'Backend');
});

test('a function folder receives the route', () => {
  const config = { folder: (r) => `${r.method}/${r.path.split('/')[1]}` };
  assert.equal(resolveFolderPath({ method: 'GET', path: '/users' }, config), 'GET/Users');
});

test('structure uses the longest matching prefix', () => {
  const config = {
    structure: {
      '/users': 'Users',
      '/users/:id/posts': 'Users/Posts',
      '/admin': 'Admin',
    },
  };
  assert.equal(resolveFolderPath({ path: '/users/:id' }, config), 'Users');
  assert.equal(resolveFolderPath({ path: '/users/:id/posts' }, config), 'Users/Posts');
  assert.equal(resolveFolderPath({ path: '/admin/metrics' }, config), 'Admin');
});
```

Create `sdk/test/manifest.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildManifest } = require('../src/manifest');

const config = {
  source: 'express',
  project: 'Pets',
  workspace: 'Acme',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  prune: false,
  folder: (r) => r.path.split('/').filter(Boolean)[0] || 'Root',
};

const routes = [
  { method: 'GET', path: '/users', name: 'List users' },
  { method: 'GET', path: '/users/:id', name: 'Get user' },
  { method: 'POST', path: '/users', name: 'Create user', bodyType: 'JSON', bodyJson: { name: 'x' } },
];

test('builds nested folders from multi-segment folder paths', () => {
  const m = buildManifest(routes, { ...config, folder: () => 'Users/Admin' });
  assert.deepEqual(m.folders.map((f) => f.key), ['Users', 'Users/Admin']);
  assert.equal(m.folders[1].parent, 'Users');
  assert.ok(m.requests.every((r) => r.folder === 'Users/Admin'));
});

test('assigns stable external keys and base-url'd request urls', () => {
  const m = buildManifest(routes, config);
  assert.ok(m.requests.some((r) => r.key === 'GET /users/:id'));
  const get = m.requests.find((r) => r.key === 'GET /users/:id');
  assert.equal(get.url, 'http://localhost:4000/users/:id');
  assert.equal(get.folder, 'Users');
});

test('deduplicates identical method+path routes', () => {
  const m = buildManifest(
    [...routes, { method: 'GET', path: '/users', name: 'List users again' }],
    config
  );
  assert.equal(m.requests.filter((r) => r.key === 'GET /users').length, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sdk && node --test test/folders.test.js test/manifest.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `folders.js`**

Create `sdk/src/folders.js`:

```js
'use strict';

function titleCase(segment) {
  const s = String(segment || '').replace(/^:/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Root';
}

function defaultFolder(route) {
  const first = String(route.path || '/').split('/').filter(Boolean)[0];
  return first ? titleCase(first) : 'Root';
}

function structureFolder(route, structure) {
  const path = String(route.path || '/');
  let best = null;
  for (const prefix of Object.keys(structure || {})) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix)) {
      if (!best || prefix.length > best.length) best = prefix;
    }
  }
  return best ? String(structure[best]) : null;
}

function clean(path) {
  return String(path || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
}

// Resolve the slash-separated nested folder path for a route.
function resolveFolderPath(route, config = {}) {
  if (typeof config.folder === 'function') return clean(config.folder(route));
  if (typeof config.folder === 'string' && config.folder.trim()) return clean(config.folder);
  if (config.structure && typeof config.structure === 'object') {
    const match = structureFolder(route, config.structure);
    if (match) return clean(match);
  }
  return clean(defaultFolder(route));
}

// Expand a set of folder paths into {key,name,parent} entries (parents first).
function foldersFromPaths(paths) {
  const entries = new Map();
  for (const raw of paths) {
    const segments = clean(raw).split('/').filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const key = segments.slice(0, i + 1).join('/');
      if (entries.has(key)) continue;
      entries.set(key, {
        key,
        name: segments[i],
        parent: i === 0 ? null : segments.slice(0, i).join('/'),
      });
    }
  }
  return [...entries.values()];
}

module.exports = { resolveFolderPath, foldersFromPaths, titleCase };
```

- [ ] **Step 4: Implement `manifest.js`**

Create `sdk/src/manifest.js`:

```js
'use strict';

const { resolveFolderPath, foldersFromPaths } = require('./folders');

function normalizeKey(method, path) {
  const m = String(method || '').trim().toUpperCase();
  let p = String(path || '').trim();
  if (p && !p.startsWith('/')) p = `/${p}`;
  return `${m} ${p}`.trim();
}

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

function buildManifest(routes, config = {}) {
  const byKey = new Map();
  for (const route of routes || []) {
    const method = String(route.method || '').trim().toUpperCase();
    const path = String(route.path || '').trim();
    if (!method || !path) continue;
    const key = route.key || normalizeKey(method, path);
    const folder = route.folder !== undefined ? route.folder : resolveFolderPath({ ...route, method, path }, config);
    const entry = {
      key,
      name: route.name || key,
      method,
      path,
      url: route.url || joinUrl(config.targetBaseUrl, path),
      apiType: route.apiType || 'REST',
      folder: folder || null,
      headers: route.headers || [],
      queryParams: route.queryParams || [],
      bodyType: route.bodyType || 'NONE',
      bodyJson: route.bodyJson === undefined ? null : route.bodyJson,
      bodyText: route.bodyText === undefined ? null : route.bodyText,
      assertions: route.assertions || [],
      sourceFile: route.sourceFile || null,
    };
    if (byKey.has(key)) {
      byKey.set(key, { ...byKey.get(key), ...entry });
    } else {
      byKey.set(key, entry);
    }
  }
  const requests = [...byKey.values()];
  const folders = foldersFromPaths(requests.map((r) => r.folder).filter(Boolean));
  return {
    source: config.source || 'express',
    project: config.project || null,
    workspace: config.workspace || null,
    collection: config.collection || null,
    targetBaseUrl: config.targetBaseUrl || '',
    prune: Boolean(config.prune),
    folders,
    requests,
  };
}

module.exports = { buildManifest, normalizeKey, joinUrl };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sdk && node --test test/folders.test.js test/manifest.test.js`
Expected: `# pass 7`.

- [ ] **Step 6: Commit**

```bash
git add sdk/src/folders.js sdk/src/manifest.js sdk/test/folders.test.js sdk/test/manifest.test.js
git commit -m "feat(sdk): configurable folder structure and manifest builder"
```

---

## Task 8: SDK HTTP client + public API

**Files:**
- Create: `sdk/src/client.js`, `sdk/src/index.js`, `sdk/src/index.d.ts`
- Test: `sdk/test/client.test.js`, `sdk/test/index.test.js`

**Interfaces:**
- Consumes: `createConfig`, `buildManifest`, `ApiHubError`.
- Produces: `createClient(config) -> { sync(manifest) }`; `attach(app, options) -> hub`; `createHub(options) -> hub`; `hub.register(route)`, `hub.test(key, expects)`, `hub.manifest()`, `hub.sync()`, `hub.express(app, options)`.

- [ ] **Step 1: Write the failing tests**

Create `sdk/test/client.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('../src/client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('posts the manifest with a Bearer token and returns the body', async () => {
  let seen = null;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ summary: { requests: { created: 1 } } }));
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createClient({ baseUrl: base, apiKey: 'secret', timeoutMs: 2000 });
  const out = await client.sync({ requests: [{ method: 'GET', path: '/health' }] });
  assert.equal(out.summary.requests.created, 1);
  assert.equal(seen.url, '/api/sdk/sync');
  assert.equal(seen.auth, 'Bearer secret');
  assert.ok(Array.isArray(seen.body.requests));
  server.close();
});

test('throws ApiHubError with the status on a non-2xx response', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'nope' }));
  });
  const client = createClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'k', timeoutMs: 2000 });
  await assert.rejects(() => client.sync({}), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /nope/);
    return true;
  });
  server.close();
});
```

Create `sdk/test/index.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHub } = require('../src/index');

test('register + test produce a manifest with assertions', () => {
  const hub = createHub({ apiKey: 'k', targetBaseUrl: 'http://localhost:4000' });
  hub.register({ method: 'GET', path: '/users/:id', name: 'Get user' });
  hub.test('GET /users/:id', { status: 200 });
  const manifest = hub.manifest();
  assert.equal(manifest.requests.length, 1);
  assert.equal(manifest.requests[0].assertions[0].expected, '200');
  assert.equal(manifest.requests[0].url, 'http://localhost:4000/users/:id');
});

test('test() on an unknown route throws', () => {
  const hub = createHub({ apiKey: 'k' });
  assert.throws(() => hub.test('GET /missing', { status: 200 }), /unknown route/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sdk && node --test test/client.test.js test/index.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client.js`**

Create `sdk/src/client.js`:

```js
'use strict';

const { ApiHubError } = require('./errors');

function createClient(config) {
  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` };

  async function sync(manifest) {
    let res;
    try {
      res = await fetch(`${base}/api/sdk/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(config.timeoutMs || 5000),
      });
    } catch (cause) {
      throw new ApiHubError(`apihub sync failed: ${cause.message}`, { cause });
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new ApiHubError(`apihub sync failed: HTTP ${res.status}${body.error ? ` ${body.error}` : ''}`, {
        status: res.status,
        body,
      });
    }
    return body;
  }

  return { sync };
}

module.exports = { createClient };
```

- [ ] **Step 4: Implement `index.js`**

Create `sdk/src/index.js`:

```js
'use strict';

const { createConfig } = require('./config');
const { createClient } = require('./client');
const { buildManifest } = require('./manifest');
const { normalizeExpects } = require('./assertions');
const { ApiHubError, ApiHubConfigError } = require('./errors');

class ApiHub {
  constructor(options = {}) {
    this.config = createConfig(options);
    this.client = createClient(this.config);
    this.routes = [];
    this._synced = false;
  }

  register(route) {
    if (!route || !route.method || !route.path) {
      throw new ApiHubConfigError('register() requires { method, path }');
    }
    const method = String(route.method).toUpperCase();
    const path = String(route.path);
    const index = this.routes.findIndex((r) => r.method === method && r.path === path);
    const next = { ...route, method, path };
    if (index >= 0) this.routes[index] = { ...this.routes[index], ...next };
    else this.routes.push(next);
    return this;
  }

  test(key, expects) {
    const route = this.routes.find((r) => (r.key || `${r.method} ${r.path}`) === key);
    if (!route) {
      throw new ApiHubConfigError(`apihub.test: unknown route "${key}" — register the route before calling test()`);
    }
    route.assertions = normalizeExpects(expects);
    return this;
  }

  manifest() {
    return buildManifest(this.routes, this.config);
  }

  async sync() {
    const result = await this.client.sync(this.manifest());
    this._synced = true;
    return result;
  }

  // Non-blocking: never rejects; routes errors to config.onError when provided.
  syncSoon() {
    setImmediate(() => {
      this.sync().catch((err) => {
        if (typeof this.config.onError === 'function') this.config.onError(err);
      });
    });
    return this;
  }

  express(app, options = {}) {
    const { createExpressAdapter } = require('./adapters/express');
    return createExpressAdapter(this, app, options);
  }
}

function createHub(options = {}) {
  return new ApiHub(options);
}

function attach(app, options = {}) {
  const hub = new ApiHub(options);
  hub.express(app, options);
  return hub;
}

module.exports = { ApiHub, createHub, attach, ApiHubError, ApiHubConfigError };
```

- [ ] **Step 5: Add `index.d.ts`**

Create `sdk/src/index.d.ts`:

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface RouteInput {
  method: HttpMethod | string;
  path: string;
  key?: string;
  name?: string;
  folder?: string;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  bodyType?: string;
  bodyJson?: unknown;
  bodyText?: string | null;
  apiType?: string;
  assertions?: unknown[];
  sourceFile?: string | null;
}

export interface Expects {
  status?: number;
  json?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  responseTimeMs?: number;
}

export interface ApiHubOptions {
  apiKey?: string;
  baseUrl?: string;
  project?: string;
  workspace?: string;
  collection?: string;
  targetBaseUrl?: string;
  folder?: string | ((route: RouteInput) => string);
  structure?: Record<string, string>;
  include?: string[];
  exclude?: string[];
  autoSync?: boolean;
  prune?: boolean;
  timeoutMs?: number;
  onError?: (err: Error) => void;
}

export interface SyncResult {
  summary: {
    collectionId?: string;
    collections: { created: number };
    folders: { created: number; updated: number };
    requests: { created: number; updated: number; pruned: number };
  };
  projectId: string;
  collectionId: string;
}

export declare class ApiHub {
  constructor(options?: ApiHubOptions);
  register(route: RouteInput): this;
  test(key: string, expects: Expects): this;
  manifest(): unknown;
  sync(): Promise<SyncResult>;
  syncSoon(): this;
  express(app: unknown, options?: ApiHubOptions): this;
}

export declare function createHub(options?: ApiHubOptions): ApiHub;
export declare function attach(app: unknown, options?: ApiHubOptions): ApiHub;
export declare class ApiHubError extends Error {
  status?: number;
  body?: unknown;
}
export declare class ApiHubConfigError extends ApiHubError {}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd sdk && node --test test/client.test.js test/index.test.js`
Expected: `# pass 4`.

- [ ] **Step 7: Commit**

```bash
git add sdk/src/client.js sdk/src/index.js sdk/src/index.d.ts sdk/test/client.test.js sdk/test/index.test.js
git commit -m "feat(sdk): HTTP client and public hub API"
```

---

## Task 9: Express adapter

**Files:**
- Create: `sdk/src/adapters/express.js`
- Test: `sdk/test/express.test.js`

**Interfaces:**
- Consumes: `ApiHub`.
- Produces: `createExpressAdapter(hub, app, options) -> hub`; patches `app.{get,post,put,patch,delete,options,head,all}` and `app.listen` (auto-syncs when `hub.config.autoSync`).

- [ ] **Step 1: Write the failing test**

Create `sdk/test/express.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHub } = require('../src/index');

test('records routes registered after attach and ignores settings lookups', () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: false, targetBaseUrl: 'http://localhost:4000' });
  hub.express(app);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.post('/users', (req, res) => res.status(201).end());
  // Express's app.get(name) settings accessor must not be recorded as a route.
  app.get('env');
  const keys = hub.manifest().requests.map((r) => r.key).sort();
  assert.deepEqual(keys, ['GET /health', 'POST /users']);
});

test('respects include and exclude filters', () => {
  const app = express();
  const hub = createHub({
    apiKey: 'k',
    autoSync: false,
    include: ['/api'],
    exclude: ['/api/internal'],
  });
  hub.express(app);
  app.get('/api/users', (req, res) => res.end());
  app.get('/api/internal/health', (req, res) => res.end());
  app.get('/public', (req, res) => res.end());
  assert.deepEqual(hub.manifest().requests.map((r) => r.key), ['GET /api/users']);
});

test('autoSync triggers a sync when the server starts listening', async () => {
  const app = express();
  const hub = createHub({ apiKey: 'k', autoSync: true });
  hub.express(app);
  let synced = 0;
  hub.client = { sync: async () => { synced += 1; return { summary: {} }; } };
  app.get('/ping', (req, res) => res.end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  server.close();
  assert.equal(synced, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sdk && npm install --no-save express@4 && node --test test/express.test.js`
Expected: FAIL — `../src/adapters/express` not found.

- [ ] **Step 3: Implement `adapters/express.js`**

Create `sdk/src/adapters/express.js`:

```js
'use strict';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

function pathMatches(path, config) {
  const p = String(path);
  const include = config.include || [];
  const exclude = config.exclude || [];
  if (include.length && !include.some((prefix) => p.startsWith(prefix))) return false;
  if (exclude.some((prefix) => p.startsWith(prefix))) return false;
  return true;
}

function createExpressAdapter(hub, app, options = {}) {
  if (!app || typeof app !== 'function') {
    throw new TypeError('apihub.express(app): a valid Express app is required');
  }
  if (options.folder !== undefined) hub.config.folder = options.folder;
  if (options.name !== undefined) hub.config.name = options.name;

  for (const method of METHODS) {
    const original = app[method].bind(app);
    app[method] = function patched(path, ...handlers) {
      const isRoute =
        (typeof path === 'string' || Array.isArray(path)) &&
        handlers.some((h) => typeof h === 'function');
      if (isRoute) {
        const paths = Array.isArray(path) ? path : [path];
        for (const p of paths) {
          if (typeof p === 'string' && p.startsWith('/') && pathMatches(p, hub.config)) {
            hub.register({
              method: method === 'all' ? 'ALL' : method.toUpperCase(),
              path: p,
              name: typeof hub.config.name === 'function' ? hub.config.name({ method, path: p }) : undefined,
            });
          }
        }
      }
      return original(path, ...handlers);
    };
  }

  const originalListen = app.listen.bind(app);
  app.listen = function patchedListen(...args) {
    const server = originalListen(...args);
    if (hub.config.autoSync) hub.syncSoon();
    return server;
  };

  return hub;
}

module.exports = { createExpressAdapter, METHODS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sdk && node --test test/express.test.js`
Expected: `# pass 3`.

- [ ] **Step 5: Run the full SDK suite**

Run: `cd sdk && node --test "test/*.test.js"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add sdk/src/adapters/express.js sdk/test/express.test.js
git commit -m "feat(sdk): Express route-capture adapter with auto-sync on listen"
```

---

## Task 10: SDK CLI + publish readiness

**Files:**
- Create: `sdk/src/cli.js`, `sdk/bin/apihub-sdk.js`
- Test: `sdk/test/cli.test.js`

**Interfaces:**
- Consumes: a config module that exports an `ApiHub` instance (`module.exports = hub`).
- Produces: `runCli(argv, deps) -> Promise<number>`; bin `apihub-sdk sync --config ./apihub.config.cjs`.

- [ ] **Step 1: Write the failing test**

Create `sdk/test/cli.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCli } = require('../src/cli');

test('sync loads the config module and calls hub.sync()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apihub-cli-'));
  const file = path.join(dir, 'apihub.config.cjs');
  const calls = [];
  let output = '';
  const deps = {
    require: (p) => ({ sync: async () => { calls.push('sync'); return { summary: { requests: { created: 2 } } }; } }),
    log: (msg) => { output += `${msg}\n`; },
  };
  const code = await runCli(['sync', '--config', file], deps);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.match(output, /created: 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync without --config exits 2', async () => {
  let output = '';
  const code = await runCli(['sync'], { require: () => ({}), log: (m) => { output += m; } });
  assert.equal(code, 2);
  assert.match(output, /--config/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sdk && node --test test/cli.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli.js` and the bin**

Create `sdk/src/cli.js`:

```js
'use strict';

function parseArgs(argv) {
  const out = { command: argv[0] || null, config: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') out.config = argv[++i] || null;
  }
  return out;
}

async function runCli(argv = [], deps = {}) {
  const req = deps.require || require;
  const log = deps.log || ((msg) => process.stdout.write(`${msg}\n`));
  const { command, config } = parseArgs(argv);

  if (command !== 'sync') {
    log('Usage: apihub-sdk sync --config <path-to-config.cjs>');
    return command ? 2 : 1;
  }
  if (!config) {
    log('Usage: apihub-sdk sync --config <path-to-config.cjs>');
    return 2;
  }
  let hub;
  try {
    hub = req(require('path').resolve(config));
  } catch (err) {
    log(`Failed to load config: ${err.message}`);
    return 1;
  }
  if (!hub || typeof hub.sync !== 'function') {
    log('Config module must export an apihub hub with a sync() method');
    return 1;
  }
  try {
    const result = await hub.sync();
    const summary = result && result.summary ? result.summary : {};
    log(`Synced: requests created: ${summary.requests ? summary.requests.created : 0}, updated: ${summary.requests ? summary.requests.updated : 0}, folders created: ${summary.folders ? summary.folders.created : 0}`);
    return 0;
  } catch (err) {
    log(`Sync failed: ${err.message}`);
    return 1;
  }
}

module.exports = { runCli, parseArgs };
```

Create `sdk/bin/apihub-sdk.js`:

```js
#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli');

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
```

Then make the bin executable:

```bash
chmod +x sdk/bin/apihub-sdk.js
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sdk && node --test test/cli.test.js`
Expected: `# pass 2`.

- [ ] **Step 5: Verify publish readiness (do NOT actually publish)**

Run:

```bash
cd sdk && npm pack --dry-run && npm publish --dry-run
```

Expected: `npm pack` lists only `src/**`, `bin/**`, `README.md`, `LICENSE`, `package.json`; `npm publish --dry-run` prints `+ apihub-sdk@0.1.0` and does not publish. If npm requires auth even for dry-run, rely on `npm pack --dry-run` output as the readiness check.

- [ ] **Step 6: Run the whole SDK suite with a clean install of dev deps**

Run:

```bash
cd sdk && npm install --no-save express@4 && node --test "test/*.test.js"
```

Expected: all tests pass (`# fail 0`).

- [ ] **Step 7: Commit**

```bash
git add sdk/src/cli.js sdk/bin/apihub-sdk.js sdk/test/cli.test.js sdk/package.json
git commit -m "feat(sdk): sync CLI and publish-ready package metadata"
```

---

## Task 11: End-to-end verification + session docs

**Files:**
- Modify: `docs/SESSION.md` (§5 new entry)
- Modify: `session.md` (`## Current`, `## Roadmap` / round 5)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: recorded milestone + green verification gates.

- [ ] **Step 1: Run the whole backend API unit suite**

Run:

```bash
cd backend && npm run test:api:unit
```

Expected: all pass (includes the new `sdkManifest.test.cjs`).

- [ ] **Step 2: Run the new integration suite on a scratch DB**

Run:

```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub node --test tests/sdkSync.integration.test.cjs
```

Expected: `# pass 7` / `# fail 0`.

- [ ] **Step 3: Run frontend typecheck + unit tests**

Run:

```bash
cd frontend && npx tsc --noEmit && npm test
```

Expected: `tsc` silent; unit `# fail 0`.

- [ ] **Step 4: Run the SDK suite**

Run:

```bash
cd sdk && node --test "test/*.test.js"
```

Expected: `# fail 0`.

- [ ] **Step 5: Smoke-test the real endpoint through the running stack**

With backend on `:3001` and a bound key created via the UI (Task 5), run a temporary config file under `/tmp/opencode/apihub.config.cjs`:

```js
const express = require('/workspace/frontend/node_modules/express');
const { attach } = require('/workspace/sdk/src/index');
const app = express();
const hub = attach(app, {
  apiKey: process.env.APIHUB_API_KEY,
  baseUrl: 'http://127.0.0.1:3001',
  project: 'My API',
  collection: 'SDK Smoke',
  targetBaseUrl: 'http://localhost:4000',
  autoSync: false,
  folder: (r) => r.path.split('/').filter(Boolean)[0] || 'Root',
});
app.get('/smoke/ping', (req, res) => res.json({ ok: true }));
module.exports = hub;
```

Run:

```bash
cd /workspace/sdk && APIHUB_API_KEY=<bound-key> node bin/apihub-sdk.js sync --config /tmp/opencode/apihub.config.cjs
```

Expected: `Synced: requests created: 1, updated: 0, folders created: 1`. Re-running prints `created: 0, updated: 1`. Then delete the created "SDK Smoke" collection from the UI (do not delete other data).

- [ ] **Step 6: Record the session docs**

Add a `### 5.63 apihub-sdk + route sync (round 5) (pushed <hash>, 2026-09-10)` subsection to `docs/SESSION.md` §5 documenting: migration 037, `POST /api/sdk/sync`, bound tokens + `sdk` scope, the `sdk/` package, and the verification counts. Update `session.md`'s `## Current` and add a `## Pending — Round 5` block with the segment checklist marked `[x]`.

- [ ] **Step 7: Commit and push**

```bash
git add docs/SESSION.md session.md
git commit -m "docs(session): record round 5 apihub-sdk route sync"
git push origin master
```

---

## Self-Review

**Spec coverage**
- "JS library we publish" → `sdk/` package (Tasks 6–10), publish metadata + dry-run (Task 10 Step 5).
- "install library, set up api key (already have)" → personal/`sdk`-scope tokens extended in Task 4 + Task 5.
- "use workspace key or project key" → token binding columns (Task 1), `resolveProject` in `routes/sdk.js` (Task 3), UI selector (Task 5).
- "write a route (app.post) and add to linked account" → Express adapter (Task 9) + `POST /api/sdk/sync` (Task 3).
- "create request in linked account within project name, workspace configured" → manifest `project`/`workspace`/`collection` + workspace-bound key creates the project (Task 3 `resolveProject`).
- "configure structure so it creates full workspace with folders and sub folders" → `folder`/`structure` config + `foldersFromPaths` nesting (Task 7), integration test asserts `Users` → `Users/Admin` (Task 3).
- "everything easily configurable" → `createConfig` option/env table (Task 6) + README table.
- "configure test and other things from here" → `hub.test()` → assertions persisted and visible/editable in the app (Tasks 6, 8; integration assertion check in Task 3).
- "push whatever changes are leftout" → confirmed clean/pushed at `727224a`; no dangling work.

**Placeholder scan:** no `TBD`/`TODO`/"add error handling" steps; every code step contains complete code.

**Type consistency:** `external_key` uses `normalizeKey(method, path)` in both `sdk/src/manifest.js` (`normalizeKey`) and `backend/src/api/sdkManifest.js`; manifest folder `key` values match between `foldersFromPaths` and `nestFolders`; `createConfig` output keys (`apiKey`, `baseUrl`, `project`, `workspace`, `collection`, `targetBaseUrl`, `source`, `autoSync`, `include`, `exclude`, `timeoutMs`, `prune`, `onError`) match every consumer (`client.js`, `index.js`, `adapters/express.js`).

**Known v1 limitations (documented, not bugs):** the Express adapter captures routes registered on the app directly (not nested `express.Router()` instances) — use `hub.register()` for those; `resolveCollection`/upsert helpers use the pool rather than the route's transaction client, which is safe because syncs are idempotent.
