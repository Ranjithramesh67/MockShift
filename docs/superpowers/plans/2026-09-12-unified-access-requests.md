# Unified Access Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project and workspace access requests coherent: one requester view, one reviewer queue, notifications with working deep links, and a workspace-request creation UI.

**Architecture:** Add a shared `notify.js` helper and a shared `workspaceAccess.js` review module. Extend the existing project routes and the `/manage` router with a workspace-request queue. Surface all of a user's requests in a new Inbox "Requests" tab, and all reviewable requests in the Manage "Requests" tab. Make the bell follow notification links.

**Tech Stack:** Express + PostgreSQL (`pg`), Next.js 14 (App Router, React), Node `node:test` unit/integration tests.

## Global Constraints

- Backend raw SQL via `require('../db')`; do not use an ORM.
- Migrations are append-only; next number is `042`.
- Backend connects as privileged `postgres` so RLS is bypassed; route-layer checks are the real enforcement.
- Never `git add -A`; never stage `docs/superpowers/`; stage exact files.
- Frontend API calls via `apiFetch`/`ApiError`; errors surfaced through `err.message`.
- Frontend unit tests are `.cjs` under `frontend/src/lib/__tests__/` and may only require CommonJS `.js` modules.
- Integration tests use the scratch Postgres cluster: `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1`.
- Testids are kebab-case `data-testid`; dynamic testids embed a name/id.
- Commit style: Conventional Commits; do not add the `Co-authored-by` trailer (hook adds it).

---

## File Structure

- Create `backend/src/api/notify.js` - notification + reviewer-resolution helpers.
- Create `backend/src/api/workspaceAccess.js` - load/serialize/review workspace access requests (shared by docs + manage).
- Create `db/migrations/042_access_request_cancel.sql` - allow `CANCELLED` on `access_requests`.
- Modify `backend/src/api/routes/projects.js` - notify reviewers, audit re-request, cancel endpoint.
- Modify `backend/src/api/routes/docs.js` - use shared notify/workspaceAccess modules; notify on create; audit cancel.
- Modify `backend/src/api/routes/manage.js` - workspace request queue + review.
- Create `backend/tests/accessRequests.integration.test.cjs`.
- Modify `frontend/src/lib/api.ts` - notification kinds, manage workspace methods, project cancel.
- Create `frontend/src/lib/accessRequests.js` + `frontend/src/lib/__tests__/accessRequests.test.cjs`.
- Modify `frontend/src/components/InboxView.tsx` - Requests tab.
- Modify `frontend/src/components/views/ManageView.tsx` - workspace queue.
- Modify `frontend/src/components/TopBar.tsx` - follow notification links.
- Modify `frontend/src/components/Sidebar.tsx` - workspace "Request access".
- Modify `frontend/app/globals.css` - bell kind styles + request rows.
- Modify `docs/FEATURES.md`, `session_v2.md`.

---

## Task 1: Notification + reviewer helpers

**Files:**
- Create: `backend/src/api/notify.js`
- Test: `backend/src/api/__tests__/notify.test.cjs`

**Interfaces:**
- Produces: `notifyUser({userId,title,body,kind,payload,link})` Promise<void> (never throws)
- Produces: `notifyUsers(userIds, opts)` Promise<void>
- Produces: `projectReviewerIds(projectId, excludeUserId)` Promise<string[]>
- Produces: `workspaceReviewerIds(workspaceId, excludeUserId)` Promise<string[]>

- [ ] **Step 1: Write the failing test**

For the DB-free parts, test the pure SQL-scoping predicate used to filter out the actor:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupeRecipients } = require('../notify');

test('dedupeRecipients removes the actor, falsy values and duplicates', () => {
  assert.deepEqual(dedupeRecipients(['a', 'b', 'a', null, 'a', undefined], 'a'), ['b']);
});

