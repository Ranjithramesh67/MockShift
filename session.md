# Session Handoff — MockShift / API Hub

> Canonical, detailed session log: **`docs/SESSION.md`** (maintained by the working AI sessions).
> This root `session.md` is the working-agreement + short status snapshot. Read it every session.

## Current turn (in progress)
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
