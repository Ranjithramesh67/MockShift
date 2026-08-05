# Session Handoff — MockShift / API Hub

> Canonical, detailed session log: **`docs/SESSION.md`** (maintained by the working AI sessions).
> This root `session.md` is a short pointer/status snapshot for anyone landing on the repo.

## User
- Repo owner: **Ranjithramesh67** — https://github.com/Ranjithramesh67/MockShift (branch `master`).
- Git author email used on this machine: monkeycode-ai@chaitin.com.

## Status (as of the last push)
All planned features have been implemented and pushed to `origin/master`:

- **MANAGER RBAC + project access requests / approvals** (migration `003_rbac_manager_approvals.sql`,
  `access.js`, `audit.js`, routes `manage.js`/`projects.js`/`admin.js`, RLS).
- **Admin/manager audit views** (`app/manage/page.tsx`, `app/admin/page.tsx`): users, projects +
  manager assignment, teams, access-request approval inbox, audit logs, run history.
- **Consolidated Views menu + notification bell** (`TopBar.tsx`, `notificationApi`).
- **Multi-language code-copy** (`src/lib/codegen.ts`, `CodeGenModal.tsx`, 9 languages + cURL).
- **Formula helper guidance** (`FormulaHelper.tsx`, expanded sandbox helpers in
  `backend/src/sandbox/formulaRunner.js`).
- **Workflow persistence + run + pass-through** (`workflowApi`, `WorkflowBuilder`), migration
  `004_request_formula.sql` for the request formula column.
- **Automations** (`app/automations/page.tsx`, routes `automations.js`/`workflows.js`, schedule +
  webhook triggers, failure notifications via `workflowService.js`).
- **Mock upstream + seed** (`backend/scripts/mock-upstream.js`, `seed-dev.js`, `mock-data.json`).
- **MonkeyCode green rebrand** (`app/globals.css`).

AI feature: intentionally deferred by the user — do not build.

## Run it
- Backend: `cd backend && PORT=3001 node src/api/server.js` (needs the env in `docs/SESSION.md` §2).
- Frontend: `cd frontend && npm run dev` (port 3000, proxies `/api` to 3001).
- Mock upstream: `cd backend && node scripts/mock-upstream.js` (port 3999).
- Seed demo accounts: `cd backend && npm run seed:dev` (accounts: boss1785867669@test.io ADMIN,
  pm1785867669@test.io MANAGER, dev1785867669@test.io EDITOR — see `docs/SESSION.md` §3).
- DB resets wipe runtime data; re-seed afterwards.

## Known open item
- `DELETE /requests/:id` fails once a run exists (`run_history_target` check violation); see
  `docs/SESSION.md` §8 for the fix direction.
