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
- Global search + command palette: `GET /api/search` across workspaces, projects,
  collections, folders, requests, docs, contracts, monitors and mock scenarios, with
  per-type read scoping and menu gating, and a Cmd/Ctrl-K command palette with a top-bar
  trigger.

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

### Global search + command palette (details)

- Migration `043_search_indexes.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm` plus GIN
  `gin_trgm_ops` indexes on the name/title/url columns (`workspaces.name`,
  `projects.name`, `collections.name`, `folders.name`, `api_requests.name`/`url`,
  `doc_pages.title`, `contract_specs.name`, `monitors.name`, `mock_scenarios.name`,
  `workflow_chains.name`). These columns are indexed to keep `ILIKE '%q%'` scans
  index-assisted; note that `GET /api/search` does not query `workflow_chains`, so that
  index is not exercised by the endpoint.
- `backend/src/api/search.js` (pure helpers): `escapeLike`, `normalizeQuery` (trims, requires
  a non-empty `q`, defaults `limit` to 20, caps at 50), `rankResult` (exact < prefix <
  substring position), `menuKeyForType`, `flattenGroups` (flattens grouped rows and sorts by
  rank then name).
- `backend/src/api/routes/search.js` (`GET /api/search?q=&limit=`, auth-required, mounted in
  `server.js`): runs one `ILIKE` query per entity type, then filters each row through the
  shared access helpers - `canReadWorkspace`, `canReadProject`, and `canReadPage` (exported
  from `routes/docs.js`, also covering public-in-org pages and share grants); platform
  MANAGER/ADMIN bypass workspace/project checks via `isGlobalHigh`. Menu gating uses
  `effectiveMenus` per scope and drops any type whose menu key is disabled
  (`docs`/`contracts`/`monitors`/`mock-scenarios`/`apis`). Response is
  `{ query, groups, results }`, with `results` a flattened, ranked list of
  `{ id, name, type, rank, projectId?, workspaceId?, method?, url?, subtitle? }`.
- Frontend: `searchApi.query` in `src/lib/api.ts`; `src/lib/searchPalette.js`
  (`groupLabel`, `takeTop`, `flattenResults`); `CommandPalette.tsx` +
  `useGlobalSearchShortcut.ts` mounted in `AppShell` (Cmd/Ctrl-K in the capture phase,
  debounced queries stamped with a sequence number to reject out-of-order responses). A
  `SearchIcon` trigger in `TopBar` (`data-testid="global-search-button"`, `Cmd K` / `Ctrl K`
  hint) opens the palette. Navigation by type: docs `/docs?p=<id>`, workspace/project/
  collection/request select in the workspace view, monitor `/monitors`, contract
  `/contracts`, mockScenario `/mock-scenarios`.
- Tests: backend unit `src/api/__tests__/search.test.cjs`, backend integration
  `backend/tests/search.integration.test.cjs`, frontend unit `src/lib/__tests__/searchPalette.test.cjs`.
- v1 limitation: docs are searched by title only; doc block content is not searched.
- v1 completeness limitation (accepted): each entity type applies `ORDER BY name LIMIT`
  before the per-row access/menu filter. On a large multi-tenant dataset, a caller's
  readable matches can therefore be omitted from a capped result set. This is strictly a
  completeness limitation - it never exposes data the caller cannot read.

### Realtime collaboration (details)

- In-process hub `backend/src/api/realtime.js`: `roomKey(kind, id)` -> `<kind>:<id>` for
  `user|request|collection|doc`, `subscribe`/`publish` over a
  `Map<room, Map<subId, { userId, name, send }>>`, `viewersFor` (deduped `{ id, name }`),
  `subscriberCount`, `reset`. Single process by design (the API process also hosts the
  BullMQ workers); a future split must swap the transport for Redis pub/sub, and the
  publish/subscribe interface is intentionally small for that reason.
