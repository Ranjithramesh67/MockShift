# Session v2 — feature log

New work is recorded here to keep the original, very large `session.md` / `docs/SESSION.md` untouched.

## Completed

- Admin-configurable menus: `menu_settings` overrides (org/project, project wins, no row = enabled),
  `GET /api/menu-access`, `requireMenuEnabled` backend gate on feature routers, rail/route filtering,
  and the admin Menus tab.
- Individual BYO LLM: admin toggle `portal_settings.allow_individual_llm` (default off), encrypted
  per-user `user_llm_configs`, `resolveConfig` precedence (user config when enabled, else `USER_LLM_*`),
  profile model form and admin AI tab.
- Complete feature documentation: `docs/FEATURES.md` (end-to-end feature guide incl. the
  access-request vs send-item inbox distinction, API token auth, plans, permission matrix, endpoint
  reference, known gaps) and `docs/SDK.md` (apihub-sdk configuration, API, adapter, sync protocol).
- Unified access requests: reviewer notifications and audit on project/workspace request creation
  and re-request, a creator-only project cancel endpoint (`CANCELLED`), a unified Manage
  workspace-request queue, an `/inbox` Requests tab, notification deep links, and a "Request access"
  workspace-switcher modal.

### Admin-configurable menus (details)

- Migration `040_menu_settings.sql`: OVERRIDES-only table (`scope IN ('org','project')`, scoped unique
  indexes, RLS for defense in depth). Absence of a row means the feature is enabled (default-on).
- Resolver/gate `backend/src/api/menuAccess.js`: `mergeMenuRows()` (project beats org), `effectiveMenus()`,
  injectable `setEffectiveMenus`/`resetEffectiveMenus`, and `requireMenuEnabled(key)` → `403 menu_disabled`.
- `apis` (workspace core) and `admin` (role-gated) are NEVER toggleable. Toggleable keys:
  `teams, automations, history, docs, contracts, monitors, mock-scenarios, copilot, collab, manage`.
- `GET /api/menu-access` returns the caller's effective flags. Admin CRUD at `GET/PUT/DELETE /api/admin/menus`
  (audit-logged).
- Route gates are mounted before each feature router in `server.js` for prefixes: `/manage`, `/teams`,
  `/automations`, `/history`, `/docs`, `/contracts`, `/monitors`, `/copilot`, `/mock-scenarios`,
  `/mock-routes`, `/comments`, `/reviews`. `/api/docs/public` stays before the `/api/docs` gate.
- Frontend fails OPEN: unknown/not-yet-loaded keys are treated as enabled so a slow fetch never hides an
  available feature; the backend always enforces.
- Tests: backend unit `menuAccess.test.cjs`, integration `tests/menus.integration.test.cjs`, frontend unit
  `menuKeys.test.cjs`.

### Individual BYO LLM (details)

- Migration `041_individual_llm.sql`: `portal_settings.allow_individual_llm boolean NOT NULL DEFAULT false`
  (master switch) and `user_llm_configs` (one row/user; `api_key_encrypted` = `pgp_sym_encrypt(key,
  app.vault_key())`, `base_url`, `model`; RLS scoped to `app.current_user_id()`).
- `backend/src/api/llm.js`: `validateUserConfig`, `individualLlmAllowed`, `loadUserConfig`, `resolveConfig`
  (`source: 'user' | 'env' | 'none'`), `describeResolved` (never the key); `defaultCallModel` accepts an
  explicit `config` override. Only `USER_LLM_*` and the user's stored config are ever consulted.
- Endpoints: `GET/PUT/DELETE /api/profile/llm` (PUT upserts encrypted config, 403 `individual_llm_disabled`
  when off; GET/PUT never return the key) and admin `GET/PUT /api/admin/settings/individual-llm`.
- Copilot routes resolve config per request via `resolveConfig({ userId })`; `GET /api/copilot/status` now
  adds `source`. The key is never logged, returned, or written to `ai_copilot_usage`.
