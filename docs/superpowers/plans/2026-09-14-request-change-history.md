# Request Change History (diff + rollback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an append-only, author-attributed revision of every stored-request save, expose a per-request git-style diff, and allow an editor to roll a request back to any earlier revision — with every other user in the workspace seeing the new state live.

**Architecture:** A new `request_revisions` table stores the post-change request snapshot (camelCase) plus the field-level `{field, from, to}` diff. The existing `PUT /api/requests/:id` and `POST /api/requests` handlers in `content.js` write a revision inside the same transaction as the request write; rollback applies a stored snapshot and writes a new `rollback` revision. Reads/rollback live in a new `requestRevisions.js` router mounted at `/api`. The frontend adds a self-contained `RequestHistoryPanel` as a new "History" tab in `RequestConfigurator`, refreshing on the existing realtime `entity:updated` event and calling `reloadActiveRequest()` after a rollback.

**Tech Stack:** Node 18 / Express 5 / PostgreSQL 15 (jsonb), `node:test` (`.test.cjs` unit + `.integration.test.cjs`), Next.js 14 / React 18 / TypeScript, `node --test` for FE helper units, CSS modules.

## Global Constraints

- Node floor is `>=18.0.0`. Do not add dependencies.
- Migrations are append-only and replayed by filename-sorted order in the test harness: the new file MUST be named `db/migrations/046_request_revisions.sql`.
- `api_requests` has NO `workspace_id`, `project_id`, or timestamps. Resolve scope via `collections.project_id -> projects.workspace_id`.
- Revision snapshots use the camelCase shape (keys equal to `collabDiff.COMPARED_FIELDS`): `name, method, url, folderId, headers, queryParams, bodyType, bodyJson, bodyText, bodyParts, apiType, formula, assertions`.
- Backend unit tests: `cd backend && npm run test:api:unit`. Integration: `cd backend && npm run test:api` (runs `node --test tests/*.integration.test.cjs` with `ALLOW_SELF_SIGNUP=1`). The integration suite needs the scratch Postgres on port 5441 in this environment; run targeted files with `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/<file>`.
- Frontend unit tests: `cd frontend && npm test` (node test runner over `src/lib/__tests__/*.test.cjs`); typecheck with `cd frontend && npx tsc --noEmit`.
- FE test files MUST be `.cjs` and may only `require()` CommonJS `.js` helpers (no `.ts`/`.tsx`). Put testable logic in `frontend/src/lib/*.js` with `module.exports`.
- Never stage `docs/superpowers/`, `.superpowers/`, or `frontend/tsconfig.tsbuildinfo`. Never `git add -A`.
- Commit messages: Conventional Commits; every commit ends with the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`.
- Editors (`EDITOR`+) write/roll back; any project reader can view history.
- Realtime: reuse the existing `entity:updated` event (no new event type).

---

## File Structure

**Create**
- `db/migrations/046_request_revisions.sql` — the history table.
- `backend/src/api/requestSnapshot.js` — canonical SELECT column list + camelCase serializer.
- `backend/src/api/routes/requestRevisions.js` — list / detail / rollback routes.
- `backend/src/api/__tests__/requestSnapshot.test.cjs` — serializer unit tests.
- `backend/src/api/__tests__/collabDiff.test.cjs` — `changedFields` unit tests.
- `backend/tests/requestRevisions.integration.test.cjs` — record/read/rollback integration tests.
- `frontend/src/lib/requestHistory.js` — pure formatting helpers (CommonJS).
- `frontend/src/lib/__tests__/requestHistory.test.cjs` — helper unit tests.
- `frontend/src/components/request/RequestHistoryPanel.tsx` — the panel.
- `frontend/src/components/request/requestHistory.module.css` — panel styles.

**Modify**
- `backend/src/api/collabDiff.js` — export `changedFields`.
- `backend/src/api/routes/content.js` — write revisions on create / update / duplicate.
- `backend/src/api/server.js` — mount the revisions router.
- `frontend/src/lib/api.ts` — revision types + `requestHistoryApi`.
- `frontend/src/lib/types.ts` — add `'history'` to `activeRequestTab`.
- `frontend/src/components/RequestConfigurator.tsx` — History tab + panel mount.
- `docs/FEATURES.md`, `session_v2.md` — docs.

---

### Task 1: History table, snapshot serializer, and exported field diff

**Files:**
- Create: `db/migrations/046_request_revisions.sql`
- Create: `backend/src/api/requestSnapshot.js`
- Create: `backend/src/api/__tests__/requestSnapshot.test.cjs`
- Create: `backend/src/api/__tests__/collabDiff.test.cjs`
- Modify: `backend/src/api/collabDiff.js:147` (export `changedFields`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `requestSnapshot.REQUEST_SELECT` — a SQL fragment string of comma-separated request columns.
  - `requestSnapshot.serializeRequest(row) -> object|null` — camelCase snapshot (keys exactly `collabDiff.COMPARED_FIELDS`).
  - `collabDiff.changedFields(from, to) -> Array<{field, from, to}>` (now exported).

- [ ] **Step 1: Write the failing serializer + diff unit tests**

Create `backend/src/api/__tests__/requestSnapshot.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serializeRequest, REQUEST_SELECT } = require('../requestSnapshot');

test('serializeRequest maps snake_case columns to the camelCase snapshot shape', () => {
  const row = {
    id: 'r1',
    name: 'Get user',
    method: 'GET',
    url: 'https://example.com/users',
    headers: [{ key: 'A', value: '1', enabled: true }],
    query_params: [{ key: 'q', value: 'x', enabled: true }],
    body_type: 'JSON',
    body_json: '{"a":1}',
    body_text: null,
    body_parts: [],
    api_type: 'REST',
    folder_id: null,
    formula: '',
    assertions: [],
  };
  assert.deepEqual(serializeRequest(row), {
    id: 'r1',
    name: 'Get user',
    method: 'GET',
    url: 'https://example.com/users',
    headers: [{ key: 'A', value: '1', enabled: true }],
    queryParams: [{ key: 'q', value: 'x', enabled: true }],
    bodyType: 'JSON',
    bodyJson: '{"a":1}',
    bodyText: null,
    bodyParts: [],
    apiType: 'REST',
    folderId: null,
    formula: '',
    assertions: [],
  });
});

