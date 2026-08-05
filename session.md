# Session Handoff — MockShift / API Hub

> Canonical, detailed session log: **`docs/SESSION.md`** (maintained by the working AI sessions).
> This root `session.md` is the working-agreement + short status snapshot. Read it every session.

## User
- Repo owner: **Ranjithramesh67** — https://github.com/Ranjithramesh67/MockShift (branch `master`).
- Git author email used on this machine: monkeycode-ai@chaitin.com.

## Working rules for the AI (user-mandated — follow every session)
1. **Push code to GitHub every time** — after any code change, commit and `git push origin master`.
   Do not leave work sitting uncommitted/unpushed at the end of a turn.
2. **Update `session.md` (this file) every time** — keep it current: completed/pending work,
   accounts, known issues, and anything a fresh AI would need. Commit + push the update too.
3. Follow the no-delete guardrail: move build caches aside (e.g. `.next.bak-*`) instead of `rm -rf`;
   never delete user data without confirmation.
4. Keep `data-testid` / `aria-label` hooks green so the Playwright e2e suite keeps passing.
5. AI/LLM feature is **out of scope** (deferred by the user) — do not build or add AI placeholders.

## Status (as of the last push)
All planned features are implemented and pushed to `origin/master`:

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
- `DELETE /requests/:id` fails once a run exists (`run_history_target` check violation); see
  `docs/SESSION.md` §8 for the fix direction.

## Recent fixes (this session)
- **Fixed `backend/src/api/runner.js` TDZ bug**: the response-body `let body` shadowed the request-body
  `const body` inside the `try` block, so ANY request with a body (POST/PUT/PATCH/DELETE) failed with
  `Cannot access 'body' before initialization`. Renamed the inner variable to `responseBody`.
  Verified: formula request now runs SUCCESS (was FAILED); `test:api` 15/15, unit 14/14, jest 39/39.
- **"My Workspace" delete protection implemented**: backend `DELETE /api/workspaces/:id` returns 409
  for workspaces named `My Workspace`; the sidebar delete button is disabled for it.
