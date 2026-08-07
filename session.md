# Session Handoff — MockShift / API Hub

> Canonical, detailed session log: **`docs/SESSION.md`** (maintained by the working AI sessions).
> This root `session.md` is the working-agreement + short status snapshot. Read it every session.

## Current turn (in progress)
BACKLOG ITEM **#4 — Mock server per project**: a per-project mock API server (routes + in-memory
state) managed from the app.

**Plan:**
- Migration `007_mock_servers.sql`: `mock_servers` (id, project_id FK → projects ON DELETE CASCADE,
  name, enabled, created_at) + `mock_routes` (id, mock_server_id FK ON DELETE CASCADE, method,
  path, status, headers jsonb, body text, delay_ms).
- Backend `backend/src/api/routes/mockServers.js`:
  - `GET /api/projects/:projectId/mock-server` (get or `{mockServer:null}`), `POST …` (create),
    `PATCH /api/mock-servers/:id`, `DELETE /api/mock-servers/:id`.
  - `GET/POST /api/mock-servers/:id/routes`, `PATCH/DELETE /api/mock-routes/:id`.
  - Access: `requireProjectRead` / `requireProjectWrite` (route + route-level checks).
- Mock dispatch (public, no auth — consumers hit it like any API): mounted in `server.js` at
  `/mock/:projectId/*`; resolves the project's enabled mock server, matches method + path (with
  `:param` segments) against routes, returns configured status/headers/body + optional delay.
  Requests in the app point at `http://127.0.0.1:3001/mock/<projectId>/…`.
- Frontend: `mockServerApi` in `api.ts` + a Mock Server management UI (list routes, add/edit/
  delete with method/path/status/headers/body/delay) exposed in the workspace content area.
- Tests: backend integration (`mockServer.integration.test.cjs`), frontend unit, e2e
  `frontend/e2e/mock-server.spec.ts`; full matrix green before push. Then refresh this file +
  `docs/SESSION.md`.

**Progress (this turn):** implementation done (migration 007, path matcher, mockServers routes +
mockDispatch mounted, api.ts types, MockServersModal + Sidebar wiring, styles, e2e spec).
**Full matrix re-verified green this turn:** backend `test:api` 25/25, `test:api:unit` 24/24, jest
47/47, db tests all pass, frontend unit 42/42, `tsc --noEmit` clean. New `mock-server.spec.ts` e2e
passes. Full e2e suite: 18/19 — the single failure was the *known, pre-existing* `history.spec.ts`
detail-modal flake (`history-detail-modal` timeout on open; passes in isolation both times it was
re-run; already documented). State: ready to commit + push.

## Current turn (completed, pushed as `f906755`)
BACKLOG ITEM **#3 — Run history page** is DONE and on `origin/master` (`f906755`, pushed by the
parallel session):
- Backend `/api/history` per-user scoped (users see ONLY their own runs; cross-user detail = 404;
  request/response snapshots + test_results). `userId` threaded into MANUAL workflow runs only;
  automation/scheduled runs stay `user_id NULL`.
- Frontend: `HistoryView` (list + detail modal), rail "History" for all users, `/history` route,
  `runHistoryApi`, styles. e2e `history.spec.ts` green.
- The `debug-history.spec.ts` debug spec was removed before the push (no leftover).
- This top block was stale (said "in progress, not pushed") — refreshed on the next `session.md`
  update.

## Current turn (completed, this session)
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

**My changes this session (pushed in `32bac39`):**
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

## Feature backlog (user-approved 2026-08-06: implement one by one, working-loop for each)
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
5. **Workflow triggers & notifications** — more trigger types (on-request, on-run-failure) + richer notifications.
6. **Export / import collections** — export collections as JSON (+ cURL/OpenAPI) and import back.
7. **Share links for requests** — shareable public read-only links to a request with sample response.
8. **Comments & collaboration** — inline comments on requests/collections + team mentions.
9. **Global search** — Cmd-K quick switcher across requests, collections, workflows and runs.

## Current turn (completed, pushed as `222cd58` on 2026-08-06)
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
- NEXT BACKLOG ITEM: **#2 Environments UI**.

## Current turn (completed, pushed as `18b5794` on 2026-08-06)
PUSHED — **Workflow pass-through** (see the DONE block below for the full summary). Full matrix
green at push time: backend jest 40/40, test:api 16/16, api:unit 14/14, db tests pass, frontend
unit 34/34, tsc --noEmit clean, e2e 14/14. Preview link unchanged:
https://3000-606b9b46b8d0d0bf.monkeycode-ai.live (dev server + backend + mock upstream all running).

## Current turn (in progress, previous)
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

## Current turn (in progress, previous)
DONE — admin Users list is now **project-wise** (pushed as `a5b12bb`):
- `GET /api/admin/users` returns `projects[]` per user (`{id,name,kind:'manager'|'member',role}`),
  aggregated from `project_managers` + `project_members`.