test('serializeRequest applies defaults for null jsonb columns and passes through null', () => {
  assert.equal(serializeRequest(null), null);
  const s = serializeRequest({ id: 'r2', headers: null, query_params: null, body_parts: null, assertions: null });
  assert.deepEqual(s.headers, []);
  assert.deepEqual(s.queryParams, []);
  assert.deepEqual(s.bodyParts, []);
  assert.deepEqual(s.assertions, []);
  assert.equal(s.name, undefined);
  assert.equal(s.folderId, null);
  assert.equal(s.formula, '');
});

test('REQUEST_SELECT lists the columns serializeRequest reads', () => {
  for (const col of ['id', 'name', 'method', 'url', 'headers', 'query_params', 'body_type',
    'body_json', 'body_text', 'body_parts', 'api_type', 'folder_id', 'formula', 'assertions']) {
    assert.ok(REQUEST_SELECT.includes(col), `missing ${col}`);
  }
});
```

Create `backend/src/api/__tests__/collabDiff.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changedFields, stableStringify } = require('../collabDiff');

test('changedFields reports only fields whose value changed', () => {
  const before = { name: 'A', url: 'https://old', method: 'GET' };
  const after = { name: 'A', url: 'https://new', method: 'GET' };
  assert.deepEqual(changedFields(before, after), [
    { field: 'url', from: 'https://old', to: 'https://new' },
  ]);
});

test('changedFields ignores object key order and deep-equal arrays', () => {
  const before = { headers: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] };
  const after = { headers: [{ value: '2', key: 'B' }, { value: '1', key: 'A' }] };
  assert.deepEqual(changedFields(before, after), []);
});

test('changedFields returns [] when nothing changed and normalises undefined to null', () => {
  assert.deepEqual(changedFields({ name: 'A' }, { name: 'A' }), []);
  assert.deepEqual(changedFields({}, { formula: '' }), [
    { field: 'formula', from: null, to: '' },
  ]);
});

test('stableStringify sorts keys so equivalent objects compare equal', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/api/__tests__/requestSnapshot.test.cjs src/api/__tests__/collabDiff.test.cjs`
Expected: FAIL — `Cannot find module '../requestSnapshot'` and `changedFields is not a function`.

- [ ] **Step 3: Create the serializer module**

Create `backend/src/api/requestSnapshot.js`:

```js
'use strict';

// ============================================================================
// requestSnapshot — the canonical camelCase shape of a stored request.
//
// The keys match collabDiff.COMPARED_FIELDS so the same field diff works for
// per-request history and for collection version snapshots. api_requests has
// no workspace/project columns; callers resolve those separately.
// ============================================================================

const REQUEST_COLUMNS = [
  'id',
  'name',
  'method',
  'url',
  'headers',
  'query_params',
  'body_type',
  'body_json',
  'body_text',
  'body_parts',
  'api_type',
  'folder_id',
  'formula',
  'assertions',
];

// SQL column list for SELECTs that feed serializeRequest().
const REQUEST_SELECT = REQUEST_COLUMNS.join(', ');

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    url: row.url,
    headers: row.headers || [],
    queryParams: row.query_params || [],
    bodyType: row.body_type,
    bodyJson: row.body_json ?? null,
    bodyText: row.body_text ?? null,
    bodyParts: row.body_parts || [],
    apiType: row.api_type,
    folderId: row.folder_id ?? null,
    formula: row.formula || '',
    assertions: row.assertions || [],
  };
}

module.exports = { REQUEST_COLUMNS, REQUEST_SELECT, serializeRequest };
```

- [ ] **Step 4: Export `changedFields` from collabDiff**

In `backend/src/api/collabDiff.js`, replace the export line:

```js
module.exports = { diffSnapshots, stableStringify, COMPARED_FIELDS, changedFields };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && node --test src/api/__tests__/requestSnapshot.test.cjs src/api/__tests__/collabDiff.test.cjs`
Expected: PASS (all subtests).

- [ ] **Step 6: Create the migration**

Create `db/migrations/046_request_revisions.sql`:

```sql
-- --------------------------------------------- Request edit revisions (history)
-- Append-only per-request edit history: who changed what, before/after, and
-- rollbacks. snapshot is the post-change request in the camelCase shape from
-- backend/src/api/requestSnapshot.js; changed_fields is [{field, from, to}].
CREATE TABLE request_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
  collection_id    uuid NOT NULL REFERENCES collections(id)  ON DELETE CASCADE,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  revision_number  integer NOT NULL,
  change_kind      text NOT NULL,
  snapshot         jsonb NOT NULL,
  changed_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
  rolled_back_from uuid REFERENCES request_revisions(id) ON DELETE SET NULL,
  created_by       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_revisions_kind_check CHECK (change_kind IN ('create', 'update', 'rollback')),
  UNIQUE (request_id, revision_number)
);

CREATE INDEX request_revisions_request_idx ON request_revisions (request_id, revision_number DESC);
CREATE INDEX request_revisions_author_idx  ON request_revisions (created_by);

COMMENT ON TABLE request_revisions IS
  'Append-only request edit history; snapshot is the post-change request, changed_fields is [{field,from,to}].';
COMMENT ON COLUMN request_revisions.rolled_back_from IS
  'For change_kind=rollback, the revision whose snapshot was restored.';

-- Immutable: readers only select, writers only insert.
GRANT SELECT, INSERT ON request_revisions TO app_user;

ALTER TABLE request_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_revisions_select ON request_revisions FOR SELECT
  USING (app.workspace_readable(workspace_id));
CREATE POLICY request_revisions_insert ON request_revisions FOR INSERT
  WITH CHECK (app.can_mutate_workspace(workspace_id));
```

- [ ] **Step 7: Apply the migration to the dev database**

Run:
```bash
cd /workspace && PGUSER=postgres PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 psql -d apihub -v ON_ERROR_STOP=1 -f db/migrations/046_request_revisions.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX` x2, `COMMENT` x2, `GRANT`, `ALTER TABLE`, `CREATE POLICY` x2 — no errors.

- [ ] **Step 8: Run the full backend unit suite**

Run: `cd backend && npm run test:api:unit`
Expected: PASS (previous 104 + the new tests).

- [ ] **Step 9: Commit**

```bash
cd /workspace && git add db/migrations/046_request_revisions.sql backend/src/api/requestSnapshot.js backend/src/api/collabDiff.js backend/src/api/__tests__/requestSnapshot.test.cjs backend/src/api/__tests__/collabDiff.test.cjs
git commit -m "feat(history): add request revision table and snapshot serializer

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 2: Record revisions on create / update / duplicate, and add read endpoints