- SSE route `backend/src/api/routes/events.js` (`GET /api/events?room=<kind>:<uuid>`,
  `requireAuth`, mounted in `server.js`): no `room` defaults to `user:<id>`; `authorizeRoom`
  validates a UUID id and enforces `user` self-only, `request`/`collection` via
  `canReadProject`, and `doc` via `canReadPage` (400/404/403). Headers `text/event-stream;
  charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
  `X-Accel-Buffering: no`; frames `event: message` + `data:` JSON; `: ping` heartbeat
  (default 25000 ms, `REALTIME_HEARTBEAT_MS`); presence published on join and on close.
- Notification streaming + shared notifier refactor: `backend/src/api/notify.js` imports
  `publish`/`roomKey` and `notifyUser` publishes `{ type: 'notification', notification }`
  to `user:<id>` after insert; `notifyUsers`, `dedupeRecipients`, `projectReviewerIds` and
  `workspaceReviewerIds` continue to back the other notification flows.
- Comment events (`routes/comments.js`): create publishes `comment:created` to the target
  room (`request:<id>` or `collection:<id>`); resolve/unresolve publish
  `comment:resolved`/`comment:unresolved` only on a real state change; delete publishes
  `comment:deleted`.
- Review events (`routes/reviews.js`): `review:created` and `review:decided` (with
  `status`) to `collection:<collectionId>`.
- Entity-updated events: request saves (`routes/content.js`) publish to `request:<id>`;
  doc metadata and block saves (`routes/docs.js`) publish to `doc:<id>`. Payload
  `{ type: 'entity:updated', entityType, entityId, by: { id, name } }`; updates without an
  author id are ignored by clients.
- Frontend helpers `src/lib/realtime.js`: `roomFor`, `eventsUrl`, `parseSseFrame` (accepts a
  raw `event:`/`data:` block or a bare payload) and `viewerSummary`. `useRoomEvents`
  (`src/components/useRoomEvents.ts`) wraps `EventSource` over the Next `/api` rewrite
  (cookie auth; WS upgrades do not pass, which is why SSE is used), exposing `connected` and
  `viewers` and forwarding non-presence events to a callback.
- Live bell and collab presence: `TopBar` subscribes to `user:<id>` and prepends live
  `notification` events (deduped against refetches); `CollabPanel` and the editor headers
  subscribe to the entity room and render the viewer summary; `DocsPageView` and
  `RequestConfigurator` subscribe to `doc:<id>` / `request:<id>`.
- Editor conflict banner: a remote `entity:updated` from another author sets a remote-update
  flag; when the local editor is dirty a lightweight banner
  (`request-conflict-banner` / `doc-conflict-banner`) offers Reload, which refetches the
  saved version and discards local edits.
- Tests: backend unit `src/api/__tests__/realtime.test.cjs` and
  `src/api/__tests__/notifyRealtime.test.cjs`; backend integration
  `tests/realtime.integration.test.cjs`; frontend unit `src/lib/__tests__/realtime.test.cjs`.
- v1 limitations: no character-level co-editing (saves are still last-write-wins; realtime
  only signals conflicts); presence is ephemeral (in-process subscribers, lost on restart);
  the hub is not durable (no replay for missed events); single process only until the Redis
  transport lands.

### Password reset + email verification (details)

- Migration `044_auth_tokens.sql`: `auth_tokens` (`user_id` FK ON DELETE CASCADE, `kind IN
  ('password_reset','email_verification')`, unique `token_hash` = `sha256(raw)`, `expires_at`,
  `used_at`, `created_at`; indexes on `(user_id, kind)` and `expires_at`). Also adds
  `users.email_verified boolean NOT NULL DEFAULT false` and grandfathers existing rows to `true`,
  plus `users.password_changed_at`.
- Migration `045_session_epoch.sql`: `users.session_epoch integer NOT NULL DEFAULT 0`, a monotonic
  generation bumped on reset so old sessions are rejected without comparing clocks.
- `backend/src/api/authTokens.js`: `generateToken` (32 random bytes, base64url), `hashToken`
  (`sha256` hex), `expiryFor` (1 h reset / 24 h verification), `ttlFor`, `KINDS`, and
  `createThrottle({ windowMs, max })` (in-process fixed window with periodic sweep).
- `backend/src/api/email.js`: `smtpConfig` (`SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/
  `SMTP_USER`/`SMTP_PASS`), `appUrl`, `fromAddress` (`SMTP_FROM`), `sendMail`, `passwordResetMessage`,
  `verifyEmailMessage`, `setTransportForTest`/`resetTransportForTest`. Best-effort: unconfigured SMTP
  logs and returns `{ skipped: true }`; errors are redacted and never fail the request.
- Routes `backend/src/api/routes/auth.js`: `POST /forgot-password` (always `200` for a well-formed
  email, per-email throttle 5/15 min, marks outstanding reset tokens used and inserts a new one in a
  transaction), `POST /reset-password` (atomic `used_at` claim; updates `password_hash`,
  `password_changed_at`, `session_epoch = session_epoch + 1` in one transaction),
  `POST /verify-email` (atomic claim + `email_verified = true`), and
  `POST /resend-verification` (`requireAuth`; no-op when already verified).