- `AdminView.tsx` shows a **Projects** column with per-project chips (MANAGER highlighted).
- Verified: backend `test:api` 16/16, frontend unit 28/28 + build OK, e2e **11/11**.
- Demo data: pm@… is MANAGER of the ADMIN's Default Project, dev@… is a VIEWER member (see admin
  /users) — inserted directly into the dev DB, not part of `seed:dev`.
- Note for future sessions: do NOT run `next build` while `next dev` is live on the same `.next`
  dir — it clobbers dev chunks and breaks login/e2e; restart `npm run dev` afterwards.

## User
- Repo owner: **Ranjithramesh67** — https://github.com/Ranjithramesh67/MockShift (branch `master`).
- Git author email used on this machine: monkeycode-ai@chaitin.com.

## Working rules for the AI (user-mandated — follow every session)
1. **Update `session.md` FIRST** — at the start of every turn, before any code change, record the
   plan/pending work in this file so a fresh AI always sees the latest picture.
2. **Make the changes** — implement the requested code changes.
3. **Push code to GitHub every time** — after the changes, commit and `git push origin master`.
   Do not leave work sitting uncommitted/unpushed at the end of a turn.
4. **Update `session.md` AFTER the push too** — once the code changes are committed and pushed,
   refresh this file with what was completed (status, known issues, anything a fresh AI would need),
   then commit + push that `session.md` update as well. Keep `docs/SESSION.md` in sync when useful.
5. Follow the no-delete guardrail: move build caches aside (e.g. `.next.bak-*`) instead of `rm -rf`;
   never delete user data without confirmation.
6. Keep `data-testid` / `aria-label` hooks green so the Playwright e2e suite keeps passing.
7. AI/LLM feature is **out of scope** (deferred by the user) — do not build or add AI placeholders.

## Status (as of the last push)
All planned features are implemented and pushed to `origin/master`:

- **Three polish items VERIFIED** (full e2e + unit + build + DB test matrix green):
  1. **Sidebar panel hidden on `/automations` `/manage` `/admin`** — `AppShell.tsx` passes
     `panelHidden={view !== 'workspace'}`; `.sidebar-panel-hidden` (`display:none`) hides the
     workspace chips + collections tree while the icon rail stays for navigation. Regression:
     `frontend/e2e/nav-from-manage.spec.ts` (all 3 pages).
  2. **Create-user modal no longer breaks layout** — `.modal-overlay` is `position:fixed`,
     centered flex, `.modal` has `max-width:92vw` / `max-height:88vh` with scrollable `.modal-body`
     (AdminView.tsx uses `.modal-overlay`). Regression: `frontend/e2e/modal-create-user.spec.ts`.
  3. **Large responses scroll inside the pane** — `.response-body .code-editor` is
     `flex:1; min-height:0`, CodeMirror chain resolves to `height:100%` with `.cm-scroller`
     `overflow:auto`; `.response-pane`/`.app-body` flex chain has `min-height:0`. Regression:
     `frontend/e2e/large-response.spec.ts` (200 KB body, page height unchanged).

- **Working rules** now require the full loop every session: update `session.md`
  first → make changes → push → update `session.md` again after the push (commit
  `8a64eb6`).

- **MANAGER RBAC + project access requests / approvals** (migration `003_rbac_manager_approvals.sql`,
  `access.js`, `audit.js`, routes `manage.js`/`projects.js`/`admin.js`, RLS).
- **Admin/manager audit views** (`app/manage/page.tsx`, `app/admin/page.tsx`): users, projects +
  manager assignment, teams, access-request approval inbox, audit logs, run history.
- **Consolidated Views menu + notification bell** (`TopBar.tsx`, `notificationApi`).
- **Multi-language code-copy** (`src/lib/codegen.ts`, `CodeGenModal.tsx`, 9 languages + cURL).
- **Formula helper guidance** (`FormulaHelper.tsx`, expanded sandbox helpers in
  `backend/src/sandbox/formulaRunner.js`), migration `004_request_formula.sql`.
- **Workflow persistence + run + pass-through** (`workflowApi`, `WorkflowBuilder`).
- **Automations** (`app/automations/page.tsx`, routes `automations.js`/`workflows.js`, schedule +
  webhook triggers, failure notifications via `workflowService.js`).
- **Mock upstream + seed** (`backend/scripts/mock-upstream.js`, `seed-dev.js`, `mock-data.json`).
- **Postman-style response pane** (`ResponsePane.tsx`, `responseView.js`): Pretty/Raw/Preview tabs,
  Prettify, HTML preview iframe, inline PDF/image viewer + Download (binary bodies base64 via
  `runner.js` `bodyEncoding`).
- **MonkeyCode green rebrand** (`app/globals.css`).

## Run it
- Backend: `cd backend && PORT=3001 node src/api/server.js` (needs the env in `docs/SESSION.md` §2).
- Frontend: `cd frontend && npm run dev` (port 3000, proxies `/api` to 3001).
- Mock upstream: `cd backend && node scripts/mock-upstream.js` (port 3999).
- Seed demo accounts: `cd backend && npm run seed:dev` — run this after any DB reset.
- DB resets wipe runtime data; re-seed afterwards.

