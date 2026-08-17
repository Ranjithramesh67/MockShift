# Session History & Handoff

This document is the chat-history / handoff log for the MockShift (API Hub)
project. A fresh AI agent should read this file first to learn the current
state, what has already been done, and how to continue without redoing work.

## 1. Project at a glance

- Stack: Express 5 (backend, port 3001) + Next.js 14 (frontend, port 3000) +
  PostgreSQL 15 (`apihub` DB) + Redis (BullMQ). Sandboxed formula execution via
  `isolated-vm`.
- Layout:
  - `backend/` — execution engine + REST API (`src/api/server.js`, port 3001).
  - `frontend/` — Next.js app, `/api/*` proxied to 127.0.0.1:3001
    (`next.config.mjs`).
  - `db/` — SQL migrations (`migrations/`), tests (`tests/`), `seed.sql`.
  - `prisma/` — present but the backend uses raw SQL (pg), not Prisma.

## 2. Environment / services

| Service        | Port   | How to start                                                        |
|----------------|--------|---------------------------------------------------------------------|
| PostgreSQL     | 5432   | `pg_ctlcluster 15 main start` (root)                                |
| Redis          | 6379   | `redis-server --daemonize yes`                                      |
| Backend API    | 3001   | `cd backend && PORT=3001 node src/api/server.js`                    |
| Frontend (dev) | 3000   | `cd frontend && npm run dev`                                        |
| Mock upstream  | 3999   | `cd backend && node scripts/mock-upstream.js`                       |
| Preview        | tunnel | https://3000-1807d442a88c3aec.monkeycode-ai.live (from port 3000)   |

Backend env required for the dev server / tests:

```
AUTH_SECRET=dev-secret
VAULT_KEY=test-vault-key-do-not-use-in-prod
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub
```

- The frontend rewrites `/api/*` to `127.0.0.1:3001`; the mock upstream is only
  reachable from the backend process (same host).
- `allowedDevOrigins` in `frontend/next.config.mjs` already includes
  `.monkeycode-ai.live` for preview-domain access.

## 3. Seeded dev accounts (login via preview or API)

| Email                     | Password     | Role    |
|---------------------------|--------------|---------|
| boss1785867669@test.io    | bosspass123  | ADMIN   |
| pm1785867669@test.io      | pmpass1234   | MANAGER |
| dev1785867669@test.io     | devpass123   | EDITOR  |

Each has an org, a private "My Workspace" and a "Default Project" (mirrors the
signup bootstrap). Recreate any time with `cd backend && npm run seed:dev`.

## 4. Sample data & seed (retained)

The sample data survives DB resets because it is defined in code, not just in
the live DB:

- **App data seed**: `backend/scripts/seed-dev.js` (`npm run seed:dev`) is an
  idempotent script that (re)creates the three accounts above and, under the
  ADMIN's Default Project, a **"Mock API Demo"** collection with 6 requests:
  `GET all posts`, `GET post 1`, `POST create post`, `PUT replace post 1`,
  `PATCH post 1`, `DELETE post 2` — all pointed at the local mock upstream
  (http://127.0.0.1:3999). Rerunning is safe (users upserted, orgs/workspaces/
  projects/collections created only if missing, requests created-or-updated by
  name).
- **Mock data**: `backend/scripts/mock-data.json` holds the jsonplaceholder
  style seed records (posts/comments/users/todos). `backend/scripts/
  mock-upstream.js` loads this file at startup, so sample records are retained
  in the repo. NOTE: mutations (POST/PUT/DELETE) live in memory and reset on
  restart; `mock-data.json` is only the initial store.
- DB migrations are in `db/migrations/*.sql`. Migration `004_request_formula`
  adds `api_requests.formula text NOT NULL DEFAULT ''`.

## 5. What was done in this session (chronological)

### 5.22 Fix follow-ups on remote commit `7af6044` (Ctrl+Enter from editors + formula helpers panel + admin Access tab)