**Files:**
- Create: `backend/src/api/routes/requestRevisions.js`
- Create: `backend/tests/requestRevisions.integration.test.cjs`
- Modify: `backend/src/api/routes/content.js` (imports; `POST /requests` ~503-547; `PUT /requests/:requestId` 598-674; `POST /requests/:requestId/duplicate` 698-748)
- Modify: `backend/src/api/server.js` (require + mount)

**Interfaces:**
- Consumes: `requestSnapshot.REQUEST_SELECT`, `requestSnapshot.serializeRequest`, `collabDiff.changedFields` (Task 1).
- Produces:
  - `GET /api/requests/:requestId/revisions` → `{ revisions: RevisionMeta[] }` (newest first).
  - `GET /api/requests/:requestId/revisions/:revisionId` → `{ revision: RevisionMeta & { snapshot } }`.
  - HTTP metadata shape: `{ id, requestId, revisionNumber, changeKind, changedFields, rolledBackFrom, createdBy: { id, name }, createdAt }`.
  - `content.js` records a `create` revision on `POST /requests` and duplicate, and an `update` revision on `PUT /requests/:id` whenever `changedFields` is non-empty. `PUT` publishes `entity:updated` only when something actually changed.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/requestRevisions.integration.test.cjs`:

```js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, makeClient } = require('./support/harness.cjs');

let app;
let user;

before(async () => {
  app = await startApp();
  user = await signupAndLogin(app.base, { email: 'history@example.com', password: 'password12' });
  const ws = await user.client.api('POST', '/api/workspaces', { name: 'History WS' });
  const content = await user.client.api('GET', `/api/workspaces/${ws.json.workspace.id}/content`);
  const projectId = content.json.projects[0].id;
  const col = await user.client.api('POST', '/api/collections', { projectId, name: 'History collection' });
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Tracked',
    method: 'GET',
    url: 'https://example.com/a',
  });
  user.projectId = projectId;
  user.collectionId = col.json.collection.id;
  user.requestId = req.json.request.id;
});

after(async () => {
  if (app) await app.close();
});

test('creating a request records a create revision by its author', async () => {
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.status, 200);
  assert.equal(res.json.revisions.length, 1);
  const [first] = res.json.revisions;
  assert.equal(first.changeKind, 'create');
  assert.equal(first.revisionNumber, 1);
  assert.equal(first.createdBy.id, user.id);
  assert.deepEqual(first.changedFields, []);
});

test('updating a request records an update revision with a field diff', async () => {
  const put = await user.client.api('PUT', `/api/requests/${user.requestId}`, {
    url: 'https://example.com/b',
    headers: [{ key: 'X-Test', value: '1', enabled: true }],
  });
  assert.equal(put.status, 200);

  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.json.revisions[0].changeKind, 'update');
  assert.equal(res.json.revisions[0].revisionNumber, 2);
  const fields = res.json.revisions[0].changedFields;
  const url = fields.find((f) => f.field === 'url');
  assert.deepEqual(url, { field: 'url', from: 'https://example.com/a', to: 'https://example.com/b' });
  assert.ok(fields.some((f) => f.field === 'headers'));
});

test('a no-op save records no revision', async () => {
  await user.client.api('PUT', `/api/requests/${user.requestId}`, { url: 'https://example.com/b' });
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.json.revisions.length, 2);
});

