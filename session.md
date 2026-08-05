# Session Handoff — MockShift / API Hub

Updated by the previous AI session. Next AI: read this first, then continue the remaining frontend work described below.

## User
- GitHub account / repo owner: **Ranjithramesh67**
- Git author email on this machine: **monkeycode-ai@chaitin.com** (repo: https://github.com/Ranjithramesh67/MockShift, branch `master`, HEAD currently uncommitted work on top of `7b275f7`)

## How to run (currently running in background terminals)
- **Backend**: terminal `term_1785865628536_5` PID 9313, `http://127.0.0.1:3001`, health OK.
  Command: `cd /workspace/backend && AUTH_SECRET=dev-secret VAULT_KEY=test-vault-key-do-not-use-in-prod PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub REDIS_HOST=127.0.0.1 REDIS_PORT=6379 PORT=3001 node src/api/server.js`
- **Frontend**: terminal `term_1785949520657_6` PID 11338, `http://localhost:3000` (Next.js 14 dev, proxies `/api` -> :3001). Just restarted after a corrupted `.next` cache (`/workspace/frontend/.next.bak-1785949513` was moved aside; dev server recompiled cleanly, `GET / 200`).
- Postgres + Redis are running locally. `db/migrations/*.sql` is authoritative; `prisma/schema.prisma` mirrors it. `db/tests/run.sh` re-applies all migrations + seed and **wipes all runtime demo data** every time it runs.

## Feature delivery plan (chosen by user)
Phasing: **All at once**. AI feature: **deferred by user (do not build it)**.
Features in scope: MANAGER RBAC role, project-scoped access requests + manager/admin approvals, admin/manager audit views (users/projects/teams/logs/history), consolidated Views menu, multi-language code-copy, formula helper guidance, workflow step payload/response pass-through, automations (schedules + webhook triggers + failure notifications), orange -> MonkeyCode green rebrand.

## Completed (backend — all tested green)
- `db/migrations/003_rbac_manager_approvals.sql`: `ALTER TYPE role ADD VALUE IF NOT EXISTS 'MANAGER'`; new tables `project_managers`, `project_members`, `access_requests` (PENDING/APPROVED/DENIED, UNIQUE(project,user)), `audit_logs`, `automations` (SCHEDULE/WEBHOOK, cron/token CHECKs), `notifications`; `created_at`/`updated_at` added to `workflow_chains`; RLS + `app.is_project_manager`; grants/indexes.
- `prisma/schema.prisma` mirrors the new schema (validated).
- `backend/src/api/access.js`: `ROLE_RANK = {ADMIN:4, MANAGER:3, EDITOR:2, VIEWER:1}`, `requireManagerOrAdmin`, `getOrgIdsForUser`, `getProjectAccess` (ADMIN > org-admin > MANAGER > workspace role), `canReadProject`/`canWriteProject`/`requireProjectRead`/`requireProjectWrite`. All prior exports preserved.
- `backend/src/api/audit.js`: `logAudit(...)` (never throws), `managedProjectIds(userId)`.
- Routes: `manage.js` (overview/users/projects/project/teams/access-requests + review/managers assign+remove/audit-logs/history, scoped for MANAGER vs ADMIN), `projects.js` (request access, mine, members), `workflows.js` (CRUD + run + runs), `automations.js` (CRUD + runs + trigger, camelCase `toApi`, `webhookUrl`), `notifications.js` (list/read/read-all), `admin.js` (POST /users incl. MANAGER, PATCH role incl. MANAGER, guards kept). `server.js` mounts them; public `POST /api/webhooks/:token` registered before auth routers; `syncAllSchedules()` at startup.
- `backend/src/api/workflowService.js`: DB-backed repos over existing WorkflowEngine/WorkflowScheduler, lazy Redis; `runWorkflow`, `registerAutomation`, `unregisterAutomation`, `syncAllSchedules`, `newWebhookToken`, `reflectInAutomations` posts failure notifications.
- `backend/src/api/routes/content.js` now returns `can_access` + `access_status` per project (used by sidebar Request-access buttons).
- Tests: jest 38/38, `test:api` 12/12, `test:api:unit` 14/14, `db/tests/run.sh` pass.
- Curl-verified E2E: manager scoping, editor request -> manager approve -> member+notification+audit, webhook firing, schedule registration.

## Completed (frontend)
- `app/globals.css`: full MonkeyCode green token set + CSS for views dropdown, notification bell, codegen modal, formula helper, sidebar access badges.
- `src/lib/api.ts`: `UserRole` + MANAGER; `adminApi.createUser`; `manageApi`, `accessRequestApi`, `workflowApi`, `automationApi`, `notificationApi`; all types.
- `src/lib/codegen.ts` (9 languages) + `src/components/CodeGenModal.tsx` (incl. cURL via `src/lib/curl.js`) + `src/components/FormulaHelper.tsx` + new icons.
- `src/components/TopBar.tsx`: single Views dropdown (`views-menu-button`, `view-<id>`), notification bell (poll 30s, `notification-bell`/`notification-unread`/`notification-read-all`), Manage link for ADMIN/MANAGER (`admin-link`).
- `src/components/Sidebar.tsx`: Request-access button + modal per project without access (`request-access-<name>`, `access-request-modal`), MEMBER/PENDING badges.
- `src/components/RequestConfigurator.tsx`: `codegen-open-button` (opens code modal), Formula tab now has `FormulaHelper`.

## PENDING (what the next AI must do, in order)
1. **Upgrade `app/admin/page.tsx` into the consolidated Manage page** (currently still the OLD admin-only users page — this is the main blocker). Must accept ADMIN and MANAGER, use `manageApi`, with tabs: Overview counts, Users (create user incl. MANAGER, role patch; MANAGER sees only org users, no role editing), Projects (list + detail: managers/members/requests; ADMIN assigns/removes managers), Access-request approval inbox (`reviewRequest`), Audit logs, Run history. Keep testids `admin-page`, `admin-table`, `admin-user-<email>`, `admin-role-<email>`, `admin-toggle-<email>`, `back-to-app`, `admin-error`, `admin-notice`, `admin-forbidden`. **Note: TopBar already links MANAGER users to `/admin`, but the page still blocks non-ADMIN — fix this now.**
2. **WorkflowBuilder**: wire Save -> `workflowApi.create/update`, Run -> `workflowApi.run`, add pass-through toggle surfacing `{{steps.<label>.*}}` outputs. Keep testids `workflow-name-input`, `workflow-save-button`, `workflow-errors`, `add-step-button`, `step-card-*`, `step-loop-type-0`, `step-loop-count-0`, `remove-step-button-*`.
3. **New Automations page** (link it in TopBar/Sidebar): list/create SCHEDULE (cron input) + WEBHOOK automations (copy `webhookUrl`), enable/disable/patch/delete, trigger-now, runs table, notifications feed. Use `automationApi`.
4. **Verify everything**: `npm run build`, frontend unit (`frontend/src/lib/__tests__`, 17 cjs tests), Playwright e2e (`frontend/e2e`, 4 specs incl. `workflow-infinite-loop.spec.ts`), backend suites, `db/tests/run.sh` + re-seed demo users, UI smoke on the preview URL.

## Demo accounts (current DB; note: `db/tests/run.sh` resets the DB, so re-promote after each run)
- admin@apihub.dev ADMIN `3db54dd3-b07b-4d38-855f-86c29fdca7b6` (promote via SQL when table non-empty)
- manager@apihub.dev MANAGER `e3d75474-c5f8-4541-8dc3-077cf7a0fd81` (promote via admin PATCH /users)
- user@apihub.dev EDITOR `4f1a7090-f452-4a0b-ac6c-3b6aeb7d0d8e`
- viewer2@apihub.dev VIEWER `c979af46-6fb3-4bb3-b891-4f38faa1bb82`
- Demo objects: workspace `Demo Workspace` 0ffc4d47-d66a-431c-9f19-76c8c7457e62, project 9f5ac7d2-38f7-4c36-ac02-405e0eeb964b, workflow `Health Flow` 7cd1b83b-77e1-4b1e-a819-10be3efaf26c, WEBHOOK automation token `wh_3b54a76cfbcf40fdbb6a8492982b7e3b`, SCHEDULE automation cron `0 * * * *`.

## Git status
All work is **staged but NOT committed/pushed** (`git add -A` done; user asked to push to GitHub — perform `git commit` + `git push origin master` after the next AI finishes/verifies the remaining work). Repo owner requested the push.

## Gotchas / guardrails
- Do NOT kill backend terminal `term_1785865628536_5`; restart it only with the full env command above.
- Use `background_terminal_kill` (never `pkill`/`killall`) to stop background processes.
- No-delete rule: move build caches aside (`.next.bak-*`) instead of `rm -rf`.
- Do not commit `.env`/secrets; none currently exist in the repo.
- AI feature is explicitly out of scope — do not add AI/LLM placeholders.
- Keep `data-testid`/`aria-label` hooks green for the e2e suite.