Pulled the remote fast-forward `26189c9..7af6044` ("fix(editor): ctrl+enter
sends request from body/formula editors; formula helpers stop covering the edit
pane", also bundling the admin Access tab). Inspected the commit, restarted the
backend so the new `admin.js` routes would load, then verified/fixed what the
commit introduced. Three fixes + verification:

**Fix 1 — `CodeEditor` runtime crash (regression from the commit).**
`CodeEditor.tsx` spread `...(extensionFor(language) as any[])`, but
`extensionFor` returns a single **non-iterable** `Extension` object (not an
array) for every language, so rendering any body/formula editor threw
`extensionFor is not a function or its return value is not iterable` and the
editor never appeared (caught via Playwright console/pageerror while smoke-
testing Ctrl+Enter). Fixed by wrapping it in an array first
(`const baseExtensions = [extensionFor(language)]`), then spreading.

**Fix 2 — formula helpers panel still covered the edit pane.**
The commit's CSS left the helper `flex-shrink: 0` with a `42vh` body cap, so on
the ~220px-tall formula tab the 337px helper overflowed and overlapped the
editor (measured via Playwright bounding boxes). Also, the commit targeted the
nonexistent `.cm-theme` wrapper class (the real one is `.cm-theme-dark`), so the
editor never filled its flex slot. Fixed in `globals.css`:
- `.formula-helper` → `flex: 0 1 auto; min-height: 0; max-height: 45%; display:
  flex; flex-direction: column` (shrinks to fit, never covers the editor).
- `.formula-helper-body` → `flex: 1; min-height: 0` (internal scroll instead of
  fixed `42vh`).
- Added `.formula-editor .code-editor .cm-theme-dark` alongside `.cm-theme` so
  the CodeMirror chain fills the remaining space.

**Fix 3 — backend running stale code.** The backend predated the commit, so the
new `/api/admin/access` routes weren't served; restarted it on :3001.

**Verified (not changed):** the Ctrl+Enter `onModEnter` keymap (`Prec.highest`)
works — standalone Playwright smoke confirms body and formula editors both run
the request with exactly **one** history row each (no double-fire; the global
handler skips `[data-mod-enter="true"]` editors). Admin Access tab renders and
all grant/revoke endpoints work (project members, managers, workspace members,
role selection) — smoke-tested with the boss admin login.

**Tests:** backend jest 47/47 · `test:api` 58/58 · `test:api:unit` 49/49 ·
frontend unit 68/68 · `tsc --noEmit` clean. E2e: request-tabs, scratchpad,
send-working-copy, dirty-dot, assertions-runner, rename-f2, folder-drag-move,
request-drag-move, request-duplicate pass standalone on a fresh reset+seeded DB.
Two full-suite failures (`send-working-copy`, `assertions-runner`) are the
**documented pre-existing ordering issue** — earlier specs mutate the shared
mock upstream (`/posts`) and leave requests in "Mock API Demo", so later specs
see `posts/2 not found` / `Requests: 9` instead of 8. Both pass standalone.

### 5.21 M14 — Rework scratchpad: full-width editor pane + save location picker (pushed this turn)

The M8 scratchpad modal was reworked into a full-width editor pane +
save-location picker (`instructions.md` M14). `ScratchpadWorkspace.tsx` renders
the pane in the main area (method select, URL input with cURL auto-parse,
Params/Headers/Body/Formula/Tests tabs, Send ephemeral / Save / Close, response
via `ResponsePane` in a split); `ScratchpadSaveModal.tsx` is the picker
(required name + all collections with nested folders as an indented tree;
confirm → `createRequest` + `updateRequest` + `reloadTree` + `selectRequest`).
`AppShell` renders the pane full-width and closes it on sidebar request
selection; `ScratchpadModal` removed. New shared lib `lib/scratchpadDraft.js`;
e2e `scratchpad.spec.ts` rewritten for the new UI. Final commit SHA to be
recorded in the `instructions.md` status table after push.

### 5.20 M12 + M13 — F2 rename shortcut + folder drag-move (pushed this turn)

Parallel-agent micro tasks completing the "Sidebar tree interactions" feature
set (M10–M13 all done, pushed with M10+M11 in `c7ac1f3`):

**M12 — F2 inline rename for the selected sidebar item**
- New `frontend/src/components/useTreeRenameShortcut.ts`: capture-mode F2
  keydown; ignores `INPUT`/`TEXTAREA`/`contentEditable` targets; calls
  `onStartRename(kind, id, name)` for the selected row.
- Wired into `CollectionsTree` in `Sidebar.tsx` (single call after
  `startRename`, deps `selectedRow` + `ws.tree` + `startRename`).
- New e2e `rename-f2.spec.ts` (rename request, rename folder, F2 ignored while
  typing in the URL input).

**M13 — drag-and-drop move of folders between nested folders**
- Reuses existing `PUT /api/folders/:id` with `parentId` (backend cycle guard
  already present). New store action `WorkspaceStore.moveFolder(folderId,
  parentId)` patches `tree.folders` locally.
- `Sidebar.handleDragStart` generalized to carry `kind: 'request'|'folder'`;
  folder rows are now `draggable={!isRenaming}`; `handleDrop` gained a folder
  path with a client-side cycle guard (folder into itself/descendant/root-when-
  already-root → `Cannot move a folder into itself or its subfolder` toast).
- `.tree-folder-row { cursor: grab }` affordance.
- New e2e `folder-drag-move.spec.ts`.

Verification: frontend `node --test` 56/56; `tsc --noEmit` clean; new e2e
4/4 + regressions (nav-normal, request-tabs, request-drag-move,
request-duplicate) all green. Backend untouched. Docs updated and committed.

### 5.19 M9 — Docs + wrap-up (pushed 2d3ee16)

Final micro task of the "Postman-style request editing" feature set — the
feature is **fully shipped** (M1–M9 all done). M9 wrapped up the runbook docs
and made the final commit; no source, test, or DB changes:
- `session.md` — Current status → **COMPLETE (M1–M9 done)**; M9 DONE block in
  Current; M9 marked DONE in the Plan (micro tasks) list and added to the
  "Completed (this feature)" log.
- `instructions.md` — M9 status-table row → done.
- This log — dated narrative entry added (newest first).
- Final commit records the full feature set.

### 5.1 Pre-request Formula feature (completed, committed in 472cdf4 as partial)
Already committed before this session's remaining work:
- `db/migrations/004_request_formula.sql` — formula column on `api_requests`.
- `backend/src/api/runner.js` — `loadRequest()` selects formula; `runRequest()`
  builds `req = {method,url,headers,query,body}`, runs the formula in a 150 ms
  sandbox via `FormulaRunner`, merges mutated `req`/`vars` back, substitutes
  `{{vars}}`, then fetches. Auth-token flow and `run_history` snapshot kept.
- `backend/src/api/routes/content.js` — GET `/requests/:id` returns `formula`;
  PUT persists it.
- `frontend/src/store/WorkspaceStore.tsx` + `frontend/src/lib/api.ts` —
  formula round-trips through the editor.

### 5.2 Sandbox helper expansion (this session, uncommitted)
`backend/src/sandbox/formulaRunner.js` — the `HELPERS_SOURCE` IIFE (sandboxed,
pure JS, no Node builtins) now also exposes: `addHours`, `addMinutes`,
`addMonths` (clamps to end of month), `timestamp()` (epoch ms), `capitalize`,
`lower`, `upper`, `trim`, `base64Encode`, `base64Decode` (own UTF-8 + base64
implementations; verified byte-for-byte against Node's `Buffer`).
`frontend/src/components/FormulaHelper.tsx` snippet picker updated to match the
new helper names.
Tests: extended `backend/tests/sandbox.rce.test.js` and added a formula
integration test in `backend/tests/apiAuth.integration.test.cjs` (creates a
JSON-body request with `req.body.userId = 2`, runs it, asserts the dispatched
and upstream-echoed bodies contain `userId: 2`, and asserts
`GET /requests/:id` round-trips the saved formula).

### 5.3 Mock API for GET/POST/PUT checks (this session, uncommitted)
`backend/scripts/mock-upstream.js` is now a jsonplaceholder-style REST mock on
3999: `GET/POST/PUT/PATCH/DELETE` on `posts`, `users`, `comments`, `todos`
(in-memory store seeded from `mock-data.json`), plus the legacy `/token` and
`/echo` endpoints. Demo requests live in the "Mock API Demo" collection.

### 5.4 Seed retention (this session, uncommitted)
- `backend/scripts/seed-dev.js` + `npm run seed:dev` (see section 4).
- `backend/package.json` — added `seed:dev` script.

### 5.5 Polish items — verified end-to-end (this turn)
The three user-reported polish items were implemented in the prior commit (commit `8bde46f`) with
Playwright regression specs. This turn rebuilt the environment from scratch (PostgreSQL 15,
Redis, `frontend/node_modules`, Playwright chromium) and **ran the full matrix green**:
- `frontend/e2e/nav-from-manage.spec.ts` — sidebar workspace panel hidden on `/manage`,
  `/admin`, `/automations`; icon rail stays; rail-apis returns to the editor.
- `frontend/e2e/modal-create-user.spec.ts` — create-user modal overlays as a fixed, centered,
  scrollable card and does not grow the document.
- `frontend/e2e/large-response.spec.ts` — 200 KB POST body response scrolls inside the
  response pane; document height stays ≤ viewport.

How each fix works (all CSS in `frontend/app/globals.css`):
1. Sidebar: `AppShell.tsx` renders `<Sidebar panelHidden={view !== 'workspace'} />`; the class
   `.sidebar-panel-hidden { display: none }` hides the workspace chips + collections tree while
   the `.rail` (icon rail) remains for navigation.
2. Modal: `.modal-overlay` is `position: fixed; inset: 0` with centered flex; `.modal` is
   `width:640px; max-width:92vw; max-height:88vh` and `.modal-body { overflow-y:auto }`.
3. Response pane: `.response-pane`/`.app-body` keep `min-height:0`; `.response-body .code-editor`
   is `flex:1; min-height:0; overflow:hidden`, the CodeMirror chain resolves `height:100%` down to
   `.cm-scroller { overflow:auto !important }`.

### 5.6 Admin users are now project-wise (this turn, committed in a5b12bb)
User request: "Users are not project wise, in admin panel users". The admin Users list previously
showed a flat global user table with no project association.
- `backend/src/api/routes/admin.js` `GET /api/admin/users` now aggregates each user's project
  memberships from `project_managers` + `project_members` into a `projects[]` array of
  `{id, name, kind: 'manager'|'member', role}`.
- `frontend/src/components/views/AdminView.tsx` renders a **Projects** column with per-project
  chips (MANAGER projects highlighted in blue); `AdminUser` in `lib/api.ts` gained `projects`.
- New CSS: `.admin-project-chips`, `.admin-project-chip`, `.admin-project-role`,
  `.admin-project-chip.is-manager` in `globals.css`.
- Verified: backend `test:api` 16/16, frontend unit 28/28 + `next build` OK, e2e 11/11.
- NOTE: demo project-wise rows (pm=MANAGER, dev=VIEWER of the ADMIN's Default Project) were
  inserted directly into the dev DB, NOT part of `seed:dev`.

### 5.7 Workflow steps can now pass the previous request/response into the next (this turn)
User request: "Do we have an option to pass the request to next flow and the response to next
flow in workflow? If that is not available then implement that." Response pass-through already
worked (each step's parsed body is stored under `vars[stepId]`, so `{{order.id}}` templates and
`$vars.order.id` formulas chained steps), but the previous step's REQUEST snapshot was not exposed
and there was no UI option. Implemented:
- `backend/src/workflow/workflowEngine.js` stores friendly vars after every successful step:
  `vars.step.<stepId>` and `vars.step.<labelKey>` (parsed body), `vars.stepRequest.<labelKey>`
  (outgoing request snapshot), `vars.stepResponse.<labelKey>` (full response). `labelKey` comes
  from `sanitizeLabel(label)` ("Create the order" -> `create_the_order`). `$steps.<id>.request`
  summaries now include the request snapshot too. `vars[stepId]` is kept for backward compat.
- `backend/src/engine/requestDispatcher.js` gained a `passInputs` option (passed from each
  workflow step): `{ sourceStepId, data: 'request'|'response', field?: 'a.b', target,
  targetKey? }` injects a resolved value into the current request as a URL query param (`url`),
  query param (`query`), header (`header`) or body merge/key (`body`). Runs after the formula and
  before template substitution; ignored silently if the source step's value is missing.
- `frontend/src/components/WorkflowBuilder.tsx` per-step **"Pass data from previous step into this
  request"** section: source-step select (earlier steps only), data type (Request/Response),
  optional dot-path field, target (Header/Query param/URL param/Body) and destination key, with
  an add/remove list and copyable reference chips `{{step.<key>.response}}`,
  `{{stepRequest.<key>.url}}`, `{{stepResponse.<key>.status}}`.
- `frontend/src/lib/workflowValidation.js` rejects passInputs whose source step does not run
  before the step, unknown data/target values, or missing destination keys for url/query/header.
  `sanitizeLabel` exported and mirrored on the backend.
- `frontend/src/lib/types.ts` adds `StepPassInput` + `WorkflowStep.passInputs`.
- Tests: backend jest `workflowChaining.integration.test.js` (new passInputs test, 7/7),
  frontend unit 34/34 (6 new), new e2e spec `e2e/workflow-pass-inputs.spec.ts` (3 tests),
  full e2e 14/14, TS `--noEmit` clean.

### 5.8 Response assertions + collection runner (this turn, committed in 222cd58)
User request: build the backlog features one by one. FEATURE 1 = response assertions / collection
runner. The backend engine had already landed in `77ca26c` (`backend/src/engine/assertions.js`,
`runner.js` evaluates assertions and returns `testResults`/`assertionsPassed`,
`POST /api/collections/:id/run`, migration `006_request_assertions.sql`, `content.js` round-trips
`assertions`). This turn added the frontend:
- `types.ts`: `Assertion`, `assertions` on `ApiRequest`, `'tests'` request tab,
  `RunResult.testResults`/`assertionsPassed`, `CollectionRunResult`.
- `api.ts`: `RequestDetail.assertions`, `contentApi.runCollection()`.
- `WorkspaceStore.tsx`: assertions round-trip + `runCollection` action (`collectionRun` state).
- `RequestConfigurator.tsx`: **Tests** tab (`AssertionsEditor`); fixed a pre-existing Rules-of-Hooks
  violation (useState after an early return).
- `ResponsePane.tsx`: assertion result chips/list after each run.
- `Sidebar.tsx`: per-collection **Run** button → `CollectionRunnerModal` (per-request results +
  summary). Pure helpers in `lib/assertions.js` (unit tested).
- Tests: frontend unit 37/37, e2e 15/15 (new `e2e/assertions-runner.spec.ts`), backend jest 47/47,
  test:api 16/16, api:unit 14/14, db tests pass, tsc clean.
- ENV NOTES: dev DB had been reset → `npm run seed:dev`; the backend process was stale (pre-pull
  code) → restarted; migration 006 must be applied manually after a plain reset (see §8).

### 5.9 Workflow event triggers + richer notifications (this turn, committed in c15149e)
FEATURE 5 from the backlog. Two new automation trigger types + richer failure notifications:
- **ON_REQUEST**: runs the automation's workflow after a request in the project executes.
  Optionally bound to a single watched request (`event_request_id`, NULL = any request).
- **ON_RUN_FAILURE**: runs the workflow when a run in the project fails. Optionally bound to a
  single watched workflow (`source_workflow_id`, NULL = any run). Loop-guarded: never re-fires
  for runs that were themselves started by an ON_RUN_FAILURE event.
- Migration `008_workflow_event_triggers.sql`: widened `automations.trigger_type` CHECK, added
  `event_request_id` / `source_workflow_id` / `notify_webhook_url` (+ indexes), added `run_trigger`
  enum values `ON_REQUEST` / `ON_RUN_FAILURE`, and `notifications.payload` (jsonb) + `link`.
- `workflowService.fireWorkflowEvent()` matches enabled automations by trigger type + project
  (+ optional watch target), runs their workflows with the event context injected as
  `{{event.*}}` input vars. `reflectInAutomations` now resolves the failing run's project from
  `run_history` (JOIN workflow_chains / collections — the table has no project_id column),
  writes `payload` + `/automations` `link` on in-app failure notifications, and POSTs a
  `{event:'run_failed',...}` JSON payload to `notify_webhook_url` when set (fire-and-forget,
  5s timeout, http(s) only).
- Routes: `automations.js` accepts the new trigger types + fields (with "target must be in this
  project" validation) and exposes them via `toApi`; `content.js` fires ON_REQUEST after every
  request run and ON_RUN_FAILURE on a failed run in the single-run and collection-run handlers.
- Frontend: `AutomationsView.tsx` modal adds "On request run"/"On run failure" options with a
  watch-request / watch-workflow selector + an optional notify webhook URL; cards render the
  trigger type + watch target + webhook. `api.ts` extends `Automation`/`AutomationInput`/
  `Notification` (payload + link).
- `seed-dev.js` now calls `ensureAdminDemoRows()` from `main()` — one `npm run seed:dev` also
  restores the pm=MANAGER / dev=VIEWER demo rows (previously manual SQL only).
- Tests: `backend/tests/automationEvents.integration.test.cjs` (4: create/validate new trigger
  types; ON_REQUEST fires; ON_RUN_FAILURE fires; richer notification + webhook delivery via a
  local capture HTTP server). e2e `frontend/e2e/automations-events.spec.ts` (2). The engine is
  exercised end-to-end (BullMQ + Redis are up).
- Verified matrix: backend jest **47/47**, `test:api` **29/29** (+4), `test:api:unit` **24/24**,
  db tests all pass, frontend unit **42/42**, `tsc --noEmit` clean, e2e **21/21** (+2).
- Backend restarted (`term_1786129995092_9` PID 17833, :3001). Preview:
  https://3000-606b9b46b8d0d0bf.monkeycode-ai.live
- NOTE for the next agent: the full e2e suite is only green when run on a freshly reseeded DB —
  `history.spec.ts` and `mock-server.spec.ts` each leave a request inside the seeded "Mock API
  Demo" collection, so `assertions-runner.spec.ts` ("Requests: 8") fails on the second run without
  a reseed (or manual cleanup of `history-e2e-request` / `mock-e2e-request`).

### 5.10 Sidebar collapses to icon rail on top-level pages (this turn)
Follow-up on the sidebar polish: the panel content was already hidden on `/automations` `/manage`
`/admin` (`.sidebar-panel-hidden`), but the `.sidebar` `<aside>` kept its 296px width — leaving a
large empty column next to the rail. Fix:
- `frontend/src/components/Sidebar.tsx` — the `<aside>` gets `sidebar-rail-only` when
  `panelHidden` is true.
- `frontend/app/globals.css` — `.sidebar-rail-only { width:48px; min-width:48px }` collapses the
  shell to the icon-rail width so the panel pages use the full remaining width.
- No tests run this turn (user directive: "Just fix that don't do any testing"); the running dev
  server recompiled clean and serves `/` + `/automations` (200). `nav-from-manage.spec.ts` remains
  the regression for this behavior.

### 5.11 Collection folders + Aiven Postgres (pushed as `b61a2c6`)

Postman-style nested folders inside collections, running against **Aiven cloud Postgres**.

- **DB**: gitignored `backend/.env` supplies `DATABASE_URL=…?sslmode=require`; `db.js` reads it and
  uses `db/ca.pem` (gitignored) as the SSL trust store, unless explicit `PG*` vars are set (tests/
  psql stay on local Postgres). Migrations 001–011 applied on Aiven; DB seeded with demo accounts +
  "Mock API Demo".
- **Migration `db/migrations/011_folders.sql`**: `folders (id, collection_id, name, parent_id, …)`
  with cascade deletes (deleting a folder removes nested sub-folders), `api_requests.folder_id`
  FK (SET NULL on delete → requests resurface at collection root), RLS consistent with the
  `app.*` helpers. (`011_collection_folders.sql` on the earlier feature branch was superseded by
  this final shape.)
- **Backend** (`backend/src/api/routes/content.js`): `POST /folders`, `PUT /folders/:folderId`
  (rename or re-parent, with self/descendant cycle guard), `DELETE /folders/:folderId`;
  `POST /requests` / `PUT /requests/:requestId` accept `folder_id`; the workspace content tree
  (`GET /workspaces/:workspaceId/content`) now returns `folders[]` alongside collections/requests.
- **Frontend**: `Sidebar.tsx` renders nested folders in the tree; `CreateModal.tsx` gains folder
  creation (re-parenting via drag-drop); `WorkspaceStore.tsx` + `lib/api.ts` carry
  folders/`folder_id`; per-request edit/rename/delete unchanged.
- **Tests added**: `backend/tests/folders.integration.test.cjs`, `db/tests/04_collection_folders.sql`.
- `next build` re-verified clean (2026-08-15). Frontend unit / e2e / backend `api:unit` not yet
  re-run against the folders change — see root `session.md` test-status note.

### 5.12 New API request modal — paste cURL directly (this turn, uncommitted)

The **New API request** modal (`frontend/src/components/CreateModal.tsx`) gained a **Fill form /
Paste cURL** toggle. In cURL mode the URL field is not required — the user pastes a `curl …`
command and it is structured by the existing `lib/curl.js` `parseCurl` into method, URL, query
params, headers, and body (JSON/form/multipart/raw auto-detected). The request is created via
`POST /api/requests` then the structured fields are applied with `PUT /api/requests/:id`
(mirroring the TopBar `CurlModal` import flow). Name is optional and auto-derived as
`METHOD host`. Verified live against the Aiven DB (POST orders curl → all fields round-trip);
`tsc --noEmit` + `next build` clean. New testids: `create-mode-toggle`, `create-mode-form`,
`create-mode-curl`, `create-curl-input`.

### 5.13 Postman-style request editing — M1/M2 + Ctrl+Enter (pushed e80c29c, e61cc82, 1f79920)

Started the user-approved "Postman-style request editing" feature set
(`instructions.md` micro tasks M1–M9). This covers M1, M2 and an extra shortcut:

- **M1** — `CreateModal` cURL auto-detect (pushed `e80c29c`): removed the
  Fill-form / Paste-cURL toggle (`.create-mode-*` CSS dropped). The URL field now
  auto-detects a pasted `curl …` via `isCurlCommand` + `parseCurl` (shared
  `frontend/src/lib/curl.js`), populating method + URL live; structured
  headers/params/body are applied on create. Name stays optional with the
  `METHOD host` fallback. Testids preserved: `new-api-modal`, `create-name`,
  `create-method`, `create-url`, `create-submit`.
- **M2** — URL-field cURL auto-parse in the existing editor (pushed `e61cc82`):
  `RequestConfigurator.tsx` `onUrlChange` detects `curl …` pasted into
  `url-input`, runs `parseCurl`, and applies method, URL, headers, queryParams,
  bodyType/bodyJson to the working request via `updateActiveRequest`, with a
  "cURL parsed into the request." toast.
- **Extra** — Ctrl/Cmd+Enter anywhere in the editor triggers Send
  (`runActiveRequest`); Send button label reads "Send (Ctrl+Enter)" (pushed in
  `1f79920`, a Rules-of-Hooks fix moving the listener above the early return).

### 5.14 M3 — dirty-state tracking in WorkspaceStore (pushed cb2451c)

`frontend/src/store/WorkspaceStore.tsx` now stores a `savedBaseline` snapshot of
the dirty-relevant request fields (method, url, headers, queryParams, bodyType,
bodyJson, formula, assertions), captured in `selectRequest` and after
`saveActiveRequest` succeeds. `isDirty` is derived by deep-comparing the working
copy against the baseline and is exposed on the store/context (feeds M4).
Cleared on save success and on select. Verified: `tsc --noEmit` clean,
`next build` green, 47/47 frontend unit tests.

### 5.15 M4 + M5 — dirty dot indicator + ephemeral run endpoint (pushed 2ad35d2, d9c80b4)

- **M4** (pushed `2ad35d2`): when `isDirty` is true the editor's Save button
  shows a `data-testid="unsaved-dot"` `•` (colour `--warn`) with
  title/aria-label "You have unsaved changes"; it clears on save. CSS
  `.unsaved-dot` in `frontend/app/globals.css`. New self-contained e2e spec
  `frontend/e2e/dirty-dot.spec.ts` (fresh user + own request): no dot on load →
  dot on edit → dot gone after save. tsc/build clean, 47/47 units,
  curl-import + nav-normal e2e still pass.
- **M5** (pushed `d9c80b4`): new authenticated `POST /api/runs` executing an
  in-memory request shape (method, url, headers, queryParams, bodyType,
  bodyJson, formula, assertions) with optional `collectionId` (env-var
  resolution + folder auth provider, read-access enforced) and optional
  `persistHistory`. `backend/src/api/runner.js` refactored: the fetch pipeline
  was extracted into `executePipeline` (vars → formula → auth provider → HTTP →
  assertions → history), shared by `runRequest` (stored) and the new
  `runInMemoryRequest`; `resolveVariables`/`activeEnvironmentId` were
  generalized to key off a `collectionId`. `run_history` is only written when
  `persistHistory` is true (`request_id` NULL — the migration-005 nullable FK
  allows it; history read path already LEFT JOINs, verified). New integration
  test file `backend/tests/ephemeralRuns.integration.test.cjs` (5 tests);
  backend jest 47/47, API units 49/49, existing integration suites green;
  live smoke on the running backend.

### 5.16 M6 — Send uses the working copy (pushed 6dd891e)

`WorkspaceStore.runActiveRequest` now runs the **working copy**: when `isDirty`
it calls the new `contentApi.runEphemeral` (`POST /api/runs`, added in
`frontend/src/lib/api.ts`) with the current editor state + `activeCollectionId`
and `persistHistory: false` — unsaved edits take effect immediately, no
`run_history` row is written, and the stored request is untouched. When the
request is clean it keeps `POST /requests/:id/run` so run_history stays linked
to the request exactly as before. New e2e spec `frontend/e2e/send-working-copy.
spec.ts`: clean send → response `/posts/1` + one history row; edit URL to
`/posts/2` → dirty send executes `/posts/2`, history count unchanged, unsaved
dot stays, stored URL still `/posts/1`. Also typed the implicit-any callbacks
in `dirty-dot.spec.ts`. Verified: `tsc --noEmit` clean, `next build` green,
47/47 frontend unit tests, dirty-dot/curl-import/assertions-runner e2e pass.

### 5.17 M7 — Tabs for opened requests (pushed 183d7ab)

Browser-style tab strip of every open request. `WorkspaceStore` gained
`openRequestIds[]` + `activeRequestId` + `requestCopies{}` (a working copy per
open request, so unsaved edits survive tab switches) + `baselines{}`
(per-request saved baseline). `selectRequest` opens a request once (dedupe) or
activates an already-open tab without refetching; `closeRequestTab` removes the
tab and activates a neighbour (right, else left); `isTabDirty` exposes per-tab
dirty state; delete/select flows close affected tabs. Pure helpers
`frontend/src/lib/tabs.js` (`openTab`/`closeTab`) with `tabs.test.cjs` (6
node:test cases). New `RequestTabs` component (method badge + name + dirty dot +
close ×, `window.confirm` when closing a dirty tab) rendered above the editor
in `AppShell`, styled in `globals.css`. New e2e
`frontend/e2e/request-tabs.spec.ts` (2 tests: working-copy preservation + dirty
dot + close-confirm; neighbour activation). `dirty-dot.spec.ts` and
`send-working-copy.spec.ts` were scoped to the Save-button dot because tabs now
carry their own dots. Verified: `tsc --noEmit` clean, `next build` green, new
unit 6/6, new e2e 2/2, affected e2e 2/2.

### 5.18 M8 — Test cURL without saving (scratchpad) (pushed 75143f7)

Postman-style scratchpad: run a pasted cURL command immediately without saving
anything. New TopBar "Test cURL" button (`topbar-test-curl`) opens
`ScratchpadModal`. Pasting a curl command into the textarea (`scratchpad-input`)
produces a live structured preview (`scratchpad-preview`: method badge + URL,
headers, query params, and body groups) via the existing M1 `parseCurl` /
`isCurlCommand`. **Send** (`scratchpad-send`) maps the parse output to the
ephemeral run input through the pure helper `frontend/src/lib/scratchpad.js`
(`scratchpadRequest`: `apiType:'REST'`, `persistHistory` absent, `collectionId`
null), then `WorkspaceStore.runScratchpad` calls `contentApi.runEphemeral`
(`POST /api/runs`) — no request row and no `run_history` row are created, the
stored request is untouched. On success the modal closes, view switches to
side-by-side, ResponsePane shows the result, and a toast says "Scratchpad
request executed (nothing saved)." Non-curl input shows a "Paste a curl command"
hint and Send reports "Could not find a URL". Unit tests
`frontend/src/lib/__tests__/scratchpad.test.cjs` (3 node:test cases) cover the
ephemeral shape mapping. e2e `frontend/e2e/scratchpad.spec.ts` (2 tests): fresh
user pastes `curl -X POST .../posts` → preview shows POST + URL + "Headers (1)"
→ Send → ResponsePane shows `"title": "scratch"` + 201 and the collection still
has 0 requests; and the non-curl rejection path. Verified: `tsc --noEmit`
clean, new unit 3/3, new e2e 2/2. Full suite + `next build` deferred to the
final M9 wrap-up per user instruction.

## 6. Verification performed

- Formula live check (API): set `formula: "req.body.userId = 2"` on a POST to
  the mock, `GET /requests/:id` returns the formula, Run dispatches
  `{"amount":19.99,"userId":2}`, upstream echoes `userId: 2`,
  `run_history.request_snapshot` persists the mutated body.
- All six mock API requests run through the app successfully
  (GET 200, POST 201, PUT 200, PATCH 200, DELETE 200).
- Full reset → `npm run seed:dev` → login as all three accounts → demo
  collection present with 6 requests → runs work → formula still mutates body
  (`req.body.userId = 42` dispatched as `userId: 42`).

### Test matrix (all green at last run)
- Backend: `npm run test:api` 16/16 · `npm run test:api:unit` 14/14 ·
  `npm test` (jest) **40/40** (includes the new passInputs chaining test).
- Frontend: `npm run test` **34/34** · `tsc --noEmit` clean · `npm run test:e2e`
  (Playwright) **14/14** (11 existing + 3 new workflow pass-inputs specs).
- DB: `cd db && bash tests/run.sh` — all pass (includes migration 005).

## 7. Current uncommitted changes

All M1–M6 code + docs are committed and pushed on `master` (HEAD `6dd891e`).
Remaining working-tree noise:

```
M  frontend/tsconfig.tsbuildinfo      (build artifact; left by convention)
?? package-lock.json                  (stray empty root lockfile from a failed root `npm install`)
```

The response-pane prettify/preview/PDF feature and all prior session work are
already committed and pushed on `master`.

## 8. Known issues / notes for the next agent

- ~~**Deleting a run request via the API fails**~~ **FIXED**: migration
  `005_relax_run_history_target.sql` relaxes the `run_history_target` CHECK constraint to
  `NOT (request_id IS NOT NULL AND workflow_id IS NOT NULL)`, so `ON DELETE SET NULL` from a request/
  workflow deletion no longer violates it. Run history is preserved as an audit trail; the manage
  `/history` query labels orphaned rows `(deleted)` via a third `COALESCE` fallback. Regression test
  added to `apiAuth.integration.test.cjs` (run a request → delete it → 200, rows preserved). App RLS
  hides both-null rows from user-visible history, which is acceptable.
- **Production build bug fixed**: `Sidebar.tsx` was missing `import Link from 'next/link'` (added);
  `next build` now passes. `npm run test:e2e` may spawn its own dev server and conflict with a running
  one on port 3000 — kill existing `next dev` before running e2e, or rely on `reuseExistingServer`.
- The mock store is in-memory; restarting `mock-upstream.js` resets POST/PUT/
  DELETE mutations back to `mock-data.json`.
- `redis-cli config set dir` is a protected setting in this build; Redis was
  pointed away from the repo so no `dump.rdb` is written into `/workspace`
  (snapshots disabled via `save ""`).
- During this turn the dev DB had been reset (seed users gone), which made the
  nav/login e2e specs fail with "Invalid email or password". Fix: `cd backend &&
  npm run seed:dev`. The admin demo rows (pm=MANAGER, dev=VIEWER of the ADMIN's
  Default Project) are ALSO restored by `seed:dev` now (`ensureAdminDemoRows` in
  `main()`); previously they needed manual SQL into `project_managers` /
  `project_members`. After any `db/tests/run.sh` or DB reset, re-run `seed:dev`
  before running e2e.
- Installing Postgres/Redis/Playwright was required in this environment (they
  were absent); see section 2 for how they are started.

## 9. How to continue

**Working order (user-mandated):** 1) update `session.md` first, 2) make the
changes, 3) commit + push to `origin/master`, 4) update `session.md` again
after the push with what was completed and push that update too.