test('revision detail returns the stored snapshot', async () => {
  const list = await user.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  const createId = list.json.revisions.find((r) => r.changeKind === 'create').id;
  const res = await user.client.api('GET', `/api/requests/${user.requestId}/revisions/${createId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.revision.snapshot.url, 'https://example.com/a');
});

test('a non-member cannot read another project history', async () => {
  const outsider = await signupAndLogin(app.base, { email: 'outsider@example.com', password: 'password12' });
  const res = await outsider.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(res.status, 403);
});

test('a viewer may read but not roll back', async () => {
  const viewer = await signupAndLogin(app.base, { email: 'viewer@example.com', password: 'password12' });
  await user.client.api('POST', `/api/projects/${user.projectId}/members`, {
    email: 'viewer@example.com',
    role: 'VIEWER',
  });
  const list = await viewer.client.api('GET', `/api/requests/${user.requestId}/revisions`);
  assert.equal(list.status, 200);
  const revId = list.json.revisions[0].id;
  const rollback = await viewer.client.api('POST', `/api/requests/${user.requestId}/revisions/${revId}/rollback`);
  assert.equal(rollback.status, 403);
});

test('unknown request ids return 404', async () => {
  const res = await user.client.api('GET', '/api/requests/00000000-0000-0000-0000-000000000000/revisions');
  assert.equal(res.status, 404);
});
```

Note: if the members endpoint or role name differs, adjust to the repo's actual access-request/member route found in `backend/tests/accessRequests.integration.test.cjs`; the important assertion is 200-read / 403-write.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/requestRevisions.integration.test.cjs
```
Expected: FAIL — `GET /api/requests/:id/revisions` returns 404 (no route).

- [ ] **Step 3: Create the revisions router**

Create `backend/src/api/routes/requestRevisions.js`:

```js
'use strict';

// ============================================================================
// Request edit history (per-request revisions) + rollback.
//
//   GET  /api/requests/:requestId/revisions
//        -> { revisions: [meta] }                       (any project reader)
//   GET  /api/requests/:requestId/revisions/:revisionId
//        -> { revision: { ...meta, snapshot } }         (any project reader)
//   POST /api/requests/:requestId/revisions/:revisionId/rollback
//        -> { request, revision }                       (EDITOR+)
//
// Revisions are written by content.js on create/update; this router reads them
// and performs rollback (which writes a new 'rollback' revision and publishes
// entity:updated so every open editor reloads).
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { REQUEST_SELECT, serializeRequest } = require('../requestSnapshot');
const { changedFields } = require('../collabDiff');
const { publish, roomKey } = require('../realtime');

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const REVISION_META_SQL = `
  SELECT r.id, r.request_id, r.revision_number, r.change_kind, r.changed_fields,
         r.rolled_back_from, r.created_by, r.created_at, u.name AS created_by_name
    FROM request_revisions r
    JOIN users u ON u.id = r.created_by`;

function serializeRevisionMeta(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    revisionNumber: row.revision_number,
    changeKind: row.change_kind,
    changedFields: row.changed_fields || [],
    rolledBackFrom: row.rolled_back_from ?? null,
    createdBy: { id: row.created_by, name: row.created_by_name ?? null },
    createdAt: row.created_at,
  };
}

// Resolve a request's project + workspace + collection in one read.
async function scopeOfRequest(requestId) {
  const { rows } = await query(
    `SELECT ar.collection_id, c.project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function readAccess(userId, projectId) {
  return Boolean(await getProjectAccess(userId, projectId));
}

async function writeAccess(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

async function revisionRow(requestId, revisionId) {
  const { rows } = await query(
    `${REVISION_META_SQL} WHERE r.id = $1 AND r.request_id = $2`,
    [revisionId, requestId]
  );
  return rows[0] || null;
}

// GET list
router.get('/requests/:requestId/revisions', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    if (!isUuid(requestId)) return res.status(404).json({ error: 'Request not found' });
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await readAccess(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const { rows } = await query(
      `${REVISION_META_SQL} WHERE r.request_id = $1 ORDER BY r.revision_number DESC`,
      [requestId]
    );
    res.json({ revisions: rows.map(serializeRevisionMeta) });
  } catch (err) {
    next(err);
  }
});

// GET detail
router.get('/requests/:requestId/revisions/:revisionId', async (req, res, next) => {
  try {
    const { requestId, revisionId } = req.params;
    if (!isUuid(requestId) || !isUuid(revisionId)) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await readAccess(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const row = await revisionRow(requestId, revisionId);
    if (!row) return res.status(404).json({ error: 'Revision not found' });
    const { rows } = await query(`SELECT snapshot FROM request_revisions WHERE id = $1`, [revisionId]);
    res.json({ revision: { ...serializeRevisionMeta(row), snapshot: rows[0]?.snapshot ?? null } });
  } catch (err) {
    next(err);
  }
});

const APPLY_SNAPSHOT_SQL = `
  UPDATE api_requests
     SET name = $2, method = $3, url = $4, headers = $5::jsonb, query_params = $6::jsonb,
         body_type = $7, body_json = $8::jsonb, body_text = $9, body_parts = $10::jsonb,
         api_type = $11, folder_id = $12, formula = $13, assertions = $14::jsonb
   WHERE id = $1`;

function snapshotParams(requestId, s) {
  return [
    requestId,
    s.name,
    s.method,
    s.url,
    JSON.stringify(s.headers ?? []),
    JSON.stringify(s.queryParams ?? []),
    s.bodyType,
    s.bodyJson === null || s.bodyJson === undefined ? null : JSON.stringify(s.bodyJson),
    s.bodyText ?? null,
    JSON.stringify(s.bodyParts ?? []),
    s.apiType,
    s.folderId ?? null,
    s.formula ?? '',
    JSON.stringify(s.assertions ?? []),
  ];
}

// POST rollback
router.post('/requests/:requestId/revisions/:revisionId/rollback', async (req, res, next) => {
  try {
    const { requestId, revisionId } = req.params;
    if (!isUuid(requestId) || !isUuid(revisionId)) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await writeAccess(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const target = await revisionRow(requestId, revisionId);
    if (!target) return res.status(404).json({ error: 'Revision not found' });
    const targetSnap = (await query(`SELECT snapshot FROM request_revisions WHERE id = $1`, [revisionId]))
      .rows[0].snapshot;

    const client = await pool.connect();
    let before;
    let after;
    let changed;
    let newRevision;
    try {
      await client.query('BEGIN');
      const { rows: pre } = await client.query(
        `SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      if (!pre[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }
      before = serializeRequest(pre[0]);
      await client.query(APPLY_SNAPSHOT_SQL, snapshotParams(requestId, targetSnap));
      const { rows: post } = await client.query(`SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1`, [requestId]);
      after = serializeRequest(post[0]);
      changed = changedFields(before, after);
      const { rows: inserted } = await client.query(
        `INSERT INTO request_revisions
           (request_id, collection_id, workspace_id, project_id, revision_number,
            change_kind, snapshot, changed_fields, rolled_back_from, created_by)
         SELECT $1, $2, $3, $4, COALESCE(MAX(revision_number), 0) + 1,
                'rollback', $5::jsonb, $6::jsonb, $7, $8
           FROM request_revisions
          WHERE request_id = $1
         RETURNING id, revision_number, change_kind, changed_fields, rolled_back_from, created_by, created_at`,
        [
          requestId,
          scope.collection_id,
          scope.workspace_id,
          scope.project_id,
          JSON.stringify(after),
          JSON.stringify(changed),
          revisionId,
          req.user.id,
        ]
      );
      newRevision = { ...inserted[0], created_by_name: req.user.name || null };
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }

    publish(roomKey('request', requestId), {
      type: 'entity:updated',
      entityType: 'request',
      entityId: requestId,
      by: { id: req.user.id, name: req.user.name || null },
    });

    res.json({
      request: { id: requestId, name: after.name },
      revision: serializeRevisionMeta(newRevision),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Record revisions in content.js**

In `backend/src/api/routes/content.js` add to the requires near the top:

```js
const { REQUEST_SELECT, serializeRequest } = require('../requestSnapshot');
const { changedFields } = require('../collabDiff');
```

Add two helpers near the other local helpers (after `workspaceOfCollection`, ~line 72):

```js
// Append a revision row. Callers inside a transaction pass `exec = client.query`
// so the row lock on api_requests serializes revision_number.
async function insertRevision(exec, { requestId, scope, kind, snapshot, diff, rolledBackFrom, userId }) {
  const run = exec || query;
  await run(
    `INSERT INTO request_revisions
       (request_id, collection_id, workspace_id, project_id, revision_number,
        change_kind, snapshot, changed_fields, rolled_back_from, created_by)
     SELECT $1, $2, $3, $4, COALESCE(MAX(revision_number), 0) + 1,
            $5, $6::jsonb, $7::jsonb, $8, $9
       FROM request_revisions
      WHERE request_id = $1`,
    [
      requestId,
      scope.collection_id,
      scope.workspace_id,
      scope.project_id,
      kind,
      JSON.stringify(snapshot),
      JSON.stringify(diff || []),
      rolledBackFrom || null,
      userId,
    ]
  );
}
```

In `POST /requests` (handler starting line 503), after the successful insert and before `res.status(201)`, record the create revision. Replace the `const { rows } = await query(...)` + response block with:

```js
    const requestName = await uniqueRequestName(collectionId, folderId || null, name, null);
    const { rows } = await query(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type, assertions, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, method, url, api_type, collection_id, folder_id`,
      [
        collectionId,
        requestName,
        HTTP_METHODS.includes(method) ? method : 'GET',
        url || '',
        API_TYPES.includes(apiType) ? apiType : 'REST',
        JSON.stringify([]),
        JSON.stringify([]),
        'NONE',
        JSON.stringify([]),
        folderId || null,
      ]
    );
    const created = rows[0];
    const workspaceId = await workspaceOfCollection(collectionId);
    const { rows: fullRows } = await query(`SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1`, [created.id]);
    await insertRevision(null, {
      requestId: created.id,
      scope: { collection_id: collectionId, workspace_id: workspaceId, project_id: projectId },
      kind: 'create',
      snapshot: serializeRequest(fullRows[0]),
      diff: [],
      userId: req.user.id,
    });
    res.status(201).json({ request: created });
```

In `POST /requests/:requestId/duplicate` (handler ~698), after the `INSERT ... RETURNING` succeeds (variable `created`), before `res.status(201)`:

```js
    const dupWorkspaceId = await workspaceOfCollection(source.collection_id);
    const { rows: dupFull } = await query(`SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1`, [created[0].id]);
    await insertRevision(null, {
      requestId: created[0].id,
      scope: { collection_id: source.collection_id, workspace_id: dupWorkspaceId, project_id: projectId },
      kind: 'create',
      snapshot: serializeRequest(dupFull[0]),
      diff: [],
      userId: req.user.id,
    });
```

(`projectId` is already resolved earlier in the duplicate handler.)

Now replace the entire `PUT /requests/:requestId` handler body (lines 598-674) with the transactional version. Keep the pre-checks (404, 403, folder validation, unique name) and the `fields`/`sets`/`params` construction exactly as-is, then:

```js
    let fresh;
    let changed = [];
    if (sets.length) {
      const projectWorkspaceId = await workspaceOfCollection(current.collection_id);
      const sc = { collection_id: current.collection_id, workspace_id: projectWorkspaceId, project_id: projectId };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: preRows } = await client.query(
          `SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1 FOR UPDATE`,
          [requestId]
        );
        const before = serializeRequest(preRows[0]);
        await client.query(`UPDATE api_requests SET ${sets.join(', ')} WHERE id = $1`, params);
        const { rows: postRows } = await client.query(`SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1`, [requestId]);
        const after = serializeRequest(postRows[0]);
        changed = changedFields(before, after);
        if (changed.length) {
          await insertRevision((sql, p) => client.query(sql, p), {
            requestId,
            scope: sc,
            kind: 'update',
            snapshot: after,
            diff: changed,
            userId: req.user.id,
          });
        }
        fresh = postRows[0];
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    } else {
      const { rows } = await query(
        `SELECT id, name, method, url, api_type, collection_id, folder_id FROM api_requests WHERE id = $1`,
        [requestId]
      );
      fresh = rows[0];
    }
    if (changed.length) {
      publish(roomKey('request', requestId), {
        type: 'entity:updated',
        entityType: 'request',
        entityId: requestId,
        by: { id: req.user.id, name: req.user.name || null },
      });
    }
    res.json({
      request: {
        id: fresh.id,
        name: fresh.name,
        method: fresh.method,
        url: fresh.url,
        api_type: fresh.api_type,
        collection_id: fresh.collection_id,
        folder_id: fresh.folder_id,
      },
    });
```

This replaces the previous `if (sets.length) { await query(UPDATE) }`, the `fresh` SELECT, the `if (sets.length) publish`, and the `res.json`. Publish is now gated on a real field change.

- [ ] **Step 5: Mount the router**

In `backend/src/api/server.js`, add the require next to the other route requires (near line 31):

```js
const requestRevisionRoutes = require('./routes/requestRevisions');
```

and mount it next to the content router (near line 124):

```js
  app.use('/api', requestRevisionRoutes);
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run:
```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/requestRevisions.integration.test.cjs
```
Expected: PASS (all subtests). If the viewer/member setup route differs, fix the test setup to the real route (do not weaken the access assertions).

- [ ] **Step 7: Run adjacent integration suites to catch regressions**

Run:
```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/realtime.integration.test.cjs tests/duplicate.integration.test.cjs tests/apiAuth.integration.test.cjs
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /workspace && git add backend/src/api/routes/requestRevisions.js backend/src/api/routes/content.js backend/src/api/server.js backend/tests/requestRevisions.integration.test.cjs
git commit -m "feat(history): record and list per-request edit revisions

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 3: Rollback endpoint

**Files:**
- Modify: `backend/tests/requestRevisions.integration.test.cjs` (add rollback tests)
- (Route already implemented in Task 2's `requestRevisions.js`; this task adds its tests and verifies behavior.)

**Interfaces:**
- Consumes: `POST /api/requests/:requestId/revisions/:revisionId/rollback` (Task 2).
- Produces: after rollback, the request state equals the target snapshot; a new `rollback` revision exists with `rolledBackFrom` set; other requests' revisions are unaffected.

- [ ] **Step 1: Add the failing rollback tests**

Append to `backend/tests/requestRevisions.integration.test.cjs` (create its own request so ordering is independent):

```js
test('rollback restores an earlier snapshot and records a rollback revision', async () => {
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId,
    name: 'Rollback me',
    method: 'GET',
    url: 'https://example.com/v1',
  });
  const id = req.json.request.id;
  await user.client.api('PUT', `/api/requests/${id}`, { url: 'https://example.com/v2' });

  const list = await user.client.api('GET', `/api/requests/${id}/revisions`);
  const v1 = list.json.revisions.find((r) => r.revisionNumber === 1);

  const rb = await user.client.api('POST', `/api/requests/${id}/revisions/${v1.id}/rollback`);
  assert.equal(rb.status, 200);
  assert.equal(rb.json.revision.changeKind, 'rollback');
  assert.equal(rb.json.revision.rolledBackFrom, v1.id);

  const after = await user.client.api('GET', `/api/requests/${id}`);
  assert.equal(after.json.request.url, 'https://example.com/v1');

  const list2 = await user.client.api('GET', `/api/requests/${id}/revisions`);
  assert.equal(list2.json.revisions[0].changeKind, 'rollback');
  const fields = list2.json.revisions[0].changedFields;
  assert.deepEqual(fields.find((f) => f.field === 'url'), {
    field: 'url',
    from: 'https://example.com/v2',
    to: 'https://example.com/v1',
  });
});

test('rolling back to an unknown revision returns 404', async () => {
  const req = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId,
    name: 'Bad rollback',
    method: 'GET',
    url: 'https://example.com/x',
  });
  const res = await user.client.api(
    'POST',
    `/api/requests/${req.json.request.id}/revisions/00000000-0000-0000-0000-000000000000/rollback`
  );
  assert.equal(res.status, 404);
});

