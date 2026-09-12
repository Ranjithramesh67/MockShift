# Session v2 — feature log

New work is recorded here to keep the original, very large `session.md` / `docs/SESSION.md` untouched.

## Completed

- Admin-configurable menus: `menu_settings` overrides (org/project, project wins, no row = enabled),
  `GET /api/menu-access`, `requireMenuEnabled` backend gate on feature routers, rail/route filtering,
  and the admin Menus tab.

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