1. If services are down, start them per section 2, then hit the preview link.
2. If the DB was reset (e.g., by `db/tests/run.sh` or an integration test),
   restore sample data with `cd backend && npm run seed:dev`.
3. Sign in as `boss1785867669@test.io` / `bosspass123`, open "Mock API Demo",
   press Run on any request to confirm the stack.
4. The `DELETE /requests/:id` run-history bug is fixed (section 8).

## 10. Archive — root `session.md` turn log (moved 2026-08-08)

Moved verbatim out of the root `session.md` during **Step S0** (restructure). Newest first.
Nothing was deleted — this is the durable narrative history of the pre-S0 turns.

### 10.1 BACKLOG #7 — Share links for requests (pushed as `ac6cd52` on 2026-08-08)

BACKLOG ITEM **#7 — Share links for requests** is DONE and on `origin/master`:
- Migration `009_request_shares.sql` — `request_shares` table (request_id FK CASCADE,
  unguessable uuid `token`, created_by, created_at) + index.
- Backend `backend/src/api/routes/shares.js` (mounted at `/api` BEFORE the auth-gated routers so
  the public read isn't intercepted by their router-level `requireAuth`):
  - `POST /api/requests/:requestId/share` — idempotent (returns the existing link), EDITOR+
    gated via `getProjectAccess`/`roleAtLeast`, audit-logged.
  - `GET /api/shares/:token` — **public, no auth**. Loads the request + the latest run's
    response snapshot from `run_history`; redacts sensitive header keys
    (`authorization`, `cookie`, `set-cookie`, `x-api-key`, …) in both request kv-rows and
    response headers.
  - `DELETE /api/shares/:token` — revoke (owner or ADMIN or EDITOR+).
- Frontend: `shareApi` in `api.ts` (`create`/`get`/`revoke`); `ShareLinksModal.tsx` (create,
  copy, revoke; `share-url-input` / `share-copy-button` / `share-revoke-button` test ids);
  "Share" button (`share-open-button`) in the `RequestConfigurator` bar + `ShareIcon`; public
  read-only page `app/s/[token]/page.tsx` (renders outside AppShell so it needs no login;
  request method/url/headers/params/body + latest response with status chip).
- Tests: `backend/tests/shares.integration.test.cjs` (2: create/read-publicly-redacted/revoke +
  non-editor denied). e2e `frontend/e2e/share-links.spec.ts` is self-contained (creates a
  throwaway request → shares → opens public page in an anonymous context → revokes → deletes)
  so it never pollutes shared seed data.
- Verified matrix green: backend integration **35/35** (test:api incl. new shares spec), jest
  **47/47**, api units **24/24**, `db/tests/run.sh` **all pass**, frontend unit **47/47**,
  `tsc --noEmit` clean, **e2e 23/23** on a fresh `reset:db` + `seed:dev`.
- Env notes: backend restarted to load the shares route (`term_1786220734805_18` PID 29387
  :3001); DB reset during testing, re-seeded after. E2E full-suite still requires a freshly
  reset+seeded DB (other specs leave requests in "Mock API Demo" — the "Requests: 8" assertion
  in `assertions-runner.spec.ts` breaks otherwise).

### 10.2 BACKLOG #6 — Export / import collections (pushed as `f496e7f` on 2026-08-08)

User request: "okay mark the completed things as completed, and proceed with #6".
- Housekeeping: marked backlog item **#4 Mock server per project** as DONE (verified existing code,
  just wasn't flagged in the backlog).
- **#6 Export / import collections** implemented and verified:
  - Backend `backend/src/api/routes/exports.js` (mounted at `/api` in `server.js`):
    `GET /api/collections/:collectionId/export` serializes a collection as `api-hub-collection`
    v1 JSON (name, requests incl. method/url/headers/query_params/body/api_type/formula/
    assertions, + optional auth provider); read-access gated.
    `POST /api/collections/import` validates the payload, creates the collection + requests in a
    transaction (EDITOR+ gated), re-links `auth_providers.token_request_id` via exported `sourceId`.
  - Frontend: `src/lib/collectionExport.js` (parse/build JSON/curl/OpenAPI, `formatForDownload`),
    `src/components/CollectionImportExportModal.tsx` (Export/Import tabs, file picker, target
    project select), wired into `Sidebar.tsx` as the `open-import-export` button beside "New
    collection", reloads the tree after import; `.modal-tabs`/`.modal-tab` in `globals.css`;
    types + `collectionExportApi` in `src/lib/api.ts`.
  - Tests: `backend/tests/exportImport.integration.test.cjs` (4 pass), `frontend/src/lib/__tests__/
    collectionExport.test.cjs` (5 pass), `frontend/e2e/collection-export-import.spec.ts`.
  - Full verification green: backend integration matrix (apiAuth 16, environments 4, exportImport 4,
    history 2, mockServer 3, automationEvents 4) + jest 47 + api units 24 + `db/tests/run.sh`;
    frontend jest 47 + `tsc --noEmit`; **full e2e suite 22/22 pass** on a freshly reseeded DB.
- e2e hardening done while getting the suite green:
  - `collection-export-import.spec.ts` is self-contained (creates a throwaway collection via API,
    exports/imports it, deletes both at the end) so it never pollutes the shared seeded DB.
  - `nav-from-manage.spec.ts` — raised the `toHaveURL` timeout to 15s for first-visit top-level
    routes (Next.js dev-mode route compile makes the URL lag behind the rendered page).
  - Full-suite requirements: mock upstream must be running (`backend/scripts/mock-upstream.js` on
    :3999) — request-run specs (`assertions-runner`, `environments`, `history`, `large-response`)
    assert `Status: 200` against it; and the DB must be reseeded before a full run (shared-DB
    convention noted in session.md).
- Added root `.gitignore` (node_modules, `.next`, `tsconfig.tsbuildinfo`, `test-results`,
  `dump.rdb`, logs).

### 10.3 Top-bar cleanup + collapsible sidebar (pushed as `e06b819` on 2026-08-08)

User request: "Remove automation, manage, admin from top bar and make the side bar collapsible."
Done and on `origin/master`:
- `frontend/src/components/TopBar.tsx` — the `automations-link` / `manage-link` / `admin-link`
  top-bar buttons are gone; nav to those views stays on the sidebar icon rail
  (`rail-automations` / `rail-manage` / `rail-admin`). Unused `Link` / `useNav` / `BoltIcon` /
  `ShieldIcon` / `UserIcon` imports were dropped from the file.
- `frontend/src/components/Sidebar.tsx` — user toggle implemented: a `collapsed` state merged
  with the existing `panelHidden` prop via `railHidden = panelHidden || collapsed` (so the panel
  pages still force rail-only). A rail collapse/expand button (`rail-toggle`,
  `data-testid="sidebar-toggle"`) sits at the bottom of the rail (pushed down by `.rail-spacer`);
  when collapsed the panel is hidden (`.sidebar-panel-hidden`) and the shell shrinks to rail
  width (`.sidebar-rail-only`). Clicking `rail-apis` / `rail-teams` auto-expands and returns to
  the workspace view.
- `frontend/app/globals.css` — `.rail-toggle` chevron rotation (points right when collapsed,
  left when expanded), `.rail-spacer` (flex:1), reuse of `.sidebar-rail-only` /
  `.sidebar-panel-hidden` for the collapsed state.
- Verified: `tsc --noEmit` clean; dev server recompiled clean; `GET /` `/automations` `/manage`
  `/admin` `/history` `/login` all 200. No tests run (previous turns' directive).
- NOTE: this turn's code was already in the tree (the repo history was squashed to a single
  commit `3529b78`), so the push here carried the `session.md` update that marks it complete.

### 10.4 Notification bell closes on outside click (pushed as `326607c` on 2026-08-08)

- `frontend/src/components/TopBar.tsx` — `NotificationBell` gained `bellRef` + a `document
  mousedown` listener that closes the dropdown when the click is outside `.bell-wrap` (same pattern
  as the views-menu, which already did this).
- No test run; dev server recompiled clean.

### 10.5 Sidebar collapses to icon rail on top-level pages (pushed as `e0e811c` on 2026-08-08)

- `frontend/src/components/Sidebar.tsx` — the `<aside>` gains `sidebar-rail-only` when
  `panelHidden` is true.
- `frontend/app/globals.css` — `.sidebar-rail-only { width:48px; min-width:48px }` collapses the
  shell to rail width so panel pages use the full remaining width.
- No tests run (user directive this turn: "Just fix that don't do any testing"). Dev server
  recompiled clean; `GET /` + `/automations` 200. `nav-from-manage.spec.ts` remains the regression.

### 10.6 BACKLOG #5 — Workflow triggers & notifications (pushed as `c15149e` on 2026-08-07)

BACKLOG ITEM **#5 — Workflow triggers & notifications** is DONE and on `origin/master`:
- Two new automation trigger types:
  - **ON_REQUEST** — runs the workflow after a request in the project executes. Optionally
    bound to one watched request (`event_request_id`); NULL = any request in the project.
  - **ON_RUN_FAILURE** — runs the workflow when a run in the project fails. Optionally bound to
    one watched workflow (`source_workflow_id`); NULL = any run. Loop-guarded (never re-fires for
    runs that were themselves triggered by ON_RUN_FAILURE).
- Migration `008_workflow_event_triggers.sql`: widened `automations.trigger_type` CHECK, added
  `event_request_id`, `source_workflow_id`, `notify_webhook_url` + indexes; added `run_trigger`
  enum values `ON_REQUEST`/`ON_RUN_FAILURE`; added `notifications.payload` (jsonb) + `link`.
- Richer notifications: in-app failure notifications now carry a structured `payload` (runId,
  projectId, workflowId, status) + a `/automations` deep `link`; automations can set an optional
  `notify_webhook_url` that receives a `{event:'run_failed', ...}` JSON POST on failure
  (fire-and-forget, 5s timeout, http(s) only).
- `workflowService.fireWorkflowEvent()` injects the event context into the workflow's input vars
  under `{{event.*}}` (type, projectId, requestId, sourceWorkflowId, runId, status, httpStatus,
  method, url). Fired from request runs (`content.js` run routes: single-run + collection runner)
  and from `reflectInAutomations` for failed workflow runs.
- Frontend: `AutomationsView` modal now offers the two event triggers, a Watch-request /
  Watch-workflow selector, and a notify webhook URL field; cards show the trigger type + watch
  target + webhook. `Automation`/`Notification` types extended in `api.ts`.
- Tests: backend `automationEvents.integration.test.cjs` (4 tests: create/validate new types,
  ON_REQUEST fires, ON_RUN_FAILURE fires, richer notification + webhook delivery via a local
  capture server). e2e `automations-events.spec.ts` (2 tests).
- Verified matrix: backend jest **47/47**, `test:api` **29/29** (+4), `test:api:unit` **24/24**,
  db tests **all pass**, frontend unit **42/42**, `tsc --noEmit` clean, e2e **21/21** (+2).
- Housekeeping folded in: `ensureAdminDemoRows` is now called from `main()` in `seed-dev.js` —
  a single `npm run seed:dev` restores the admin demo rows (pm=MANAGER, dev=VIEWER) too. Backend
  restarted to load the event-trigger code (`term_1786129995092_9`, PID 17833, :3001).
- NOTE on e2e ordering: `assertions-runner.spec.ts` asserts "Requests: 8" on the seeded "Mock API
  Demo" collection, but `history.spec.ts` + `mock-server.spec.ts` create-and-leave a request in it,
  so the full suite is only green when run on a freshly reseeded DB (reseed before a full e2e run).

### 10.7 BACKLOG #3 — Run history page (pushed as `f906755`)

BACKLOG ITEM **#3 — Run history page** is DONE and on `origin/master` (`f906755`, pushed by the
parallel session):
- Backend `/api/history` per-user scoped (users see ONLY their own runs; cross-user detail = 404;
  request/response snapshots + test_results). `userId` threaded into MANUAL workflow runs only;
  automation/scheduled runs stay `user_id NULL`.