test('a revision from a different request cannot be rolled back onto this request', async () => {
  const a = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId, name: 'A', method: 'GET', url: 'https://example.com/a',
  });
  const b = await user.client.api('POST', '/api/requests', {
    collectionId: user.collectionId, name: 'B', method: 'GET', url: 'https://example.com/b',
  });
  const listA = await user.client.api('GET', `/api/requests/${a.json.request.id}/revisions`);
  const revA = listA.json.revisions[0].id;
  const res = await user.client.api('POST', `/api/requests/${b.json.request.id}/revisions/${revA}/rollback`);
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the tests**

Run:
```bash
cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/requestRevisions.integration.test.cjs
```
Expected: PASS if Task 2's rollback route is correct; otherwise fix `requestRevisions.js` until green. Do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
cd /workspace && git add backend/tests/requestRevisions.integration.test.cjs
git commit -m "test(history): cover request rollback and cross-request isolation

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 4: Frontend API client and pure formatting helpers

**Files:**
- Modify: `frontend/src/lib/api.ts` (append types + `requestHistoryApi`)
- Create: `frontend/src/lib/requestHistory.js`
- Create: `frontend/src/lib/__tests__/requestHistory.test.cjs`

**Interfaces:**
- Consumes: the HTTP shapes from Task 2/3.
- Produces:
  - `requestHistoryApi.list(requestId)`, `.detail(requestId, revisionId)`, `.rollback(requestId, revisionId)`.
  - Types `RequestChangedField`, `RequestRevisionMeta`, `RequestRevision`.
  - `requestHistory.js`: `fieldLabel(field)`, `formatValue(value)`, `revisionSummary(meta)`, `formatChange(change)`.