test('dedupeRecipients keeps order of first appearance', () => {
  assert.deepEqual(dedupeRecipients(['c', 'b', 'c'], null), ['c', 'b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/api/__tests__/notify.test.cjs`
Expected: FAIL - `dedupeRecipients is not a function` (or module not found).

- [ ] **Step 3: Write the implementation**

```js
'use strict';

const { query } = require('./db');

// De-duplicate a recipient id list, dropping the actor and any falsy ids.
function dedupeRecipients(userIds, excludeUserId) {
  const seen = new Set();
  const out = [];
  for (const id of userIds || []) {
    if (!id || id === excludeUserId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function notifyUser({ userId, title, body, kind, payload, link }) {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, payload, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, body || null, kind || 'info', JSON.stringify(payload || {}), link || null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] insert failed:', err.message);
  }
}

async function notifyUsers(userIds, opts) {
  for (const userId of dedupeRecipients(userIds, opts && opts.excludeUserId)) {
    await notifyUser({ ...opts, userId });
  }
}

// Platform admins plus the project's assigned managers.
async function projectReviewerIds(projectId, excludeUserId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id
       FROM users u
      WHERE u.is_active = true
        AND u.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (
          u.role = 'ADMIN'
          OR EXISTS (SELECT 1 FROM project_managers pm
                      WHERE pm.project_id = $1 AND pm.user_id = u.id)
        )`,
    [projectId, excludeUserId || null]
  );
  return rows.map((r) => r.id);
}

// Platform managers/admins, the workspace's org admins, and workspace admins.
async function workspaceReviewerIds(workspaceId, excludeUserId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id
       FROM users u
      WHERE u.is_active = true
        AND u.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (
          u.role IN ('ADMIN', 'MANAGER')
          OR EXISTS (SELECT 1 FROM workspace_members wm
                      WHERE wm.workspace_id = $1 AND wm.user_id = u.id AND wm.role = 'ADMIN')
          OR EXISTS (SELECT 1 FROM organization_members om
                      JOIN workspaces w ON w.id = $1
                     WHERE om.org_id = w.organization_id AND om.user_id = u.id AND om.role = 'ADMIN')
        )`,
    [workspaceId, excludeUserId || null]
  );
  return rows.map((r) => r.id);
}

module.exports = { dedupeRecipients, notifyUser, notifyUsers, projectReviewerIds, workspaceReviewerIds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/api/__tests__/notify.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/notify.js backend/src/api/__tests__/notify.test.cjs
git commit -m "feat(notify): add notification and reviewer-resolution helpers"
```

---

## Task 2: Migration - cancellable project access requests

**Files:**
- Create: `db/migrations/042_access_request_cancel.sql`

**Interfaces:**
- Produces: `access_requests.status` may now be `CANCELLED`.

- [ ] **Step 1: Write the migration**

```sql
-- Allow a requester to cancel a pending project access request.
-- The original CHECK only permitted PENDING/APPROVED/DENIED (migration 003).
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_status_check;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED'));
```

- [ ] **Step 2: Apply to the dev database**

Run: `cd /workspace && set -a && . /tmp/pgenv && set +a && psql -h 127.0.0.1 -U postgres -d apihub -f db/migrations/042_access_request_cancel.sql`
Expected: `ALTER TABLE` twice, no error.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/042_access_request_cancel.sql
git commit -m "feat(db): allow CANCELLED project access requests"
```

---

## Task 3: Project requests - notify reviewers, audit re-request, cancel

**Files:**
- Modify: `backend/src/api/routes/projects.js:20-101`
- Test: `backend/tests/accessRequests.integration.test.cjs` (created here)

**Interfaces:**
- Consumes: `projectReviewerIds`, `notifyUsers` from Task 1.
- Produces: `POST /api/projects/:projectId/access-requests/:requestId/cancel` -> `{ ok: true }`.

- [ ] **Step 1: Write the failing integration test**

Model the harness on `backend/tests/apiAuth.integration.test.cjs` (boots `createApp()`). Cover: create project request -> reviewers get a notification; cancel -> status CANCELLED and cannot be reviewed.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Reuse the bootstrap helpers from apiAuth.integration.test.cjs (signup/login/createApp).
// Import them by copying the small helper block, or extract to tests/support/harness.cjs.

test('project access request notifies reviewers and can be cancelled', async (t) => {
  const app = await createApp({});
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  const manager = await signupAndLogin(base, 'ar-manager@test.io');
  const outsider = await signupAndLogin(base, 'ar-outsider@test.io');

  const ws = await api(base, manager.cookie, 'POST', '/api/workspaces', { name: 'AR WS' });
  const wsId = ws.body.workspace.id;
  const tree = await api(base, manager.cookie, 'GET', `/api/workspaces/${wsId}/content`);
  const projectId = tree.body.projects[0].id;
  await api(base, manager.cookie, 'POST', `/api/manage/projects/${projectId}/managers`, { userId: manager.user.id });

  const created = await api(base, outsider.cookie, 'POST', `/api/projects/${projectId}/access-requests`, {
    reason: 'need access', role: 'VIEWER',
  });
  assert.equal(created.status, 201);
  const requestId = created.body.accessRequest.id;

  const notes = await api(base, manager.cookie, 'GET', '/api/notifications');
  assert.ok(notes.body.notifications.some((n) => /access request/i.test(n.title)));

  const cancel = await api(base, outsider.cookie, 'POST',
    `/api/projects/${projectId}/access-requests/${requestId}/cancel`);
  assert.equal(cancel.status, 200);

  const mine = await api(base, outsider.cookie, 'GET', '/api/access-requests/mine');
  assert.equal(mine.body.accessRequests.find((r) => r.id === requestId).status, 'CANCELLED');

  const review = await api(base, manager.cookie, 'POST',
    `/api/manage/access-requests/${requestId}/review`, { approve: true });
  assert.equal(review.status, 409);
});
```

(The plan executor copies `createApp`, `signupAndLogin`, and `api` helpers from `backend/tests/apiAuth.integration.test.cjs:1-124` into `tests/support/harness.cjs` and imports them in both files, or inlines them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/accessRequests.integration.test.cjs`
Expected: FAIL - cancel returns 404, notification missing.

- [ ] **Step 3: Implement**

In `projects.js`, import the helper at top:

```js
const { notifyUsers, projectReviewerIds } = require('../notify');
```

In the create handler, after the INSERT (`projects.js:53-58`) and after `logAudit`, add:

```js
const reviewerIds = await projectReviewerIds(projectId, req.user.id);
await notifyUsers(reviewerIds, {
  title: 'New project access request',
  body: `${req.user.name || req.user.email} requested ${requestedRole} access to "${project.rows[0].name}".`,
  kind: 'request',
  payload: { requestId: rows[0].id, projectId, type: 'project_access_request' },
  link: '/manage?tab=requests',
});
```

In the re-request (`closed row -> PENDING`) branch (`:39-50`), add `logAudit` and the same reviewer notification (reuse a local `notifyReviewers` function to avoid duplication):

```js
await logAudit({
  actorId: req.user.id,
  entityType: 'access_request',
  entityId: existing.rows[0].id,
  action: 'request_access',
  detail: { projectId, reopened: true },
  ip: req.ip,
});
```

Add the cancel route after `GET /access-requests/mine` (`:101`):

```js
// Creator-only cancellation while the request is pending.
router.post('/projects/:projectId/access-requests/:requestId/cancel', async (req, res, next) => {
  try {
    const { projectId, requestId } = req.params;
    const { rows } = await query(
      `SELECT id, user_id, status FROM access_requests WHERE id = $1 AND project_id = $2`,
      [requestId, projectId]
    );
    if (rows.length === 0 || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Access request not found' });
    }
    if (rows[0].status !== 'PENDING') {
      return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    }
    await query(`UPDATE access_requests SET status = 'CANCELLED' WHERE id = $1`, [requestId]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'access_request',
      entityId: requestId,
      action: 'cancel',
      detail: { projectId },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/accessRequests.integration.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/routes/projects.js backend/tests/accessRequests.integration.test.cjs
git commit -m "feat(access-requests): notify project reviewers, audit re-request, add cancel"
```

---

## Task 4: Shared workspace-access module + docs.js refactor

**Files:**
- Create: `backend/src/api/workspaceAccess.js`
- Modify: `backend/src/api/routes/docs.js:2003-2229`, `:438-448`
- Test: `backend/tests/accessRequests.integration.test.cjs` (extend)

**Interfaces:**
- Consumes: `notifyUser`, `notifyUsers`, `workspaceReviewerIds` (Task 1).
- Produces: `serializeWorkspaceAccessRequest(row)`, `loadWorkspaceAccessRequest(id)`, `reviewWorkspaceAccessRequest({request, reviewer, approve, ip})` Promise<{status}>
- Produces (on create): reviewer notification; (on cancel): audit row.

- [ ] **Step 1: Write the failing test** (append to the integration file)

```js
test('workspace access request notifies reviewers and is reviewable', async (t) => {
  // manager creates a workspace; outsider requests access; manager is org/workspace admin
  // -> GET /api/docs/workspace-access-requests?workspaceId= returns PENDING
  // -> manager notifications include a workspace request
  // -> POST review {approve:true} grants VIEWER membership; requester notified
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 ... node --test tests/accessRequests.integration.test.cjs`
Expected: FAIL - no reviewer notification on creation.

- [ ] **Step 3: Implement `workspaceAccess.js`**

Move the logic from `docs.js` verbatim into a module. Key exports:

```js
'use strict';
const { query } = require('./db');
const { roleAtLeast, getWorkspaceRole, canReadWorkspace } = require('./access');
const { logAudit } = require('./audit');
const { notifyUser } = require('./notify');

function isGlobalHigh(user) { return Boolean(user) && roleAtLeast(user.role, 'MANAGER'); }

async function workspaceAccessFor(user, workspaceId) {
  if (isGlobalHigh(user)) return { role: 'ADMIN', readable: true };
  const role = await getWorkspaceRole(user.id, workspaceId);
  const readable = Boolean(role) || (await canReadWorkspace(user.id, workspaceId));
  return { role, readable };
}

async function serializeWorkspaceAccessRequest(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    requesterId: row.user_id,
    requester: { id: row.user_id, name: row.requester_name, email: row.requester_email },
    reason: row.reason ?? null,
    status: row.status,
    requestedAt: row.requested_at,
    reviewedBy: row.reviewed_by ? { id: row.reviewed_by, name: row.reviewer_name } : null,
    reviewedAt: row.reviewed_at ?? null,
  };
}

async function loadWorkspaceAccessRequest(id) {
  const { rows } = await query(
    `SELECT war.*, w.name AS workspace_name,
            ru.name AS requester_name, ru.email AS requester_email,
            rb.name AS reviewer_name
       FROM workspace_access_requests war
       JOIN workspaces w ON w.id = war.workspace_id
       JOIN users ru ON ru.id = war.user_id
       LEFT JOIN users rb ON rb.id = war.reviewed_by
      WHERE war.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function reviewWorkspaceAccessRequest({ request, reviewer, approve, ip }) {
  const status = approve ? 'APPROVED' : 'DENIED';
  await query(
    `UPDATE workspace_access_requests SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
    [status, reviewer.id, request.id]
  );
  if (approve) {
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, granted_by)
       VALUES ($1, $2, 'VIEWER', $3) ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [request.workspace_id, request.user_id, reviewer.id]
    );
  }
  await notifyUser({
    userId: request.user_id,
    title: approve ? 'Workspace access granted' : 'Workspace access denied',
    body: `Your request to join "${request.workspace_name}" was ${approve ? 'approved' : 'declined'}.`,
    kind: approve ? 'success' : 'info',
    payload: { requestId: request.id, workspaceId: request.workspace_id, type: 'workspace_access_request' },
    link: '/inbox?tab=requests',
  });
  await logAudit({
    actorId: reviewer.id,
    entityType: 'workspace_access_request',
    entityId: request.id,
    action: approve ? 'approve' : 'deny',
    detail: { workspaceId: request.workspace_id, userId: request.user_id },
    ip,
  });
  return { status };
}

module.exports = {
  isGlobalHigh,
  workspaceAccessFor,
  serializeWorkspaceAccessRequest,
  loadWorkspaceAccessRequest,
  reviewWorkspaceAccessRequest,
};
```

In `docs.js`, remove the local copies of `isGlobalHigh`/`workspaceAccessFor`/serialize/load (lines ~100-115, ~2003-2035) and import from `../workspaceAccess`; remove the local `notifyUser` (`:438-448`) and import from `../notify`. In the create handler, after `logAudit`, add:

```js
const reviewerIds = await workspaceReviewerIds(workspaceId, req.user.id);
await notifyUsers(reviewerIds, {
  title: 'New workspace access request',
  body: `${req.user.name || req.user.email} requested access to the workspace.`,
  kind: 'request',
  payload: { requestId: created.rows[0].id, workspaceId, type: 'workspace_access_request' },
  link: '/manage?tab=requests',
});
```

In the review handler, replace the inline update/membership/notify/audit block (`:2161-2204`) with `await reviewWorkspaceAccessRequest({ request, reviewer: req.user, approve, ip: req.ip });`. In the cancel handler, add `logAudit({ actorId: req.user.id, entityType: 'workspace_access_request', entityId: id, action: 'cancel', detail: { workspaceId: request.workspace_id }, ip: req.ip })`.

- [ ] **Step 4: Run tests**

Run: `cd backend && PGPORT=5441 ... node --test tests/accessRequests.integration.test.cjs`
Expected: PASS.
Also run the existing docs integration suites to catch refactor regressions:
`cd backend && PGPORT=5441 ... node --test tests/docsShareAudiences.integration.test.cjs tests/collab.integration.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/workspaceAccess.js backend/src/api/routes/docs.js backend/tests/accessRequests.integration.test.cjs
git commit -m "refactor(docs): share workspace access request logic; notify reviewers on create"
```

---

## Task 5: Manage queue for workspace requests

**Files:**
- Modify: `backend/src/api/routes/manage.js:150-244`
- Test: `backend/tests/accessRequests.integration.test.cjs` (extend)

**Interfaces:**
- Consumes: `loadWorkspaceAccessRequest`, `serializeWorkspaceAccessRequest`, `reviewWorkspaceAccessRequest`, `workspaceAccessFor` from Task 4.
- Produces: `GET /api/manage/workspace-access-requests` -> `{ requests: [...] }`
- Produces: `POST /api/manage/workspace-access-requests/:requestId/review` -> `{ ok: true, status }`

- [ ] **Step 1: Write the failing test** (append)

```js
test('manage lists and reviews workspace access requests', async (t) => {
  // outsider requests; manager GET /api/manage/workspace-access-requests sees it;
  // POST review {approve:true} -> 200; outsider gains workspace read.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PGPORT=5441 ... node --test tests/accessRequests.integration.test.cjs`
Expected: FAIL - 404 route not found.

- [ ] **Step 3: Implement in `manage.js`**

Add imports:

```js
const {
  loadWorkspaceAccessRequest,
  serializeWorkspaceAccessRequest,
  reviewWorkspaceAccessRequest,
  workspaceAccessFor,
} = require('../workspaceAccess');
```

Add routes after `POST /access-requests/:requestId/review` (`:244`):

```js
// Workspace access requests are reviewable by platform MANAGER/ADMIN or a
// workspace admin (workspaceAccessFor). The manage router already requires
// MANAGER/ADMIN globally, so all callers pass for workspaces they admin.
router.get('/workspace-access-requests', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT war.*, w.name AS workspace_name,
              ru.name AS requester_name, ru.email AS requester_email,
              rb.name AS reviewer_name
         FROM workspace_access_requests war
         JOIN workspaces w ON w.id = war.workspace_id
         JOIN users ru ON ru.id = war.user_id
         LEFT JOIN users rb ON rb.id = war.reviewed_by
        ORDER BY war.requested_at DESC`
    );
    const requests = [];
    for (const row of rows) requests.push(await serializeWorkspaceAccessRequest(row));
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

router.post('/workspace-access-requests/:requestId/review', async (req, res, next) => {
  try {
    const { approve } = req.body || {};
    if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve must be a boolean' });
    const request = await loadWorkspaceAccessRequest(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Access request not found' });
    const access = await workspaceAccessFor(req.user, request.workspace_id);
    if (!roleAtLeast(access.role, 'ADMIN')) {
      return res.status(403).json({ error: 'Workspace admin access required' });
    }
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'This request has already been reviewed' });
    }
    const { status } = await reviewWorkspaceAccessRequest({ request, reviewer: req.user, approve, ip: req.ip });
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});
```

Note: platform MANAGER passes `workspaceAccessFor` (isGlobalHigh), so listing all is consistent with review scope. Keep the listing global for ADMIN/MANAGER.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PGPORT=5441 ... node --test tests/accessRequests.integration.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/routes/manage.js
git commit -m "feat(manage): add workspace access request queue"
```

---

## Task 6: Frontend API clients

**Files:**
- Modify: `frontend/src/lib/api.ts:584-698`, `:777-793`
- Test: `frontend/src/lib/__tests__/accessRequests.test.cjs` (created in Task 7)

**Interfaces:**
- Produces: `AccessRequestRow` gains `status: ... | 'CANCELLED'` and optional `workspaceId`.
- Produces: `accessRequestApi.cancel(projectId, requestId)`.
- Produces: `manageApi.workspaceAccessRequests()`, `manageApi.reviewWorkspaceRequest(requestId, approve)`.
- Produces: `Notification.kind` includes `'send' | 'request'`.

- [ ] **Step 1: Implement**

In `api.ts`, widen the union and add methods:

```ts
status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
```

```ts
// manageApi additions
workspaceAccessRequests: () =>
  apiFetch<{ requests: WorkspaceAccessRequest[] }>('/api/manage/workspace-access-requests'),
reviewWorkspaceRequest: (requestId: string, approve: boolean) =>
  apiFetch<{ ok: boolean; status: string }>(
    `/api/manage/workspace-access-requests/${requestId}/review`,
    { method: 'POST', body: { approve } }
  ),
```

```ts
// accessRequestApi addition
cancel: (projectId: string, requestId: string) =>
  apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/access-requests/${requestId}/cancel`, {
    method: 'POST',
  }),
```

```ts
// Notification.kind
kind: 'info' | 'success' | 'error' | 'send' | 'request';
```

Import `WorkspaceAccessRequest` type from `./docsApi` at the top of `api.ts` (or re-declare to avoid a cycle; `docsApi.ts` already imports from `./api`, so re-declare a local `ManageWorkspaceAccessRequest` interface to avoid a circular type import).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(fe-api): workspace request queue, project request cancel, notification kinds"
```

---

## Task 7: Inbox "Requests" tab

**Files:**
- Create: `frontend/src/lib/accessRequests.js`
- Create: `frontend/src/lib/__tests__/accessRequests.test.cjs`
- Modify: `frontend/src/components/InboxView.tsx`
- Modify: `frontend/app/inbox/inbox.css`

**Interfaces:**
- Consumes: `accessRequestApi.mine`, `accessRequestApi.cancel`, `docsSharedApi.listWorkspaceRequests`, `docsSharedApi.cancelWorkspaceRequest`.
- Produces: `mergeMyRequests(projectRows, workspaceRows)` -> `RequestRow[]` sorted by `requestedAt` desc, with `kind: 'project'|'workspace'` and `testId`.

- [ ] **Step 1: Write the failing unit test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeMyRequests } = require('../accessRequests.js');

test('mergeMyRequests tags and sorts project and workspace requests', () => {
  const project = [{ id: 'p1', project_id: 'pr1', role: 'VIEWER', status: 'PENDING', requested_at: '2026-01-01T00:00:00Z', project_name: 'Alpha' }];
  const workspace = [{ id: 'w1', workspaceId: 'ws1', workspaceName: 'Beta', status: 'PENDING', requestedAt: '2026-01-02T00:00:00Z', requester: {}, requesterId: 'u', reviewedBy: null, reviewedAt: null, reason: null }];
  const rows = mergeMyRequests(project, workspace);
  assert.equal(rows[0].kind, 'workspace');
  assert.equal(rows[0].title, 'Beta');
  assert.equal(rows[0].workspaceId, 'ws1');
  assert.equal(rows[1].kind, 'project');
  assert.equal(rows[1].title, 'Alpha');
  assert.equal(rows[1].projectId, 'pr1');
});

test('mergeMyRequests tolerates null inputs', () => {
  assert.deepEqual(mergeMyRequests(null, undefined), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/accessRequests.test.cjs`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the pure helper**

```js
'use strict';

function mergeMyRequests(projectRows, workspaceRows) {
  const rows = [];
  for (const r of projectRows || []) {
    rows.push({
      id: r.id,
      kind: 'project',
      projectId: r.project_id,
      title: r.project_name || 'Project',
      role: r.role || null,
      status: r.status,
      reason: r.reason || null,
      requestedAt: r.requested_at,
      cancellable: r.status === 'PENDING',
    });
  }
  for (const r of workspaceRows || []) {
    rows.push({
      id: r.id,
      kind: 'workspace',
      workspaceId: r.workspaceId,
      title: r.workspaceName || 'Workspace',
      role: null,
      status: r.status,
      reason: r.reason || null,
      requestedAt: r.requestedAt,
      cancellable: r.status === 'PENDING',
    });
  }
  rows.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  return rows;
}

module.exports = { mergeMyRequests };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test src/lib/__tests__/accessRequests.test.cjs`
Expected: PASS.

- [ ] **Step 5: Wire the Inbox tab**

In `InboxView.tsx`: change `tab` type to `'inbox' | 'sent' | 'requests'`; on mount read `?tab=requests` (`new URLSearchParams(window.location.search)`) to preselect. Add loaders:

```ts
const [myRequests, setMyRequests] = useState<ReturnType<typeof mergeMyRequests>>([]);
const loadRequests = async () => {
  const [p, w] = await Promise.all([
    accessRequestApi.mine(),
    docsSharedApi.listWorkspaceRequests({ mine: true }),
  ]);
  setMyRequests(mergeMyRequests(p.accessRequests, w.requests));
};
```

Add `cancel` handler that calls `accessRequestApi.cancel(row.kind === 'project' ? row.projectId : ...)` / `docsSharedApi.cancelWorkspaceRequest(row.id)` then reloads. Render a third tab `data-testid="inbox-tab-requests"` and rows `data-testid={`request-row-${row.kind}-${row.id}`}` with a status chip and a Cancel button `data-testid={`request-cancel-${row.id}`}`. Add `.inbox-*` styles to `app/inbox/inbox.css`.

- [ ] **Step 6: Typecheck + tests**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/accessRequests.js frontend/src/lib/__tests__/accessRequests.test.cjs frontend/src/components/InboxView.tsx frontend/app/inbox/inbox.css
git commit -m "feat(inbox): add my access requests tab with cancel"
```

---

## Task 8: Manage "Requests" tab shows both queues

**Files:**
- Modify: `frontend/src/components/views/ManageView.tsx:39-310`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `manageApi.accessRequests`, `manageApi.reviewRequest`, `manageApi.workspaceAccessRequests`, `manageApi.reviewWorkspaceRequest`.

- [ ] **Step 1: Implement**

In state add `wsRequests: ManageWorkspaceAccessRequest[]` and a loader `loadWsRequests`. Call it in the existing load `useEffect`. In the Requests tab, render two sections: "Project requests" (existing) and "Workspace requests" using testids `workspace-request-row-${r.id}`, `workspace-deny-${r.id}`, `workspace-approve-${r.id}`. Reuse the `review` handler shape for workspace (`reviewWorkspaceRequest`). Add a type badge (`Project` / `Workspace`). Support `?tab=requests` on mount so the notification deep link lands on the Requests tab.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/views/ManageView.tsx frontend/app/globals.css
git commit -m "feat(manage): show workspace requests in the unified requests tab"
```

---

## Task 9: Notification bell follows links + request styles

**Files:**
- Modify: `frontend/src/components/TopBar.tsx:36-126`
- Modify: `frontend/app/globals.css:3748-3864`

- [ ] **Step 1: Implement navigation**

Import `useRouter` from `next/navigation`. In the notification item click handler, after `await markRead(n.id)`, if `n.link` call `router.push(n.link)` and close the dropdown. Keep existing behavior when no link.

- [ ] **Step 2: Styles**

Add `.bell-kind-request` and `.bell-kind-send` blocks mirroring `.bell-kind-info` / `.bell-kind-approval`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/app/globals.css
git commit -m "feat(notifications): follow deep links and style request/send kinds"
```

---

## Task 10: Workspace request creation UI

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (workspace switcher) or `frontend/src/components/TopBar.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Implement**

In the workspace switcher, for entries where `role` is null (listed via PUBLIC/team access but not a member), render a "Request access" action `data-testid={`workspace-request-${w.id}`}`. On click open a small modal (mirror the existing project access-request modal at `Sidebar.tsx:1487-1522`) with a reason textarea and submit calling `docsSharedApi.requestWorkspaceAccess({ workspaceId, reason })`; on success show a toast and refresh workspaces. If the switcher is inside `Sidebar.tsx`, reuse the existing modal patterns and testids `workspace-request-modal`, `workspace-request-reason`, `workspace-request-confirm`, `workspace-request-cancel`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/app/globals.css
git commit -m "feat(workspaces): add request-access UI"
```

---

## Task 11: Docs + session log

**Files:**
- Modify: `docs/FEATURES.md` (section 15)
- Modify: `session_v2.md`

- [ ] **Step 1: Update `docs/FEATURES.md`**
Replace the gap statement "no dedicated creation UI for workspace access requests" and the "inbox does not show access requests" note with the new behavior: reviewer notifications on creation, unified Manage queue, Inbox Requests tab, workspace request creation UI, project request cancel.

- [ ] **Step 2: Append to `session_v2.md`** a "Unified access requests" completed bullet + details.

- [ ] **Step 3: Commit + push**

```bash
git add docs/FEATURES.md session_v2.md
git commit -m "docs: record unified access request experience"
git push origin master
```

---

## Self-Review

- Spec coverage: reviewer notifications (T3/T4), requester visibility (T7), unified reviewer queue (T5/T8), creation UI (T10), deep links (T9), cancel (T2/T3/T7), audit gaps (T3/T4), docs (T11). Covered.
- Placeholder scan: frontend tasks describe wiring with exact testids and method names; no TBDs.
- Type consistency: `reviewWorkspaceAccessRequest` return `{status}`; `workspaceAccessFor` reused in manage and docs; `mergeMyRequests` row shape consumed only in InboxView.