- Frontend: `HistoryView` (list + detail modal), rail "History" for all users, `/history` route,
  `runHistoryApi`, styles. e2e `history.spec.ts` green.
- The `debug-history.spec.ts` debug spec was removed before the push (no leftover).
- The top block in session.md was stale (said "in progress, not pushed") — refreshed on the next
  `session.md` update.

### 10.8 Merge session: in-app views + feature chain (pushed as `32bac39`)

PUSHED as `32bac39` (plus the earlier origin merges through `8a69536`).
This session: pulled origin (parallel AI was strictly ahead), merged in-app views architecture +
the feature chain it shipped, then finished the remaining gaps and made the e2e suite green.

**Merged from origin (now on `master`):**
- In-app views architecture (user's requirement): single `AppShell` + `NavProvider`/`NavStore`
  (`src/store/NavStore.tsx`) + `RouteViewSync` in the root layout; `/`, `/automations`, `/manage`,
  `/admin` all render the same shell — rail clicks switch views in-app, no separate page jump.
  Views extracted to `src/components/views/{Automations,Manage,Admin}View.tsx`.
- Feature chain: assertions editor + collection runner (`222cd58`, migration
  `006_request_assertions.sql`), workflow pass-through (`18b5794`), project-wise admin users
  (`a5b12bb`), sidebar-nav fix (`6faed49`), environments (`8a69536`:
  `backend/src/api/routes/environments.js`, `backend/src/api/db.js` session-var tx fix,
  frontend `EnvironmentsModal.tsx`, `frontend/e2e/environments.spec.ts`).

**Changes this session (pushed in `32bac39`):**
- Added the missing `.admin-view` CSS in `globals.css` (flex:1 scroll container inside `.main-area`),
  completing the in-app views wiring (`.admin-view` at globals.css after `.main-area`).
- e2e suite made reliably green — the new specs depend on shared seed data + one boss account, so:
  - `frontend/playwright.config.ts`: `fullyParallel: true` → `fullyParallel: false, workers: 1`
    (parallel workers raced on the same backend DB: duplicate named environments, login contention).
  - `frontend/e2e/environments.spec.ts`: idempotent — deletes any leftover "E2E Staging" via
    `page.request` before creating it (strict-mode violation on `env-E2E Staging` after 2nd run).
- Verified matrix **all green**: backend jest **47/47**, `test:api` **20/20**, `test:api:unit`
  **14/14**, db tests pass, frontend unit **37/37** (fail 0), `tsc --noEmit` clean, e2e **16/16**
  (env spec idempotency double-run verified without a DB reset).
- Running services: backend restarted to load the environments route (`term_1786120583103_10`
  PID 17246 :3001), frontend dev restarted (`term_1786120825958_11` PID 18320 :3000), mock
  upstream PID 12617 :3999.

### 10.9 Original feature backlog (user-approved 2026-08-06)

The user answered "Which feature should I build next?" with: add everything below to the backlog,
then build each feature one by one, following the working rules (update session.md first → make
changes → push → update session.md after push) for EVERY feature.
1. **Response assertions / collection runner** — per-request assertions (status, JSON path,
   headers, response time) evaluated after each run; a "Run collection" runner that runs every
   request in a collection and reports per-request pass/fail. DONE (`222cd58`).
2. **Environments UI** — visual editor for environments/variables (backend-supported; no dedicated UI).
   DONE (`8a69536` + `EnvironmentsModal.tsx`).
3. **Run history page** — dedicated UI listing past runs with request/response snapshots, status, timing.
   DONE (`f906755`).
4. **Mock server per project** — per-project mock API server (routes + in-memory state) managed from the app.
   DONE (was implemented but unflagged; `mockServers.js` + `MockServersModal.tsx` + `mock-server.spec.ts`).
5. **Workflow triggers & notifications** — more trigger types (on-request, on-run-failure) + richer notifications.
   DONE (`c15149e`).
6. **Export / import collections** — export collections as JSON (+ cURL/OpenAPI) and import back.
   DONE (`f496e7f`).
7. **Share links for requests** — shareable public read-only links to a request with sample response.
   DONE (`009_request_shares` + `shares.js` + `ShareLinksModal.tsx` + `app/s/[token]/page.tsx`).
8. **Comments & collaboration** — inline comments on requests/collections + team mentions.
9. **Global search** — Cmd-K quick switcher across requests, collections, workflows and runs.

### 10.10 BACKLOG #1 — Response assertions / collection runner frontend (pushed as `222cd58` on 2026-08-06)

PUSHED — **FEATURE 1: Response assertions / collection runner** (frontend; backend engine already
in `77ca26c`). What landed:
- `types.ts` — `Assertion` type, `assertions` on `ApiRequest`, `'tests'` request tab,
  `RunResult.testResults`/`assertionsPassed`, `CollectionRunResult`.
- `api.ts` — `RequestDetail.assertions`, `contentApi.runCollection()`.
- `WorkspaceStore.tsx` — assertions round-trip (`toEditorRequest`/`toServerPatch`),
  `runCollection` action + `collectionRun`/`collectionRunRunning` state.
- `RequestConfigurator.tsx` — new **Tests** tab (`AssertionsEditor`: type/operator/path/expected,
  add/remove); also fixed a pre-existing Rules-of-Hooks violation (useState after early return).
- `ResponsePane.tsx` — assertion results (pass/fail chips + message list) after each run.
- `Sidebar.tsx` `CollectionsTree` — per-collection **Run** button → `CollectionRunnerModal`
  (per-request HTTP status, duration, assertions, error + summary).
- `lib/assertions.js` (pure helper, unit-tested ×3) + `globals.css` styles.
- e2e: `frontend/e2e/assertions-runner.spec.ts` (adds status assertion, sees it pass, runs collection).
- Verified matrix: backend jest **47/47**, test:api **16/16**, api:unit **14/14**, db tests **all pass**,
  frontend unit **37/37**, `tsc --noEmit` clean, e2e **15/15**.
- Environment notes this turn: dev DB had been reset (login → "Invalid email or password") →
  re-ran `npm run seed:dev`; backend server was running stale pre-pull code → restarted it; the
  `assertions` column needs migration **006** (applied manually via psql, NOT applied by seed).

### 10.11 Workflow pass-through (pushed as `18b5794` on 2026-08-06)

PUSHED — **Workflow pass-through** (see the DONE block below for the full summary). Full matrix
green at push time: backend jest 40/40, test:api 16/16, api:unit 14/14, db tests pass, frontend
unit 34/34, tsc --noEmit clean, e2e 14/14.

### 10.12 Workflow pass-through — DONE narrative (previous "in progress" block)

DONE — **Workflow pass-through** implemented, tested (full matrix green) and ready to push:
- Answer to the original question: response pass-through ALREADY existed via `vars[stepId]`
  templates/formulas; the REQUEST snapshot was not exposed and there was no UI option.
- `workflowEngine.js` now stores `vars.step.<labelKey>`, `vars.stepRequest.<labelKey>`,
  `vars.stepResponse.<labelKey>` after each successful step (`sanitizeLabel`, e.g. "Create the
  order" -> `create_the_order`); `$steps` summaries include the request snapshot.
- `requestDispatcher.js` new `passInputs` option injects a previous step's request/response
  (optional dot-path `field`) into url query param / query / header / body.
- `WorkflowBuilder.tsx` per-step "Pass data from previous step into this request" UI with source
  select, data type, field, target, key, add/remove list + reference chips
  (`{{step.<key>.response}}` etc.). Validation in `workflowValidation.js` (source must be earlier).
- Verified: backend jest **40/40**, test:api 16/16, api:unit 14/14, db tests pass, frontend unit
  **34/34**, `tsc --noEmit` clean, e2e **14/14** (3 new specs in `workflow-pass-inputs.spec.ts`).
- NOTE: dev DB had been reset this turn — re-ran `npm run seed:dev` and re-inserted the admin demo
  rows (pm=MANAGER, dev=VIEWER of ADMIN's Default Project) via SQL into `project_managers` /
  `project_members` (not part of seed).

### 10.13 Admin Users list project-wise (pushed as `a5b12bb`)

DONE — admin Users list is now **project-wise** (pushed as `a5b12bb`):
- `GET /api/admin/users` returns `projects[]` per user (`{id,name,kind:'manager'|'member',role}`),
  aggregated from `project_managers` + `project_members`.
- `AdminView.tsx` shows a **Projects** column with per-project chips (MANAGER highlighted).
- Verified: backend `test:api` 16/16, frontend unit 28/28 + build OK, e2e **11/11**.
- Demo data: pm@… is MANAGER of the ADMIN's Default Project, dev@… is a VIEWER member (see admin
  /users) — inserted directly into the dev DB, not part of `seed:dev`.
- Note for future sessions: do NOT run `next build` while `next dev` is live on the same `.next`
  dir — it clobbers dev chunks and breaks login/e2e; restart `npm run dev` afterwards.

### 10.14 Legacy status / response-pane / product-requirement narrative (pre-S0)

- Repo owner: **Ranjithramesh67** — https://github.com/Ranjithramesh67/MockShift (branch `master`).
  Git author email used on this machine: monkeycode-ai@chaitin.com.
- **Product requirement (implemented)**: The private "My Workspace" cannot be deleted. Each user's
  signup/seed bootstrap creates a PRIVATE `My Workspace`. The backend `DELETE /api/workspaces/:id`
  handler now refuses to delete a workspace named `My Workspace` (409 + friendly message), and the
  UI hides/disables the delete button for it (`Sidebar.tsx`). Deleting any other workspace still works.
- **Response pane (Postman-style) — implemented**: `frontend/src/components/ResponsePane.tsx` +
  `frontend/src/lib/responseView.js` (pure helpers, unit tested) + `globals.css`:
  - **Pretty / Raw / Preview** view-mode tabs on the response body; **Prettify** button (JSON via
    `JSON.stringify(...,2)`, XML/HTML via a tag-depth indenter).
  - **Preview**: HTML renders in a sandboxed `iframe`; JSON/XML show formatted text.
  - **PDF / images**: binary responses are base64-encoded by the backend
    (`backend/src/api/runner.js` `bodyEncoding: 'base64'` when content-type is binary) and rendered
    inline (PDF viewer iframe / image) with a **Download** button (Blob + `URL.createObjectURL`).
  - Demo: `GET sample PDF` and `GET HTML page` requests in the seeded collection hit
    `http://127.0.0.1:3999/files/sample.pdf` and `/html`.
- **Recent fixes (this session)**:
  - **Fixed production build**: `frontend/src/components/Sidebar.tsx` used `<Link>` without importing
    `next/link` (introduced in the sidebar-redesign commit) — `next build` failed type-check; added
    the import.
  - **Fixed `DELETE /requests/:id` after a run** (migration 005, see section 8). `manage.js`
    run-history queries now `COALESCE(ar.name, wc.name, '(deleted)')` so preserved history rows read
    cleanly.
  - Prior session fixes (already pushed): sidebar icon-rail redesign, `runner.js` TDZ fix (shadowed
    `body` var renamed to `responseBody`), "My Workspace" delete protection, response preview/PDF.

### 10.15 Legacy "Run it" / sample APIs (pre-S0, superseded by root session.md ## Environment)

- Run commands: backend `cd backend && PORT=3001 node src/api/server.js`; frontend
  `cd frontend && npm run dev` (port 3000, proxies `/api` to 3001); mock upstream
  `cd backend && node scripts/mock-upstream.js` (port 3999); seed `cd backend && npm run seed:dev`.
- **Sample APIs** — **Local mock upstream** `backend/scripts/mock-upstream.js` (port 3999,
  in-memory store seeded from `backend/scripts/mock-data.json`; mutations reset on restart):
  - Resources: `/posts`, `/users`, `/comments`, `/todos` — `GET /:res` (list), `GET /:res/:id`,
    `POST /:res` (201 + assigned id), `PUT /:res/:id`, `PATCH /:res/:id`, `DELETE /:res/:id`.
  - `POST /token` — returns `{access_token:"mock-token-abc123", token_type:"Bearer"}` (auth-provider flow).
  - `GET /files/sample.pdf` — a valid tiny PDF (for the response Preview/Download tabs).
  - `GET /html` — a small HTML page (for the Preview tab).
  - `/echo` — echoes back `{headers, body}`.
- **Demo collection "Mock API Demo"** (created by `npm run seed:dev` under the ADMIN's Default
  Project) with 8 ready-to-run requests: `GET all posts`, `GET post 1`, `POST create post`,
  `PUT replace post 1`, `PATCH post 1`, `DELETE post 2`, `GET sample PDF`, `GET HTML page` — all
  pointed at `http://127.0.0.1:3999`.