- [ ] **Step 1: Write the failing helper tests**

Create `frontend/src/lib/__tests__/requestHistory.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fieldLabel, formatValue, revisionSummary, formatChange } = require('../requestHistory');

test('fieldLabel maps known fields to human labels and passes unknown through', () => {
  assert.equal(fieldLabel('url'), 'URL');
  assert.equal(fieldLabel('queryParams'), 'Query params');
  assert.equal(fieldLabel('mystery'), 'mystery');
});

test('formatValue renders strings, empties, nulls and objects', () => {
  assert.equal(formatValue('GET'), 'GET');
  assert.equal(formatValue(''), '(empty)');
  assert.equal(formatValue(null), '—');
  assert.equal(formatValue(undefined), '—');
  assert.equal(formatValue(false), 'false');
  assert.equal(formatValue([{ key: 'A', value: '1' }]), '[{"key":"A","value":"1"}]');
});

test('revisionSummary describes create, rollback and changed fields', () => {
  assert.equal(revisionSummary({ changeKind: 'create', changedFields: [] }), 'Created');
  assert.equal(revisionSummary({ changeKind: 'rollback', changedFields: [] }), 'Restored an earlier version');
  assert.equal(
    revisionSummary({ changeKind: 'update', changedFields: [{ field: 'url' }, { field: 'headers' }] }),
    'URL, Headers'
  );
  assert.equal(
    revisionSummary({
      changeKind: 'update',
      changedFields: [{ field: 'url' }, { field: 'headers' }, { field: 'bodyJson' }, { field: 'formula' }],
    }),
    'URL, Headers, Body (JSON) +1 more'
  );
  assert.equal(revisionSummary({ changeKind: 'update', changedFields: [] }), 'No field changes');
});

test('formatChange returns labelled before/after strings', () => {
  assert.deepEqual(formatChange({ field: 'url', from: 'https://a', to: 'https://b' }), {
    label: 'URL',
    before: 'https://a',
    after: 'https://b',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && node --test src/lib/__tests__/requestHistory.test.cjs`
Expected: FAIL — `Cannot find module '../requestHistory'`.

- [ ] **Step 3: Create the helper**

Create `frontend/src/lib/requestHistory.js`:

```js
'use strict';

// Pure formatting helpers for the request "History" tab. Kept CommonJS so the
// node --test suite can require() them.

const FIELD_LABELS = {
  name: 'Name',
  method: 'Method',
  url: 'URL',
  folderId: 'Folder',
  headers: 'Headers',
  queryParams: 'Query params',
  bodyType: 'Body type',
  bodyJson: 'Body (JSON)',
  bodyText: 'Body (text)',
  bodyParts: 'Body parts',
  apiType: 'API type',
  formula: 'Formula',
  assertions: 'Assertions',
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || String(field);
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function revisionSummary(revision) {
  if (revision.changeKind === 'create') return 'Created';
  if (revision.changeKind === 'rollback') return 'Restored an earlier version';
  const fields = (revision.changedFields || []).map((f) => fieldLabel(f.field));
  if (fields.length === 0) return 'No field changes';
  if (fields.length <= 3) return fields.join(', ');
  return `${fields.slice(0, 3).join(', ')} +${fields.length - 3} more`;
}

function formatChange(change) {
  return { label: fieldLabel(change.field), before: formatValue(change.from), after: formatValue(change.to) };
}

module.exports = { FIELD_LABELS, fieldLabel, formatValue, revisionSummary, formatChange };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && node --test src/lib/__tests__/requestHistory.test.cjs`
Expected: PASS.

- [ ] **Step 5: Add the API client and types**

Append to `frontend/src/lib/api.ts` (near `contentApi`, after its closing brace):