- Session invalidation: `authLib.createSessionToken(userId, epoch)` stamps `sv`; `access.js`
  `requireAuth` rejects a cookie whose numeric `sv` differs from `users.session_epoch` (`401`).
  The same guard is applied by the `POST /api/runs` route's own session auth
  (`backend/src/api/routes/serverRuns.js`) and the Portal public-checkout session resolver
  (`portal/backend/src/routes/publicCheckout.js`). Authenticated password change
  (`POST /api/profile/password`) also bumps the epoch in the same statement and re-issues a fresh
  cookie for the acting session. Tokens minted before the feature (no `sv`) and API bearer tokens
  are grandfathered.
- Review fix wave: `POST /forgot-password` now sends `200` before doing DB work and the mail send
  (detached, error-contained) so account existence is not timing-observable; the reset hash is
  computed before opening the transaction; SMTP transport-init errors are redacted;
  `password_changed_at` is audit-only (044 comment corrected).
- Frontend: `src/lib/authLinks.js` (`tokenFromSearch`, `passwordProblem`); pages
  `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/verify-email/page.tsx`; login
  "Forgot password?" link; `AppShell` unverified banner (`data-testid="verify-banner"`) with resend.
- Tests: backend unit `src/api/__tests__/authTokens.test.cjs` and `src/api/__tests__/email.test.cjs`;
  backend integration `tests/authEmail.integration.test.cjs` and `tests/authReset.integration.test.cjs`.
  Run a suite against the isolated DB:
  `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authReset.integration.test.cjs`
- v1 limitations: the forgot throttle is in-process (not shared across API processes); expired
  `auth_tokens` rows are not garbage-collected automatically; API bearer tokens and pre-feature
  sessions survive a password reset; SMTP is best-effort with no bounce/retry queue.

### Request change history + rollback (details)

- Migration `db/migrations/046_request_revisions.sql`: `request_revisions` (per-request append-only log:
  `revision_number` unique per request, `change_kind IN ('create','update','rollback')`, `snapshot`
  jsonb = post-change request in the `requestSnapshot.js` camelCase shape, `changed_fields` jsonb =
  `[{field,from,to}]`, `rolled_back_from`, `created_by`, `created_at`; indexes on
  `(request_id, revision_number DESC)` and `created_by`). Rows are immutable — `app_user` is granted
  only `SELECT, INSERT`, and RLS gates reads by `app.workspace_readable` and writes by
  `app.can_mutate_workspace`.
- Capture `backend/src/api/routes/content.js`: `insertRevision(exec, {...})` numbers a new revision as
  `MAX(revision_number)+1` and is called on request create (`create`, ~line 574), request update
  (`update`, with the `collabDiff.changedFields` diff, ~line 712), and duplicate-as-create
  (`create`, ~line 834). Callers inside the update
  transaction pass `(sql, p) => client.query(sql, p)` so the `api_requests` row lock serializes the
  number; the create/duplicate paths pass `null` to use the pool. The `rollback` revision is NOT
  written by `insertRevision`: it is recorded by an inline
  `INSERT INTO request_revisions ... SELECT ..., COALESCE(MAX(revision_number),0)+1 ...`
  in `backend/src/api/routes/requestRevisions.js` (~lines 185-203), inside the rollback transaction.
- Routes `backend/src/api/routes/requestRevisions.js` (all routes `requireAuth`):
  `GET /api/requests/:requestId/revisions` (newest-first metadata list),
  `GET /api/requests/:requestId/revisions/:revisionId` (metadata plus full snapshot), and
  `POST /api/requests/:requestId/revisions/:revisionId/rollback` (EDITOR+; restores the snapshot into
  the request in a transaction and records a new `rollback` revision, so history is never rewritten).
- Live refresh: rollback publishes the existing realtime `entity:updated` event on the
  `request:<id>` room (`publish(roomKey('request', requestId), { type:'entity:updated', ... })`), so
  every other open editor reloads the new state through the same path used by ordinary saves.