## Login accounts (created by `npm run seed:dev`)
| Email | Password | Role |
|---|---|---|
| boss1785867669@test.io | bosspass123 | ADMIN |
| pm1785867669@test.io | pmpass1234 | MANAGER |
| dev1785867669@test.io | devpass123 | EDITOR |

## Sample APIs
- **Local mock upstream** `backend/scripts/mock-upstream.js` (port 3999, in-memory store seeded from
  `backend/scripts/mock-data.json`; mutations reset on restart):
  - Resources: `/posts`, `/users`, `/comments`, `/todos` — `GET /:res` (list), `GET /:res/:id`,
    `POST /:res` (201 + assigned id), `PUT /:res/:id`, `PATCH /:res/:id`, `DELETE /:res/:id`.
  - `POST /token` — returns `{access_token:"mock-token-abc123", token_type:"Bearer"}` (auth-provider flow).
  - `GET /files/sample.pdf` — a valid tiny PDF (for the response Preview/Download tabs).
  - `GET /html` — a small HTML page (for the Preview tab).
  - `/echo` — echoes back `{headers, body}`.
- **Demo collection "Mock API Demo"** (created by `npm run seed:dev` under the ADMIN's Default
  Project) with 8 ready-to-run requests:
  `GET all posts`, `GET post 1`, `POST create post`, `PUT replace post 1`, `PATCH post 1`,
  `DELETE post 2`, `GET sample PDF`, `GET HTML page` — all pointed at `http://127.0.0.1:3999`.

## Product requirement (implemented)
- **The private "My Workspace" cannot be deleted.** Each user's signup/seed bootstrap creates a
  PRIVATE `My Workspace`. The backend `DELETE /api/workspaces/:id` handler now refuses to delete a
  workspace named `My Workspace` (409 + friendly message), and the UI hides/disables the delete
  button for it (`Sidebar.tsx`). Deleting any other workspace still works.

## Known open item
- **If login says "Invalid email or password", the dev DB was reset** (it has happened twice in this
  environment — e.g. `db/seed.sql` or an external reset wipes app tables). Fix:
  `cd backend && npm run seed:dev`, then re-insert the admin demo rows (pm=MANAGER, dev=VIEWER of
  the ADMIN's Default Project) into `project_managers` / `project_members` directly via psql —
  `seed:dev` does NOT recreate them (admin /users Projects column would look empty).
- **New migrations are NOT auto-applied.** After a plain `seed:dev`, apply any pending migration
  manually, e.g. `PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub
  psql -f db/migrations/006_request_assertions.sql` (this turn's `assertions` column). A full
  `db/tests/run.sh` applies every migration. Restart the backend after pulling new backend code —
  a stale server process keeps serving the pre-pull handlers.
- **FIXED this session** — `DELETE /requests/:id` (and collections/workspaces) no longer fails after a
  run exists. Migration `005_relax_run_history_target.sql` relaxes the `run_history_target` CHECK so
  `ON DELETE SET NULL` no longer violates it; run history is preserved as an audit trail (app shows
  `(deleted)` for orphaned rows). Regression test added in `apiAuth.integration.test.cjs`.
  Verified end-to-end: run a request → delete it → `200 {"ok":true}`.

## Response pane (Postman-style) — implemented
- `frontend/src/components/ResponsePane.tsx` + `frontend/src/lib/responseView.js` (pure helpers, unit
  tested) + `globals.css`:
  - **Pretty / Raw / Preview** view-mode tabs on the response body; **Prettify** button (JSON via
    `JSON.stringify(...,2)`, XML/HTML via a tag-depth indenter).
  - **Preview**: HTML renders in a sandboxed `iframe`; JSON/XML show formatted text.
  - **PDF / images**: binary responses are base64-encoded by the backend
    (`backend/src/api/runner.js` `bodyEncoding: 'base64'` when content-type is binary) and rendered
    inline (PDF viewer iframe / image) with a **Download** button (Blob + `URL.createObjectURL`).
  - Demo: `GET sample PDF` and `GET HTML page` requests in the seeded collection hit
    `http://127.0.0.1:3999/files/sample.pdf` and `/html`.

## Recent fixes (this session)
- **Fixed production build**: `frontend/src/components/Sidebar.tsx` used `<Link>` without importing
  `next/link` (introduced in the sidebar-redesign commit) — `next build` failed type-check; added the
  import.
- **Fixed `DELETE /requests/:id` after a run** (migration 005, see above). `manage.js` run-history
  queries now `COALESCE(ar.name, wc.name, '(deleted)')` so preserved history rows read cleanly.
- Prior session fixes (already pushed): sidebar icon-rail redesign, `runner.js` TDZ fix (shadowed
  `body` var renamed to `responseBody`), "My Workspace" delete protection, response preview/PDF.