```ts
// ---- request edit history
export interface RequestChangedField {
  field: string;
  from: unknown;
  to: unknown;
}

export interface RequestRevisionMeta {
  id: string;
  requestId: string;
  revisionNumber: number;
  changeKind: 'create' | 'update' | 'rollback';
  changedFields: RequestChangedField[];
  rolledBackFrom: string | null;
  createdBy: { id: string; name: string | null };
  createdAt: string;
}

export interface RequestRevision extends RequestRevisionMeta {
  snapshot: Record<string, unknown> | null;
}

export const requestHistoryApi = {
  list: (requestId: string) =>
    apiFetch<{ revisions: RequestRevisionMeta[] }>(`/api/requests/${requestId}/revisions`),
  detail: (requestId: string, revisionId: string) =>
    apiFetch<{ revision: RequestRevision }>(`/api/requests/${requestId}/revisions/${revisionId}`),
  rollback: (requestId: string, revisionId: string) =>
    apiFetch<{ request: { id: string; name: string }; revision: RequestRevisionMeta }>(
      `/api/requests/${requestId}/revisions/${revisionId}/rollback`,
      { method: 'POST' }
    ),
};
```

- [ ] **Step 6: Run FE unit tests and typecheck**

Run: `cd frontend && npm test && npx tsc --noEmit`
Expected: unit PASS; `tsc` no errors.

- [ ] **Step 7: Commit**

```bash
cd /workspace && git add frontend/src/lib/api.ts frontend/src/lib/requestHistory.js frontend/src/lib/__tests__/requestHistory.test.cjs
git commit -m "feat(history): add request history API client and formatting helpers

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 5: History tab and panel in the request editor

**Files:**
- Create: `frontend/src/components/request/RequestHistoryPanel.tsx`
- Create: `frontend/src/components/request/requestHistory.module.css`
- Modify: `frontend/src/lib/types.ts:139`
- Modify: `frontend/src/components/RequestConfigurator.tsx` (imports; tab list 293-304; tab body 306-388)

**Interfaces:**
- Consumes: `requestHistoryApi`, `RequestRevisionMeta` (Task 4); `useRoomEvents` + `roomFor`; `useWorkspace().reloadActiveRequest`; `HistoryIcon`.
- Produces: a "History" tab rendering the revision list, per-revision diff, and a Restore action.

- [ ] **Step 1: Extend the request tab union**

In `frontend/src/lib/types.ts` line 139, change:

```ts
  activeRequestTab: 'params' | 'headers' | 'body' | 'formula' | 'tests';
```

to:

```ts
  activeRequestTab: 'params' | 'headers' | 'body' | 'formula' | 'tests' | 'history';
```

- [ ] **Step 2: Create the panel styles**

Create `frontend/src/components/request/requestHistory.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted, #8b93a7);
}