- Frontend: `src/lib/api.ts` `requestHistoryApi` (`list`/`detail`/`rollback`; rollback returns
  `{ request, revision }`), `src/lib/requestHistory.js` formatting helpers (`revisionSummary`,
  `formatChange`), and `src/components/request/RequestHistoryPanel.tsx` — the request **History**
  tab with a newest-first list, a git-style before/after diff per revision, and a **Restore** action,
  plus `useRequestHistoryShortcuts.ts` for keyboard navigation.
- Tests: backend integration `tests/requestRevisions.integration.test.cjs`; frontend unit
  `src/lib/__tests__/requestHistory.test.cjs`.
- v1 limitations: revisions are per-request only (no collection/workspace activity feed); deleting a
  request cascades its revisions away (no tombstone); rollback restores the name verbatim without
  re-uniquification; revisions are bounded by request lifetime, so no GC/throttle is needed.

### Issue Part 1: APIs & Collection page fixes

User-reported UI/UX batch addressed page-by-page (fix, verify, commit each before the next). Base
`a1caf31`; commits `be4d18c` → `022dd3f` → `5f56626` → `8f46426` → `be6773d` → issue 12.

- `be4d18c` Issues 1&2 (active environment + secret toggle): new shared
  `frontend/src/components/ToggleSwitch.tsx`; `EnvironmentsModal.tsx` marks the active env with
  `env-row … is-active` and replaces the bare secret checkbox with `<ToggleSwitch testId="var-secret">`;
  `globals.css` `.env-row.is-active` accent treatment + `.toggle-switch*`.
- `022dd3f` Issue 3 (collections vs folders): `Sidebar.tsx` gives collection rows an accent
  `CollectionIcon` and project heads a `LayersIcon`; `.tree-collection-name` bold, nested
  `.tree-folder-name` dimmer.
- `5f56626` Issues 6–9 (request editor): `RequestConfigurator` drops the API-type select and Import
  button (cURL still reachable via the top bar and URL paste) and gives the Formula tab a draggable
  `SplitPane` with a `formula-layout-toggle`; `AppShell.tsx` removes the now-dead `onOpenCurl`
  plumbing; `MockRoutePicker` button becomes icon-only.
- `8f46426` Issue 10 (project members): `ProjectOverview.tsx` surfaces the signed-in user as a
  synthetic `po-you-badge` row, hides self Remove and excludes self from the add picker;
  `projects.js` rejects self add/remove with 400; `tests/projectMembers.integration.test.cjs`.
- `be6773d` Issue 11 (subscription surface): `frontend/src/lib/subscription.js` helpers
  (`subscriptionChip`/`daysUntil`/`normalizeStatus`) with unit tests; `TopBar.tsx` always-visible
  `subscription-chip` (click → profile) and a `user-menu-plan` row with an amber pulsing dot when
  past-due / cancel-scheduled / ≤7 days to renewal or trial end.
- Issue 12 (send to any user) — this commit: `POST /api/sends` accepts `recipientId` **or**
  `recipientEmail` (resolved by id or `lower(email)`), and the old "only people in your organization
  or workspace" 403 reachability gate is gone (self-send still 400, unknown email 404). FE
  `SendItemDialog.tsx` adds an "Or send to any user by email" input plus `send-by-email-btn`, and the
  dead-end empty state now points to it; `SendCreateInput.recipientId` is optional with a new
  `recipientEmail`. New `tests/sends.integration.test.cjs` (3 tests, scratch cluster 5441): send to an
  unshared recipient by email, self-send rejected, unknown email 404.
- Issues 4&5 (login-gated sharing + share change history) — this commit:
  - `db/migrations/047_item_shares.sql` generalizes `request_shares` into a login-gated
    `item_shares` table (item_type ∈ request/folder/collection/project/workspace, uuid token,
    `UNIQUE(item_type,item_id)`) and backfills legacy `request_shares` rows.
  - `backend/src/api/routes/shares.js` rewritten: `POST /shares {itemType,itemId}` (EDITOR+) creates a
    share once per item; `GET /shares/:token` now requires login (`requireAuth`) and is plan-free, so
    recipients need no subscription to view — requests return a snapshot + lastRun, other item types a
    redacted read-only tree. The plan `public_sharing` gate now applies only on *creation*. Added
    `GET /shares/:token/revisions` (request shares) and kept `POST /requests/:requestId/share` for
    back-compat; legacy tokens still resolve.
  - FE `frontend/src/lib/api.ts` gains `SharedItemView`/`SharedRequestSummary`/`SharedFolderNode`/
    `SharedRevision` types and `shareApi.create({itemType,itemId})`/`revisions()`; `ShareLinksModal.tsx`
    is generalized to `itemType/itemId/itemName`.
  - `frontend/app/s/[token]/page.tsx` is login-gated with a sign-in CTA carrying `?next=` and renders a
    "Change history" section (create/rollback/update kinds with field diffs) plus the non-request tree
    view; `frontend/app/login/page.tsx` now honors the validated `next` param. New
    `backend/tests/itemShares.integration.test.cjs`; `shares.integration.test.cjs` updated.