- Frontend: `llmConfig.js` helpers, `llmConfigApi`/`UserLlmConfig`, Profile "AI model" section (renders
  only when `allowed`), and the admin AI tab toggle.
- Tests: backend unit `llm.test.cjs`, integration `tests/individualLlm.integration.test.cjs`, frontend unit
  `llmConfig.test.cjs`.

### Feature documentation (details)

- `docs/FEATURES.md` — full product/engineering guide: architecture, auth + orgs/roles, configurable
  menus, workspaces/projects/collections/folders/requests, execution + environments, docs + public
  sharing, collab, contracts, monitors, mock servers/scenarios, automations/workflows, copilot BYO-LLM,
  API tokens + scopes/binding, SDK summary, teams/sharing, the three-system access-request/inbox
  breakdown, notifications, admin/governance, plans/entitlements, profile, permission matrix, endpoint
  reference and known gaps.
- `docs/SDK.md` — apihub-sdk deep dive: install, config/env vars, programmatic API, Express adapter
  (incl. `app.all` gotcha), folder resolution, `hub.test` assertion mapping, CLI, `POST /api/sdk/sync`
  manifest + response + server behaviour (token/scope, target resolution, upsert by `external_key`,
  prune, plan gates, `sdk_sync_runs`), troubleshooting and tests.
- Cross-checked every documented endpoint against the routers. Documented gaps: no password reset, no
  workspace-access-request creation UI, `/inbox` is send items only, `api/openapi.json` omits SDK/copilot,
  SDK plan checkboxes unticked, `SUPPORT` role unranked.
- Commit `826a46b` — pushed to `master`.

### Unified access requests (details)

- Migration `042_access_request_cancel.sql` widens the `access_requests.status` CHECK to include
  `CANCELLED` (workspace requests already accepted it).
- Shared notifications `backend/src/api/notify.js`: `notifyUser`, `notifyUsers`, `dedupeRecipients`,
  `projectReviewerIds` (platform admins + assigned project managers) and `workspaceReviewerIds`
  (platform admins + workspace admins).
- Project requests (`backend/src/api/routes/projects.js`): fresh creation and reopen both audit-log
  `request_access` (reopen tagged `{ reopened: true }`) and notify reviewers with `kind: 'request'` and
  a `/manage?tab=requests` link. New creator-only
  `POST /api/projects/:projectId/access-requests/:requestId/cancel` returns `200` (`404` missing/not
  yours, `409` not `PENDING`), sets `CANCELLED`, and audit-logs `cancel`.
- Workspace requests (`backend/src/api/workspaceAccess.js`, `routes/docs.js`): `workspaceAccessFor`,
  `serializeWorkspaceAccessRequest`, `loadWorkspaceAccessRequest`, `reviewWorkspaceAccessRequest`
  (approval grants VIEWER and notifies the requester); creation notifies reviewers; cancel is
  audit-logged.
- Manage queue (`backend/src/api/routes/manage.js`): `GET /api/manage/workspace-access-requests` and
  `POST /api/manage/workspace-access-requests/:requestId/review` sit beside the project queue.
- Frontend: `accessRequestApi.cancel`, `manageApi.workspaceAccessRequests` / `reviewWorkspaceRequest`,
  `CANCELLED` in the status union, `request`/`send` notification kinds; `/inbox` gains a Requests tab
  (own project + workspace requests, cancellable) via `mergeMyRequests`; `/manage?tab=requests` shows
  both queues; the bell follows `link` deep links; the workspace switcher adds a "Request access" modal
  for non-members (`docsSharedApi.requestWorkspaceAccess`).
- Tests: backend integration `backend/tests/accessRequests.integration.test.cjs`, backend unit
  `src/api/__tests__/notify.test.cjs`, frontend unit `src/lib/__tests__/accessRequests.test.cjs`.