.empty,
.error {
  font-size: 12px;
  color: var(--text-muted, #8b93a7);
}

.error {
  color: var(--err, #e5534b);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  border: 1px solid var(--border, #2a2f3a);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--panel-2, rgba(255, 255, 255, 0.02));
}

.rowHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.subtle {
  font-size: 12px;
  color: var(--text-muted, #8b93a7);
}

.kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border, #2a2f3a);
}

.kindCreate { color: var(--info, #4c9aff); }
.kindUpdate { color: var(--info, #4c9aff); }
.kindRollback { color: var(--warn, #d29922); }

.restore {
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border, #2a2f3a);
  border-radius: 5px;
  padding: 2px 8px;
  color: inherit;
  cursor: pointer;
}

.restore:disabled {
  opacity: 0.5;
  cursor: default;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fieldLabel {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #8b93a7);
}

.before,
.after {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 2px 6px;
  border-radius: 4px;
}

.before {
  color: var(--err, #e5534b);
  background: rgba(229, 83, 75, 0.08);
}

.after {
  color: var(--ok, #3fb950);
  background: rgba(63, 185, 80, 0.08);
}
```

- [ ] **Step 3: Create the panel component**

Create `frontend/src/components/request/RequestHistoryPanel.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { requestHistoryApi, type RequestChangedField, type RequestRevisionMeta } from '@/lib/api';
import { useRoomEvents } from '@/components/useRoomEvents';
import { roomFor } from '@/lib/realtime';
import { revisionSummary, formatChange } from '@/lib/requestHistory';
import styles from './requestHistory.module.css';

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function RevRow({
  revision,
  busy,
  onRestore,
}: {
  revision: RequestRevisionMeta;
  busy: boolean;
  onRestore: (revision: RequestRevisionMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const kindClass =
    revision.changeKind === 'rollback'
      ? styles.kindRollback
      : revision.changeKind === 'create'
        ? styles.kindCreate
        : styles.kindUpdate;

  return (
    <div className={styles.row} data-testid="revision-row">
      <div className={styles.rowHead}>
        <div className={styles.meta}>
          <span className={`${styles.mono} ${styles.subtle}`}>v{revision.revisionNumber}</span>
          <span className={`${styles.kind} ${kindClass}`}>{revision.changeKind}</span>
          <span className={styles.subtle}>
            {revision.createdBy.name || 'Unknown'} · {formatDate(revision.createdAt)} · {revisionSummary(revision)}
          </span>
        </div>
        <div className={styles.meta}>
          {revision.changedFields.length > 0 && (
            <button
              type="button"
              className={styles.restore}
              data-testid="revision-details"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Hide' : 'Diff'}
            </button>
          )}
          {revision.changeKind !== 'create' && (
            <button
              type="button"
              className={styles.restore}
              data-testid="revision-restore"
              disabled={busy}
              onClick={() => onRestore(revision)}
            >
              Restore
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className={styles.fields}>
          {revision.changedFields.map((f: RequestChangedField) => {
            const { label, before, after } = formatChange(f);
            return (
              <div key={f.field} className={styles.field} data-testid={`revision-field-${f.field}`}>
                <span className={styles.fieldLabel}>{label}</span>
                <span className={styles.before}>- {before}</span>
                <span className={styles.after}>+ {after}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RequestHistoryPanel({
  requestId,
  onRestored,
}: {
  requestId: string;
  onRestored?: () => void;
}) {
  const [revisions, setRevisions] = useState<RequestRevisionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requestHistoryApi.list(requestId);
      setRevisions(res.revisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRoomEvents(roomFor('request', requestId), (event) => {
    if (event.type === 'entity:updated') void load();
  });

  const restore = async (revision: RequestRevisionMeta) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(`Restore the request to v${revision.revisionNumber}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await requestHistoryApi.rollback(requestId, revision.id);
      await load();
      onRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root} data-testid="request-history-panel">
      <div className={styles.head}>
        <span className={styles.title}>Change history</span>
        {loading && <span className={styles.subtle}>Loading…</span>}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {!loading && revisions.length === 0 ? (
        <div className={styles.empty}>No history yet.</div>
      ) : (
        <div className={styles.list}>
          {revisions.map((r) => (
            <RevRow key={r.id} revision={r} busy={busy} onRestore={restore} />
          ))}
        </div>
      )}
    </div>
  );
}

export default RequestHistoryPanel;
```

- [ ] **Step 4: Wire the tab into RequestConfigurator**

In `frontend/src/components/RequestConfigurator.tsx`:

1. Add to the icons import block (near line 36) the `HistoryIcon` name.
2. Add imports near the other component imports:

```tsx
import { RequestHistoryPanel } from './request/RequestHistoryPanel';
```

3. Add the tab to the `TabBar` `tabs` array (line ~293), after `tests`:

```tsx
    { id: 'history', label: 'History', icon: HistoryIcon },
```

4. Add a render block inside the tab body (with the other `{activeTab === '...'}` blocks, ~line 307-388):

```tsx
        {activeTab === 'history' && (
          <RequestHistoryPanel
            requestId={request.id}
            onRestored={() => {
              void ws.reloadActiveRequest();
            }}
          />
        )}
```

- [ ] **Step 5: Typecheck and unit-test**

Run: `cd frontend && npm test && npx tsc --noEmit`
Expected: unit PASS; `tsc` no errors.

- [ ] **Step 6: Manual smoke test**

Start (or reuse) the dev servers and confirm: open a request, edit it, Save, open the **History** tab, see the update entry with a Diff, click **Restore** on v1, confirm the editor reloads to the old values and a new `rollback` row appears. Realtime: with a second browser signed in as another project member, saving/rolling back shows the conflict/reload banner.

> Dev servers in this environment: backend on :3001, frontend on :3000 (rerouted via Next `/api`). If they are not running, start them with the `deploy-website` skill. Actually typecheck + the integration tests are the acceptance gate; the manual smoke test is best-effort.

- [ ] **Step 7: Commit**

```bash
cd /workspace && git add frontend/src/lib/types.ts frontend/src/components/RequestConfigurator.tsx frontend/src/components/request/RequestHistoryPanel.tsx frontend/src/components/request/requestHistory.module.css
git commit -m "feat(history): add request History tab with diff and restore

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `session_v2.md`

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing documentation and a green full verification run.

- [ ] **Step 1: Document the feature in FEATURES.md**

Add a new section after the collaboration/realtime sections (match the surrounding numbering — the last section used is §25; if §26 is free use it, otherwise the next number):

```markdown
## 26. Request change history

Every stored request keeps an append-only revision log. Saving a request records
a revision with the author, timestamp, and the exact field-level diff; the
initial creation and every rollback are recorded too. Any project member can
read a request's history; editors (EDITOR+) can roll a request back to any
earlier revision, which creates a *new* revision (history is never rewritten).

- `GET /api/requests/:requestId/revisions` — newest-first metadata list
  (`revisionNumber`, `changeKind` = `create|update|rollback`, `changedFields`,
  `createdBy`, `createdAt`).
- `GET /api/requests/:requestId/revisions/:revisionId` — metadata plus the full
  post-change snapshot.
- `POST /api/requests/:requestId/revisions/:revisionId/rollback` — restores the
  revision's snapshot into the request and records a `rollback` revision.

Storage is `request_revisions` (migration 046): immutable rows (SELECT/INSERT
only), scoped by workspace for RLS, snapshots in the same camelCase shape used by
collection version diffs. Rollback publishes the existing realtime
`entity:updated` event, so every other open editor reloads the new state. The
editor surfaces this under the request's **History** tab, which shows a
git-style before/after diff per revision and a **Restore** action.
```

Also add the three endpoints to the `/api/auth`-style endpoint table if the file has one for request/content endpoints (grep for `PUT /api/requests` in FEATURES.md and add rows adjacent).

- [ ] **Step 2: Log the work in session_v2.md**

Append a short entry describing: the `request_revisions` table, the capture points in `content.js`, the `requestRevisions.js` routes, the FE History tab with diff + restore, and the reuse of `entity:updated` for live refresh.

- [ ] **Step 3: Run the full verification**

Run:
```bash
cd backend && npm run test:api:unit
cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/requestRevisions.integration.test.cjs tests/realtime.integration.test.cjs tests/duplicate.integration.test.cjs tests/apiAuth.integration.test.cjs
cd /workspace/frontend && npm test && npx tsc --noEmit
```
Expected: all green (backend unit = previous 104 + new; integration suites pass; FE unit + tsc clean).

- [ ] **Step 4: Commit**

```bash
cd /workspace && git add docs/FEATURES.md session_v2.md
git commit -m "docs: document request change history and rollback

Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

## Self-Review

**Spec coverage**
- "Editing reflected in shared workspace" — already shipped (Plan 3); rollback now also publishes `entity:updated` (Task 2/3) and FE calls `reloadActiveRequest` (Task 5).
- "History of who did what, like git changes" — Task 1 (storage + diff), Task 2 (capture + read), Task 4/5 (UI with author + before/after diff).
- "Save replaces the request for all users" — existing save path + realtime reload retained; Task 2 only adds revision recording.
- "Rollback" — Task 2 route + Task 3 tests + Task 5 Restore action.

**Type consistency**
- `serializeRequest` keys == `collabDiff.COMPARED_FIELDS`.
- Backend meta uses `changeKind`, `changedFields`, `rolledBackFrom`, `createdBy`, `createdAt`, `revisionNumber`, `requestId`; FE types mirror exactly.
- `requestHistoryApi.rollback` returns `{ request, revision }` matching the backend response.
- `insertRevision` used with both `null` (auto-commit) and `(sql,p)=>client.query(sql,p)` (transaction).

**Known, intentional limitations (documented)**
- Revisions are per-request only; collection/workspace activity feeds are out of scope (user chose request history + rollback).
- Deleting a request cascades its revisions away (no delete tombstone).
- Rollback restores the name verbatim (no re-uniquification).
- The throttle/GC-style concerns of migrations 044/045 do not apply; revisions are bounded by request lifetime.