- Relocate Workflow into the sidebar (this commit): `AppShell.tsx` drops the top `TabBar`
  (`main-tab-request`/`main-tab-workflow`); `Sidebar.tsx` gains a `rail-workflow` rail button and a
  `WorkflowsPanel` (`workflows-panel`, `new-workflow`, `workflow-<name>`, `back-to-apis`) that drives
  `SET_TAB('workflow')`, and the rail restores from persisted state. `TabBar.tsx` remains for
  CreateModal/RequestConfigurator/ProjectOverview/ScratchpadWorkspace.
- App-only fullscreen toggle (this commit): `icons.tsx` adds `MaximizeIcon`/`MinimizeIcon`;
  `TopBar.tsx` adds `data-testid="fullscreen-toggle"` using the Fullscreen API
  (`documentElement.requestFullscreen`/`exitFullscreen`) with a `fullscreenchange` listener.
- Issue batch complete (issues 1–12 + workflow relocation + fullscreen).

### Follow-up: mobile top bar collapse

The `subscription-chip` (issue 11) and `fullscreen-toggle` were added after the mobile chrome
breakpoint work, so on phones the top bar overflowed and items squeezed/merged. Fixed in
`frontend/app/mobile.chrome.css` + `frontend/src/components/TopBar.tsx`:

- Search button merged its icon with the kbd hint on phones: the `font-size:0` collapse does not
  affect the kbd (it keeps its own 10px font). Labels now carry a `btn-label` class and both
  `.btn-label` and `.global-search-kbd` are hidden in the bar on mobile (the bell badge is untouched).
- Import cURL / Test cURL bar buttons are hidden below 900px and surfaced as `mobile-only-item`
  entries in the avatar dropdown (`import-curl-menu-item` / `test-curl-menu-item`), hidden again at
  >=901px so desktop is unchanged.
- Wordmark hidden <=420px; top-bar action gap restored to 4px on phones.
- Verified with Playwright at 360/390/1280: `top-bar` scrollWidth == clientWidth at every width (no
  overflow), fullscreen + chips + avatar all stay distinct, and the dropdown shows the two cURL
  actions only on mobile.

### Follow-up: workflow sidebar had no styling

`WorkflowsPanel` (added with the sidebar relocation) used invented `tree-row` / `workflow-row` /
`tree-row-name` classes that had no CSS, so the list rendered unstyled. Switched the rows to the
existing `.sidebar-item` + `.sidebar-item-name` pattern and added `.workflow-item` /
`.workflow-item-count` styles in `globals.css` (icon tone, active accent row, right-aligned steps
count). Verified with Playwright: the panel now matches the Teams/Collections sidebar design.

### Follow-up: workflow creation guard + delete

- `AppStore.tsx` adds `RENAME_WORKFLOW` (metadata-only rename, no step validation) and
  `DELETE_WORKFLOW` (drops the workflow; if it was active, selects the first remaining or clears the
  id) actions.
- `Sidebar.tsx` `WorkflowsPanel`: "New workflow" now refuses to create a second untitled workflow.
  If one already exists it selects it, shows an info toast ("An untitled workflow already exists.
  Rename the existing one to create another.") and focuses/selects the builder name input. A
  workflow counts as untitled when its name is blank or "Untitled workflow" (case-insensitive).
- Delete: hover trash button on each sidebar workflow row (`workflow-delete-<name>`, with confirm) and
  a `workflow-delete-button` in the builder toolbar.
- `WorkflowBuilder.tsx`: the name input now persists the rename on blur/Enter via `RENAME_WORKFLOW`,
  so an empty untitled workflow can be renamed without passing step validation (previously it was a
  dead end because saving requires at least one step). The draft re-clones only when the selected
  workflow id changes, so name/step edits survive metadata updates; the draft is also cleared when
  the workflow is deleted.
- Verified with Playwright: new blocks the 2nd untitled + toast, rename releases the guard, and both
  delete entry points work.
