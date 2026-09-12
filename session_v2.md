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
