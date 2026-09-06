# MockShift — Session State

Last updated: 2026-09-06

> Canonical narrative log: docs/SESSION.md. This file is the working agreement + current state.
> Read this file first, every session. Open docs/SESSION.md only for detail on a past turn.

## Current

Step: PUSHED — Portal A `A5` subscriber self-service ("My subscription") is
complete and on `master`. Self-service endpoints under `/api/public/account`
are session-based (checkout customers stay global EDITOR per the B1 decision,
so the routes use `requireAuth` + owner guards — never portal RBAC):

- Migration `db/migrations/017_portal_self_service.sql` (applied): SECURITY
  DEFINER functions `app.self_service_cancel_subscription(uuid)` (owner check,
  ACTIVE/TRIALING only; sets `cancel_at_period_end=true`, `cancelled_at=now()`)
  and `app.self_service_reactivate_subscription(uuid)` (undo); both pin
  `search_path`, ERRCODEs (42501 no-session/not-yours, P0002 missing, P0001 bad
  state), GRANT EXECUTE TO app_user. `app.supersede_subscriptions(_except_sub_
  id)` marks CANCELLED immediately every other ACTIVE/TRIALING sub of the
  caller (the change-confirm supersede path). Audit rows written inside the
  functions: `subscriptions.self_cancel` / `self_reactivate` / `self_superseded`.
  Rationale: the existing `subscriptions_update` RLS policy is portal-roles-only
  and cannot be widened to EDITOR customers.
- Backend `portal/backend/src/routes/customerAccount.js` (mounted at
  `/api/public/account`, `server.js`): `GET /overview` — account row + newest
  current sub (ACTIVE/TRIALING preferred) + newest-first invoices
  (`order_id`/`billing_cycle`/`plan_key`/`plan_name` from orders/plans) +
  `hasPaidOrders`. `POST /cancel` / `POST /reactivate` `{ subscriptionId }` —
  ownSubscription guard (404 unknown, 403 not yours, 409 wrong state), then the
  SQL function. Reuses A4 shapes (`SUB_COLUMNS`, `toSubscriptionShape`,
  `toInvoiceShape`).
- Plan change is deliberately NOT a new endpoint: confirming an A4 order for a
  different plan (or activating Free) supersedes the old current sub instantly
  — `publicCheckout.js` calls `app.supersede_subscriptions($1)` inside the
  confirm/free-activation client transactions. Same-plan duplicates stay 409.
- `portal/backend/CONTRACT.md` gained the A5 section + the A4-confirm
  supersede wording.
- Frontend (`portal/frontend`, :3002): `app/account/*` (page + layout + scoped
  `.ac-` dark design-token theme incl. status chips + media queries),
  `app/login/*` (layout/page; import is `../account/account.css` — the CSS
  import bug that 500'd `/login` was fixed this turn), components
  `AccountView.tsx` (loading/error/signed-out/ready; plan card with status
  chip + renewal date + cancel-note; cancel/reactivate; plan-switch accordion
  filtered to plans ≠ current, cycles preserved; invoice history; sign out),
  `LoginView.tsx` (redirect default `/account`), `AccountLink.tsx`
  (fetchMe-gated signed-in "My subscription" header link) wired into the
  landing `nav-actions` + checkout layout; A4 success CTA → "Go to My
  subscription" (`/account`); `checkoutApi.ts` account types/helpers.
- Verified: migration 017 applied; portal backend restarted
  (`term_1788730661493_70`, PID 25431; health + unauth-overview 401 OK);
  backend matrix `/tmp/a5-account-matrix.cjs` 27/27 (guest Starter +5d bonus,
  overview shapes, unscheduled-reactivate 409, cancel → double-cancel 409,
  reactivate undo, Pro change supersedes Starter + no bonus, Free downgrade,
  duplicate Free 409, cross-user 403, non-subscriber null overview + empty
  invoices, cancelled-sub reactivate 409, duplicate-active 409, bad uuid 400)
  + audit rows verified; A4 regression matrix re-run ALL PASS after the
  supersede change (T3 now asserts a re-pick of a superseded plan is a 201
  plan change; duplicate-active 409 lives in the A5 matrix); portal
  `npx tsc --noEmit` clean; Playwright smoke `/tmp/a5-account-smoke.cjs`
  ALL PASS (23 checks: signed-out sign-in CTA, plan card Starter/Active +
  renewal + cancel, cancel → note + reactivate, reactivate undoes, switch
  accordion excludes Starter + offers free/pro, invoice row, checkout
  AccountLink → /account, sign-out to landing, /login wrong-creds error then
  real login → /account).

Current demo/DB state: dev DB was reset + reseeded to the canonical demo
baseline after the matrices/smoke (throwaway a5_*/pwacct_*/buyer1_* users
removed; 9 demo subs — active 4 / trialing 1 / past_due 1 / suspended 1 /
cancelled 1; plans free 0 / starter +5 / pro +10 / team +15 / enterprise 0;
the three 017 functions verified intact).

Live processes: portal backend :3102 `term_1788730661493_70` (restarted this
turn), portal frontend :3002 `term_1788633952808_43`, main backend :3001
`term_1788697988497_54`, main frontend :3000 `term_1788697990497_55`, mock
:3999 `term_1788637750561_47`.

Portal demo logins: boss ADMIN / pm MANAGER / dev EDITOR (non-portal, 403 on
portal) — passwords from `backend/scripts/seed-dev.js`; VIEWER smoke account
`viewerb3@test.io` / `viewerpass123` (leave). Worktree leftovers: keep
`frontend/tsconfig.tsbuildinfo` unstaged + untracked
`frontend/.next.bak-1788661828/`; scratch DB `apihub_b5test` (harmless).

PREVIOUS TURN (Portal A — `A4` public purchase/checkout, pushed `a1e02d4`
feat + docs `c3cf9b0`): full record in docs/SESSION.md + git. Highlights:
`/api/public/checkout` guest auto-account + session (free ₹0 activates with NO
order; paid → PENDING order + DRAFT `INV-YYYY-####`), `/confirm` owner-only +
idempotent → order PAID + invoice PAID + ACTIVE sub whose `current_period_end`
extends by the first-paid-order bonus (+5/+10/+15), `GET /orders/:id` reload,
migration 016 insert policies, frontend `/checkout` + `/confirm` + landing
CTAs (`checkout.css` `.ck-` theme), 16/16 Playwright smoke + backend matrix.
A5 built on it: A4's success CTA now points at `/account`.

PENDING (not this turn):
- Portal A next (see `## Pending — Two subscription portals`): A6 payment
  gateway + webhooks + receipts (later). A2 + A4 + A5 done (`ea64d44`).
- "Send item to another user" accept/reject (see `## Pending — Send item to
  another user`) — planned, not started.
- Main-app roadmap S4+ (personal API tokens, server-side POST /api/runs, CLI +
  reporters, data-driven runs).

PREVIOUS TURN (Workspaces sidebar scanability):
Step: WORKSPACES SIDEBAR SCANABILITY. Requested: stop showing
“Select a workspace…” when one is already selected, and stop team headers
from looking like workspaces.

- Login auto-selects `My Workspace` (else first workspace) so collections
  load without a click. Failed loads surface the error instead of a stuck
  “Loading collections…” hint.
- Empty teams are omitted from WORKSPACES. Grouped nav only appears when
  at least one team actually has a workspace. Team headers are a quiet
  “Team” label + name (not a workspace chip). Ungrouped leftovers sit
  under “Workspaces / Ungrouped”.
- Empty state is honest: no workspaces → create one; workspaces exist
  but none open → “Open a workspace above…”; never “Select a workspace”
  while a chip is already active.
- Testids kept: `workspace-My Workspace`, `team-group-*`, `new-workspace`,
  `empty-state`, `empty-new-workspace`.
- Files: `frontend/src/components/Sidebar.tsx`,
  `frontend/src/store/WorkspaceStore.tsx`, `frontend/app/globals.css`,
  `frontend/e2e/nav-normal.spec.ts`, `frontend/e2e/project-overview.spec.ts`.
- Verification: `tsc --noEmit` clean; frontend `npm test` 89/89; e2e
  `nav-normal` + `project-overview` 2/2. Skipped `next build` while
  `next dev` is live. Pushed as part of `11e7bb8`.

PREVIOUS TURN (Username for search / invite / add-to-team — pushed `11e7bb8`):

Step: USERNAME FOR SEARCH / INVITE / ADD-TO-TEAM. Requested:
add a unique username so people can be found and added to a team without
exposing email.

- Migration `014_user_username.sql`: `users.username` NOT NULL, format
  `^[A-Za-z][A-Za-z0-9_]{2,29}$`, unique on `lower(username)`. Backfills
  existing rows from the email local-part.
- Signup + admin create require/accept `username`; if omitted the API
  derives one from the email local-part and uniquifies. Helper
  `backend/src/api/username.js`.
- `GET /api/teams/:id/org-users` returns `{ id, name, username }` (no
  email). `POST /api/teams/:id/members` accepts `userId`, `username`, or
  `email`. Team member rows include username.
- TeamsModal searches/displays name + `@username`; members show
  `Name (@username)`. `invite-email` testid kept on the search box.
  Seed usernames: boss / pmuser / dev.
- Tests: `username.test.cjs` 4/4; `db/tests/run.sh` all pass (incl. 14);
  picker API 1/1; e2e picker + `nav-normal` + `project-overview` 3/3.
- Verification: `tsc --noEmit` clean; frontend `npm test` 89/89;
  backend `test:api:unit` 53/53; `next build` green. Isolated picker
  API test drops schema — reseeded. Backend :3001
  `term_1788697988497_54`; frontend :3000 `term_1788697990497_55`.
  Pushed as part of `11e7bb8`.

PREVIOUS TURN (Team invite searchable list — pushed `11e7bb8`):
`GET /api/teams/:id/org-users`, add by userId, TeamsModal picker,
click team name to open that team, people list hidden until typing.

PREVIOUS TURN (Duplicate "(copy)" naming + sibling-unique names — committed
`7f59e25` / docs `3450823`):

Step: DUPLICATE "(COPY)" NAMING + SIBLING-UNIQUE NAMES. Requested:
duplicating must not keep the source name — copies get " (copy)" appended — and
names must be unique among siblings: two requests in a folder (or collection
root) and two folders under the same parent may never share a name.
- Backend `backend/src/api/routes/content.js`: `pickUniqueName` +
  sibling-scope lookups wired into request/folder create, rename + move (PUT)
  and both duplicate endpoints. A duplicated request keeps its editor state
  but is named "X (copy)", "X (copy) 2", …; a duplicated folder renames only
  its root copy (interior folders/requests keep names under fresh parents).
  Renaming or moving onto a taken sibling name auto-renames
  ("Target" → "Target (copy)"). Comparison is case-insensitive.
- Frontend: `WorkspaceStore.duplicateRequest/duplicateFolder` return the copy
  name and `Sidebar` toasts `Duplicated "X (copy)"`; `renameRequest`,
  `moveRequest`, `moveFolder` write the server-resolved name back into the
  tree/active request so collision renames appear instantly.
- Files: `backend/src/api/routes/content.js`, `backend/tests/
  duplicate.integration.test.cjs`, `frontend/src/store/WorkspaceStore.tsx`,
  `frontend/src/components/Sidebar.tsx`, `frontend/e2e/request-duplicate.spec.ts`.
- Verification: backend API suite 64/64; `tsc --noEmit` clean; `npm test`
  89/89; `next build` green; e2e `request-duplicate` 2/2 + regression batch
  10/10 (create-request-form ×2, curl-import, request-tabs ×4, dirty-dot,
  folder-drag-move, nav-normal). DB reseeded after the integration suites
  dropped/recreated the schema; backend :3001 and mock :3999 restarted.
- Committed and pushed as `7f59e25` ("feat(content): duplicate '(copy)' naming
  + sibling-unique names"), 8 files +394/−88; working tree clean except
  `frontend/tsconfig.tsbuildinfo`.

PREVIOUS TURN (New API request dialog — Form | cURL — committed `1caf275`):

Requested: the
"New API request" dialog should either be a full form — Name + Type + Method +
URL plus the fields relevant to the chosen method (Body for POST/PUT/PATCH,
query params for GET/DELETE/HEAD/OPTIONS …) in a horizontal tab strip — or a
cURL paste. Confirmed approach: a segmented Form | cURL switch in the dialog.
- Form mode: Name (optional, auto-derived `METHOD host`) + Type
  (REST/SOAP/GraphQL/Auth) + Method select + URL, then the Params | Headers |
  Body tabs in `create-request-tabs`. Params and Headers are always present;
  Body appears only for body-carrying methods (POST/PUT/PATCH) and is the
  default tab for GraphQL/SOAP/Auth (selecting a non-REST type auto-switches a
  body-less method to POST). Body has a JSON/XML/Raw type selector
  (`create-body-type`); GraphQL saves `bodyType: GRAPHQL`. Params/Headers use
  the shared `KeyValueRows` (testids `create-params-*`/`create-headers-*`).
- cURL mode: `create-curl-input` textarea with a live `create-curl-preview`
  (METHOD + url while typing); on Create the command is parsed with the shared
  `parseCurl` and the saved request is pre-filled with method/url/query
  params/headers/body. The URL field no longer sniffs curl (that is now the
  cURL tab's job), and the pre-existing top-bar "Import cURL" flow is
  unchanged.
- Both modes create through `contentApi.createRequest` + `updateRequest`
  (persisting headers/queryParams/bodyType/bodyJson/contentType), then
  `reloadTree` + `selectRequest` — same path the old curl auto-detect used.
  Files: `frontend/src/components/CreateModal.tsx` (rewritten request branch),
  `app/globals.css` (`.create-mode-tabs`, `.create-method-url`,
  `.create-request-tabs`, `.create-body-input`, `.create-curl-*` + ≤640px
  stack), new `frontend/e2e/create-request-form.spec.ts` (2 tests).
- Verification: `npx tsc --noEmit` clean; `npm test` 89/89; `next build`
  green; new e2e 2/2 (GET shows Params/Headers without Body; POST adds Body
  tab; persisted request keeps method/url/params/body — and cURL mode
  pre-fills a saved request). Regression batch 12/12 (`curl-import`,
  `request-tabs` ×4, `dirty-dot`, `request-duplicate` ×2, `folder-drag-move`,
  `nav-normal`, + the 2 new).
- Running now: main frontend :3000 (term_1788635305043_45), main backend
  :3001 (term_1788544342120_23), mock :3999 (term_1788554330931_36), portal
  backend :3102 (term_1788633886949_42), portal frontend :3002
  (term_1788633952808_43). Previews:
  https://3000-d996ae6ab8ef93e4.monkeycode-ai.live and
  https://3002-d996ae6ab8ef93e4.monkeycode-ai.live
- Committed and pushed as `1caf275` ("feat(modal): New API request dialog
  Form | cURL with method-driven tabs"), 6 files +614/−90, working tree
  clean except `frontend/tsconfig.tsbuildinfo`.

PREVIOUS TURN (Portal A — landing/product page; the main-app turns are below
in this file and in docs/SESSION.md):

Step: COMPLETE — Portal A `A2` (showcase UI polish, light flat SaaS). Ranjith
picked A2 and kept the seeded placeholder pricing (INR). Code landed as
`0c9cb6d` ("feat(portal): A2 public landing + pricing UI"), pushed to
`origin/master`.
- What changed (4 files, +1051/−153): `portal/frontend/app/page.tsx` rewritten
  into a full landing page — sticky nav w/ anchor links + "Public preview"
  tag, hero (eyebrow, headline, lede, CTA pair), `#pricing` (renders
  CatalogPreview), `#features` (3 value-prop cards w/ inline SVG icons),
  `#faq` (5 native `<details>/<summary>` items), final CTA band on dark
  primary + footer. All copy is hand-written marketing text; no hardcoded
  plan rows anywhere.
- `app/globals.css` fully re-themed to a light, flat SaaS design system on
  CSS variables (paper background `#f8fafc`, sky accent, soft borders,
  pill buttons, `--shadow-pop` cards), responsive grid
  (`repeat(auto-fit, minmax(210px,1fr))`, single column + Pro-first ordering
  ≤640px), skeleton shimmer keyframes, focus-visible rings, and a
  `prefers-reduced-motion` guard. `app/layout.tsx` themeColor flipped
  `#0a0d0a` → `#f8fafc`.
- `src/components/CatalogPreview.tsx` (unchanged data contract): catalog
  driven from `GET /api/public/plans` (PUBLISHED only). Kept/verified hooks —
  `data-plan-key` per card, `data-testid=choose-<key>`, `purchase-notice`,
  `plans-loading`. Billing toggle swaps monthly/yearly from the seeded
  `price_monthly`/`price_yearly`; yearly shows a per-card "Save 17% with
  yearly billing" line (computed — seed is 12×monthly vs yearly ≈ 16.7%) and
  the toggle's ~17% badge; "Free" stays `₹0`; "Enterprise" (null prices,
  CUSTOM cycle) renders a "Custom"/"Contact sales" card with no trial badge;
  "Pro" carries the "Most popular" badge + accent CTA. CTA clicks fire a
  transient "…checkout opens with the purchase flow (Portal A, A4)" notice —
  no dead buttons. Error state shows a retry button; loading shows 5
  skeleton cards.
- Verification (this turn): `npx tsc --noEmit` clean; `next build` green
  (Next 14.2.35, `/` + `/_not-found` static). Playwright chromium (installed
  this turn via the repo's `frontend/node_modules` playwright) swept the live
  page at 375/768/1024/1440 — zero horizontal overflow, no console/page
  errors at any width; all 5 PUBLISHED plans render with correct prices.
  Functional check: Monthly ₹0/₹99/₹299/₹799/Custom → Yearly
  ₹0/₹990/₹2,990/₹7,990/yr with "Save 17%" on the three paid plans and the
  "Most popular" badge on Pro; clicking Pro's CTA shows the A4 notice.
- Running now (unchanged): portal backend :3102 (term_1788597066227_8),
  portal frontend :3002 (term_1788597068228_9); main backend :3001
  (term_1788516303621_4), main frontend :3000 (term_1788516311828_5), mock
  upstream :3999 (term_1788516301621_3). Preview:
  https://3002-c7402a4a2dd54ad1.monkeycode-ai.live

Step: COMPLETE — milestone `A1+B1+X1` (two subscription portals, first
foundation milestone). Code landed as `71b2488` ("portal structure initiate
and in-progress") + `26d68f4` ("inprogress continuation" — finished the
leftover hygiene + RLS tightening), both pushed to `origin/master`. This turn
reconciled this file and recorded the verification state (leftover #3).

What is complete (code at HEAD `26d68f4`):
- X1 — separate portal codebase: new `portal/` folder with its own Express 5
  backend (`portal/backend`, :3102) and Next 14 frontend (`portal/frontend`,
  :3002, rewrites `/api` → 127.0.0.1:3102). The backend reuses the main
  backend's DB pool + cookie-session auth by importing
  `backend/src/api/{db,authLib,access,routes/auth}` from `shared.js` (no
  crypto/session drift). Repo hygiene done: `portal/.gitignore` added and the
  build caches that `71b2488` had committed (`portal/frontend/.next/**`,
  `*.tsbuildinfo`) are untracked.
- A1 — catalog model + API. Migration `013_portal_plans_subscriptions.sql`
  (013, NOT 012 — 012 was already used by `012_request_body_parts.sql`; next
  free number 014): adds global role `SUPPORT` to the `role` enum, tables
  `plans`/`subscriptions`/`orders`/`invoices` (FKs, status enums, indexes),
  RLS helper `app.portal_role()`, and seeds the five INR plans Ranjith
  specified 2026-09-04 (Free/Starter/Pro/Team/Enterprise — all PUBLISHED,
  machine-readable `limits` + marketing `features`). Portal A public read API:
  `portal/backend/src/routes/publicCatalog.js` (`GET /api/public/plans`,
  `/api/public/plans/:key` — PUBLISHED only, no auth, admin columns never
  exposed). Portal B admin CRUD: `portal/backend/src/routes/plans.js` (list/
  read VIEWER+, create/update MANAGER+, delete ADMIN; full payload validation;
  409 on duplicate key and on delete of a referenced plan).
- B1 — Portal B RBAC. `portal/backend/src/portalAccess.js` documents the
  endpoint matrix and ships `roleAtLeast` + `requirePortalRole(minRole)`
  middleware over the existing global `role` enum (SUPPORT added in 013):
  ADMIN(4) / MANAGER(3) / SUPPORT(2) / VIEWER(1); platform EDITOR is NOT a
  portal role and is denied. `server.js` mounts `/api/health`, reused
  `/api/auth`, `/api/me` (session user + `portalRole` or null), `/api/public`,
  and RBAC-guarded `/api/plans` + `/api/portal/summary`. `summary.js` returns
  plan/subscription/order/invoice counts (VIEWER+). RLS policies in 013 mirror
  the matrix; `26d68f4` tightened `plans_select`/`subscriptions_insert` to
  portal roles only (no DRAFT leakage to non-portal roles), added `app_user`
  grants for db/tests, and plans.js/summary.js now pass `{ userId }` into the
  shared `query()` helper so RLS identity (`app.current_user_id()` /
  `app.portal_role()`) resolves per request.
- Portal A showcase slice (working preview page, NOT the full A2 milestone):
  `portal/frontend` renders a "Subscription Hub" landing + pricing page
  (`app/page.tsx`, `app/globals.css`, `src/components/CatalogPreview.tsx`)
  reading the public catalog client-side with INR formatting, loading/error
  states, and `data-plan-key` hooks. A2 polish / A4 checkout / A5 self-service
  and all of Portal B's UI (B2–B6) remain later milestones.

Verification recorded this turn (2026-09-05):
- Migration `013` applied cleanly to the local dev `apihub` DB — 5 seed plans
  present, `SUPPORT` in the role enum. `node --check` clean on all six portal
  backend files.
- Portal backend boots on :3102 (shared `AUTH_SECRET=dev-secret` + local PG
  env): `/api/health` OK; `/api/public/plans` returns the 5 PUBLISHED plans,
  `/api/public/plans/pro` returns the Pro plan (internal columns stripped).
- Live RBAC matrix using the seeded demo users (boss=ADMIN, pm=MANAGER,
  dev=EDITOR, each logged in via the portal `/api/auth` = same session
  scheme): `/api/me` → `portalRole` ADMIN/MANAGER/null. No-auth → 401 on
  `/api/plans` and `/api/portal/summary`. dev(EDITOR) → 403 on both, incl. a
  POST. ADMIN/MANAGER plan list/read → 200. MANAGER create → 201; MANAGER
  delete → 403, ADMIN delete → 200 (a throwaway plan was created then deleted,
  DB left at the 5 seed rows). Invalid payload → 400. `/api/portal/summary`
  → correct counts (plans 5, subscriptions/orders/invoices 0).
- Portal frontend `next build` green after a fresh `npm install`
  (Next 14.2.35; route prerendered static). `portal/frontend/.next` and both
  portal `node_modules` are gitignored.
- Running now: main backend :3001 (term_1788589812510_5), main frontend :3000
  (term_1788589817373_6), mock upstream :3999 (term_1788589806646_4), portal
  backend :3102 (term_1788590436000_7, new this turn).

Next (AWAITING Ranjith): pick the next portal segment — A2 showcase polish /
A4 purchase+checkout / B2 management dashboard — and confirm real plan
pricing. See `## Pending — Two subscription portals` below.

This milestone was preceded by (2026-09-04, plan two subscription portals —
docs only):
- Pulled latest code (HEAD `58a478b`, incl. `3b6ac59` per-request undo/redo,
  ProjectOverview, multipart parts, mobile CSS). Working tree clean.
- Recorded a segmented pending plan for two portals in `## Pending — Two
  subscription portals` below:
  - Portal A — public subscription showcase + purchase website.
  - Portal B — internal subscription management portal with RBAC.
- Existing RBAC base confirmed: `role` enum (`ADMIN`/`MANAGER`/`EDITOR`/
  `VIEWER`), `users.role` global role (002/003) + per-scope memberships
  (`workspace_members`, `team_members`, org roles), guard middleware in
  `backend/src/api/access.js` (`ROLE_RANK`, `requireGlobalRole`), RLS on
  content tables, `app.role_at`/`workspace_role` SQL helpers.
- No source changes and no tests this turn (docs only).

PREVIOUS TURN (2026-09-04, per-request undo/redo + back to previous request):
- Scope: per-request Undo/Redo toolbar buttons with global Ctrl+Z / Ctrl+Y /
  Ctrl+Shift+Z shortcuts, plus a "Back to previous request" button. Confirmed
  scope: undo/redo covers working-copy edits ONLY — the DB is never touched;
  Save moves the baseline so undoing past a save re-dirties the tab. Back
  follows chronological activation order (open+use 1 → 2 → 3, Back → 2); a
  previously-active request closed since is reopened at its original tab
  position with its unsaved working copy + baseline restored.
- Store (`frontend/src/store/WorkspaceStore.tsx`): per-request edit history in
  refs keyed by requestId (`editUndoRef`/`editRedoRef` — snapshots of the
  whole `ApiRequest` working copy), coalesced into steps by an 800ms burst
  timer (`EDIT_BURST_MS`, limit `EDIT_HISTORY_LIMIT=100`) that resets on tab
  switch/reactivation; a redo stack clears on any new edit. `updateActiveRequest`
  writes straight to `activeRequest`/ref and owns the burst logic. Back state
  is a `navStackRef: string[]` of real active-request transitions (effect on
  `activeRequestId`, deduped, never on A→null, never re-pushed when
  re-clicking the active tab); `goBackRequest` walks it newest→oldest and
  switches to an open tab, else reopens a `closedTabs` entry at its original
  index, else refetches via `selectRequest` (a deleted request is skipped).
  History/back state clears on tab close, request delete, workspace/collection
  switches, and workspace/team deletion. New context API: `canUndoRequest`,
  `canRedoRequest`, `canGoBackRequest`, `undoActiveRequest`,
  `redoActiveRequest`, `goBackRequest`.
- UI (`frontend/src/components/RequestTabs.tsx`): the tab strip is wrapped in
  `.request-tabs-bar` (`data-testid="request-tabs-bar"`) with a leading
  `.request-nav-controls` group: `request-back`, `request-undo`, `request-redo`
  (each disabled at the end of history). Existing `request-tab-switch-*` /
  `request-tab-close-*`, `unsaved-dot`, `save-request-button`, `aria-selected`
  all untouched. New icons `BackIcon`/`UndoIcon`/`RedoIcon` in `icons.tsx`;
  CSS in `globals.css` + `mobile.chrome.css` (30px touch targets ≤640px).
- Shortcuts (`frontend/src/components/useRequestHistoryShortcuts.ts`, new):
  capture-phase `keydown` at `window`; only fires when focus is NOT in an
  editable element (input/textarea/select/contentEditable/CodeMirror), so
  Ctrl+Z keeps doing native editor undo while typing. Ctrl+Z undo; Ctrl+Y and
  Ctrl+Shift+Z redo (Cmd variants on macOS).
- New e2e `frontend/e2e/request-undo-redo-back.spec.ts` (4 tests): back order
  over 3 requests; undo/redo working-copy semantics incl. dirty dot and redo
  cleared by a new edit; back reopens a closed dirty tab restoring its unsaved
  working copy; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo with the focus guard.
  Existing regression-critical specs re-verified (request-tabs, dirty-dot,
  send-working-copy, request-tabs bar).
- Verification: `npx tsc --noEmit` clean; `npm test` 89/89; `next build`
  green; full desktop e2e on a fresh reset+seed DB and fresh mock-upstream
  (:3999): 26 specs / 43 tests → **41 passed, 2 failed** — the two failures
  are the documented environmental `assertions-runner` (shared mock state:
  "Requests: 8" saw 10) and `nav-race` (URL stays /manage), both reproduce on
  the clean baseline; the new spec passed 4/4 and `send-working-copy`/
  `request-tabs` stayed green.
- Running now: frontend `npm run dev` :3000 (term_1788555014639_40), backend
  :3001 (term_1788544342120_23), mock upstream :3999 (term_1788554330931_36);
  preview https://3000-d996ae6ab8ef93e4.monkeycode-ai.live
- Commit: `3b6ac59` (feat(undo): per-request undo/redo and back-to-previous-
  request with global shortcuts) — pushed to `origin/master`.

PREVIOUS TURN (2026-09-04, narrow-pane preview UI fix — commit `138631e`):
- QA feedback at <641px in the preview pane ("fonts/buttons very big",
  "split/side-by-side not working") traced to `frontend/app/mobile.editor.css`
  only: the ≤900px override forced `.split-pane-horizontal` into stacked panes
  (so "Side by side" visibly did nothing) and ≤640px touch controls were
  inflated (40-46px). Fixed media-scoped: "Side by side" honored down to 390px
  (divider 10px); controls compacted (method/url 42→34px, Send 44→36px and no
  longer full-width, editor tabs 40→36px, KV/multipart/assertion inputs
  40→34px, row buttons 40→34px, response tabs 36→32px, formula/scratchpad rows
  44-46→38px, CodeMirror 40vh→32vh). Body font stays 13px; zero overflow at
  every probed width 360-1440px.
- Verified: Playwright geometry sweeps (control sizes, pane boxes,
  scrollWidth-vs-clientWidth) across widths/view modes; tsc clean, unit 89/89,
  `next build` green, full desktop e2e 37/39 (documented environmental
  `nav-race` + cold-compile `history.spec`, passes warm). Committed `138631e`;
  pushed to `origin/master`.

PREVIOUS TURN (2026-09-04, team/project-scoped workspaces — commit `6846d88`):
- User scope: "We should be able to create everything based on team wise" — a
  member of a team (e.g. EMEA) who holds access to that team's projects
  (e.g. ats, ayq) should work inside those projects only; an admin must be
  able to assign users to projects; opening a project should show its users,
  sub-project/workspace info and access levels. Clarified mapping with the
  user: Team = top grouping in navigation (teams → shared workspaces →
  projects → collections, plus an "Other workspaces" fallback so no current
  access is lost); "sub projects" = the project's workspace shown as an info
  panel in the overview; overview = full command center (Members + access
  levels, content summary, activity/history, workspace info); access is
  managed by admins AND project managers. No schema change was needed — the
  org → teams → workspaces → projects model already existed but the UI never
  surfaced it.
- Backend (`backend/src/api/routes/projects.js`, `teams.js`, `workspaces.js`):
  - `GET /api/teams/groups` — team-scoped nav data: teams the user is a member
    of (or org-admin of) each with its shared workspaces + the caller's role
    on each, plus an `other` bucket (accessible workspaces not shared by any
    of the user's teams). `listWorkspaces()` in `workspaces.js` was exported
    for reuse.
  - `GET /api/projects/:projectId/overview` — member-readable (any user with
    project read access): project + workspace/organization info, myAccess
    (level/isManager) + canManage, content counts (collections/folders/
    requests/automations/workflows/mock-server), managers & members with
    roles + grantor/granted-at, and the 8 most recent project runs.
  - Manager-grade membership management (guarded by effective project access
    >= MANAGER, so real project managers who are not global MANAGERs can act):
    `POST /api/projects/:projectId/members` (add/upsert member, roles
    EDITOR|VIEWER only), `PATCH .../members/:userId` (role change),
    `DELETE .../members/:userId` (remove member; managers are protected),
    `GET /api/projects/:projectId/org-users` (org users not yet on the
    project, for the add-member picker). Every mutation is audited. Admins
    keep the existing `/api/admin` grant endpoints unchanged.
- Frontend (`frontend/src/components/Sidebar.tsx`, `ProjectOverview.tsx`,
  `store/WorkspaceStore.tsx`, `lib/api.ts`, `AppShell.tsx`,
  `app/globals.css`):
  - Sidebar workspace chips are now grouped under Team sections
    (`team-group-<name>`) with an "Other workspaces" fallback; every
    pre-existing testid/behavior is preserved and the flat layout is kept
    when the user has no team grouping. Chips fetch from `/api/teams/groups`
    via `teamApi.groups()` inside the store `refresh()`.
  - Project rows in the tree are now clickable and open the Project Overview
    command center in the main area (new `projectApi.overview` wiring; the
    existing mock-server icon and request-access buttons are untouched).
  - `ProjectOverview.tsx` tabs Overview (stat tiles: collections/folders/
    requests/automations/workflows/mock-server + Workspace info card showing
    workspace/organization/visibility) · Members & Access (managers + members
    with role badges; admins/project managers get an org-user picker,
    per-member role select `role-<email>`, and `remove-member-<email>`; every
    mutation refreshes the overview in place) · Activity (recent project
    runs). Closing it returns to the normal request-editor empty state.
- Verification:
  - Backend: `node --check` clean on all three route files; live curl matrix
    against :3001 — `/api/teams/groups` returns team groups with shared
    workspaces and moves them out of `other`; overview returns counts/managers
    (PM)/members (Dev); a VIEWER member gets `canManage:false` and is
    rejected from member-management (403), while a project MANAGER can add/
    re-role/remove members (MANAGER role rejected) and sees the empty
    add-member picker correctly; all mutations audit-logged.
  - Frontend gates: `npx tsc --noEmit` clean; `npm test` 89/89; `next build`
    green; globals.css braces balanced.
  - Desktop e2e (Playwright 1280px, serial): 37/39 — the two failures are
    `nav-race` (toHaveURL stays /manage) and `send-working-copy`
    (posts/2 not found); BOTH were reproduced on the clean pre-change
    baseline via `git stash`, and send-working-copy passes alone on a fresh
    seed+mock ⇒ environmental flakes, not regressions. The new spec
    `e2e/project-overview.spec.ts` (team grouping + command center end to end)
    passes. New total: 25 specs / 39 tests.
- Running now: frontend `npm run dev` :3000 (term_1788538358285_19), backend
  :3001 (restarted this turn: term_1788544342120_23), mock upstream :3999
  (restarted this turn: term_1788544971366_25); preview
  https://3000-d996ae6ab8ef93e4.monkeycode-ai.live
- Commit: see git log (this turn's team/project scoping work, docs included)
  pushed to `origin/master`.

PREVIOUS TURN (2026-09-04, mobile responsive UI via 4 parallel agents — commit `4672c15`):
- User scope: "Make it full mobile responsive ui and better UX as well. Use
  parallel agents to achieve that and test." All desktop styles live in one
  `app/globals.css` (4548 lines) with existing e2e at 1280px, so each agent
  appended media-query-only overrides to an exclusive NEW file imported after
  globals in `app/layout.tsx` (order: chrome → editor → views → modals), and
  was given a disjoint TSX file list. Rule: no existing className/data-testid
  renamed or removed; desktop (>900px) must stay pixel-identical (reset block
  at `min-width:901px` hides the new DOM nodes). Agents only touched their own
  files; coordinator merge diff verified clean.
- Agent 1 — chrome/nav (`app/mobile.chrome.css`, `AppShell.tsx`, `TopBar.tsx`,
  `Sidebar.tsx`, `icons.tsx`): hamburger (`MenuIcon`, `data-testid=
  mobile-drawer-toggle`, aria-controls `app-sidebar`) + off-canvas drawer:
  ≤900px `.sidebar` becomes `position:fixed; top:52px`, `translateX(-102%)` →
  open via `.app.sidebar-drawer-open`, `.sidebar-backdrop`, Escape + backdrop
  close, body scroll-lock while open; `.sidebar-panel-hidden{display:flex}`
  so top-level views (automations/manage/admin/history) show the API tree in
  the drawer; resizer/rail-collapse hidden ≤900; top-bar actions collapse to
  40px icon targets; tab strips single-line scroll. Modals moved out of the
  `<aside>` (it is `position:fixed` on mobile). Rail Links to top-level views
  close the drawer via optional `onRequestClose` prop.
  **Drawer UX fix (coordinator, caught by the 390px smoke test):** the drawer
  must close when a request is chosen or a top-level view is opened, but stay
  open while browsing (workspace chips, collection expand, APIs/Teams rails).
  `goWorkspace()` no longer calls `onRequestClose`; instead `CollectionsTree`
  gained an `onRequestClose` prop invoked in `onSelectRequest` only. Desktop
  unaffected (prop optional/no-op).
- Agent 2 — editor/scratchpad (`app/mobile.editor.css`, `RequestConfigurator
  .tsx`, `ScratchpadWorkspace.tsx`): `.request-bar-actions` wrapper with
  `style={{display:'contents'}}` (desktop DOM/layout identical); ≤900px
  split-pane becomes stacked column with touch dividers; ≤640px method+URL
  wrap, full-width 44px Send, KV/Multipart rows restack (check top-left,
  value below key) with ≥40px targets, CodeMirror gets usable height.
- Agent 3 — views (`app/mobile.views.css`, `AdminView.tsx`, `ManageView.tsx`,
  `HistoryView.tsx`): tables wrapped in additive `.table-wrap .table-stack`
  with per-cell `data-label`; ≤640px they become phone cards
  (`td::before{content:attr(data-label)}`, action row full-width); overflow
  tables scroll; Automations/WorkflowBuilder CSS-only; overview grid collapses
  (`minmax(148px,1fr)`).
- Agent 4 — modals/auth/share (`app/mobile.modals.css`, `EnvironmentsModal.
  tsx`, `app/s/[token]/page.tsx`): variable tables wrapped in `.table-scroll`;
  ≤640px modals become bottom sheets (overlay `align-items:flex-end`,
  `100dvh`+`vh` fallback, full-width, `max-height:92dvh`, safe-area padding,
  sticky headers, internal scroll); ≤900px modal cap `calc(100vw-24px)`;
  inputs ≥42px (48px auth) with 16px font to stop iOS zoom; share page kv
  table wrapped + "Open in API Hub" CTA (`data-testid=share-open-app`).
- Verification:
  - Frontend gates: `npx tsc --noEmit` clean; `npm test` 89/89.
  - `npm run build` green (10 routes; `/` First Load JS 326 kB) — served CSS
    bundle verified to contain the new mobile rules.
  - Desktop e2e (Playwright, 1280px Desktop Chrome, serial): three prod-server
    runs 37/38 and a dev-server run 35/38 — every run fails a *different*
    spec on 5s waits / mock-state / persistence races (assertions-runner,
    send-working-copy, scratchpad save, curl-import, history, nav-race), and
    each failed spec passes alone on a fresh DB ⇒ environment flakiness, not a
    regression. To run e2e here: fresh `reset:db`+`seed:dev`, freshly started
    `mock-upstream.js`, frontend `npm run dev` on :3000 (suite reuses it), and
    `npx playwright install chromium` + `install-deps chromium` (Chromium and
    OS libs are absent from a fresh box).
  - Mobile smoke (temp spec `frontend/.mobile-smoke/`, NOT committed): 390px
    viewport — login has no horizontal overflow; drawer opens via hamburger,
    workspace chip keeps it open, request click closes it, editor fits viewport
    and Send is reachable. (This smoke test is what caught the drawer bug
    above.) Cleaned from the repo after the run.
- The app currently runs the responsive build: frontend `npm run dev` on :3000
  (term_1788538358285_19), backend :3001 (term_1788538352528_18), mock
  upstream :3999 (term_1788539497512_21); preview
  https://3000-d996ae6ab8ef93e4.monkeycode-ai.live
- Commit: see git log (this turn's mobile work, docs included) pushed to
  `origin/master`.

PREVIOUS TURN (2026-09-04, structured multipart file parts — commit `b9481c2`):
- User scope (chosen in session): build Postman-style multipart parts (text
  rows + file picker) end-to-end; **persist file references too** (name/mime/
  size metadata only — file bytes are never stored server-side, re-picked per
  Send after reload). Wire/JSON contract frozen: field `bodyParts`, part =
  `{ id, key, enabled, kind: 'text'|'file', value?, fileName?, fileType?,
  fileSize?, data? }`; `data` (base64 bytes) appears only in ephemeral run
  payloads, never persisted.
- Backend: migration `db/migrations/012_request_body_parts.sql` adds
  `api_requests.body_parts jsonb`; `runner.js` builds a real native `FormData`
  body from parts (10 MB/file, 20 MB total, `{{var}}` substitution, compact
  summary in snapshots/history, never raw bytes); `content.js` persists/
  returns `body_parts`, copies it on request/folder duplicates, and links
  history + ON_REQUEST/ON_RUN_FAILURE events for ephemeral file sends via
  `POST /api/runs` when payload carries `id` + `persistHistory:true`;
  `exports.js`/`shares.js` round-trip `body_parts` (import sanitises via
  `cleanBodyParts`); `redact.js` redacts text-part values; `server.js` JSON
  cap raised 2 MB → 25 MB (base64 file bytes ride in the run payload).
- Frontend: new `MultipartRows.tsx` parts editor (text/file kind toggle, key/
  value or file picker, enable checkbox, remove/add, persisted-reference
  display); `RequestConfigurator` + `ScratchpadWorkspace` render it for
  MULTIPART and seed parts from pasted legacy `k=v` cURL bodies;
  `WorkspaceStore` keeps `selectedFiles` (requestId → partId → File) with
  `setFileForPart`, multipart-aware dirty tracking / save patch /
  `runActiveRequest` (reads files as base64 into the ephemeral run payload);
  `runScratchpad` + `scratchDraftDraft` pass `bodyParts`; `curl.js`
  `generateCurl` emits `--form-string`/`--form` from parts; new lib
  `multipartParts.js` (part factory/normalise/strip/legacy-seed/base64) +
  unit tests.
- **Metadata-sync fix (coordinator, after agent review):** `MultipartRows`
  now also writes `fileName`/`fileType`/`fileSize` into the part via `onChange`
  when a file is picked/cleared, so **Save persists the file reference** —
  previously only the in-memory `File` map was updated and a saved file part
  carried empty metadata after reload. One central spot covers both the request
  editor and the scratchpad.
- Legacy raw-text MULTIPART requests (no `body_parts`) keep the old text path;
  a stored request with a file part 400s on `POST /requests/:id/run` by design
  (bytes aren't stored) — file sends always go through the ephemeral run.
- Verification: backend `npm run test:api` 63/63, `npm test` 47/47,
  `npm run test:api:unit` 49/49; frontend `npx tsc --noEmit` clean,
  `npm test` 89/89 (incl. new multipart/curl/scratchpad-draft tests).
- Commit `b9481c2` (24 files) pushed `eacdf84..b9481c2`; docs updated
  (`docs/SESSION.md` §5.26, `instructions.md` M16); tree clean.

THIS TURN (2026-09-03, sidebar page-load slowness fix):
- User: "why it is taking more time to load the pages in sidebar? check and fix
  ASAP." Investigated:
  - Backend endpoints (workspaces, teams, tree/content, admin/manage/history/
    automations data) all serve in <75 ms — data is not the bottleneck.
  - Frontend in `next dev` was the bottleneck: every sidebar rail page
    (`/admin`, `/manage`, `/automations`, `/history`, `/login`) recompiled on
    first request (0.5–2 s cold compiles), then warmed to ~30–80 ms. Providers
    live in the root layout (no refetch on nav); route HTML + client JS in dev
    mode were the cost.
  - Fix: stopped the dev server and now serve a production build —
    `next build` (green; `/` First Load JS 323 kB) + `next start -p 3000`
    (background terminal term_1788511594790_6). Prod route timings now ~8–25 ms
    for every route (`/admin` 9 ms vs 1.95 s dev cold), no per-route compiling.
  - Preview unchanged: https://3000-204dde05e6623a51.monkeycode-ai.live
  - Note: no HMR while `next start` runs; rebuild + restart to pick up frontend
    changes. `npm run build` after the prod server is stopped only.
- No tests run (user waived). Working tree clean.

PREVIOUS TURN (2026-09-03, pull c853316 + docs sync):
- Pulled `c853316` "sidebar click fixes" (the co-author/parallel agent built on
  the collapse-toggles work and pushed). Working tree clean.
  - `Sidebar.tsx`: tree row menus (request/folder/collection) now close on a
    document-level click instead of a `.tree-menu-backdrop` (removed) — the same
    click still reaches the tree row underneath so an open ⋯ menu no longer
    makes the next sidebar click "disappear"; trigger buttons carry
    `data-tree-menu-trigger` so their own onClick is excluded. My collapse
    toggles (`collapse-workspaces` / `collapse-collections`,
    `workspacesCollapsed`/`collectionsCollapsed`, `.section-chevron`) are intact.
  - `WorkspaceStore.tsx`: added `selectSeqRef` sequencing so a stale in-flight
    `selectRequest` response can't clobber the request the user clicked last;
    deletes invalidate any in-flight selection.
  - `globals.css`: `-6px` net change (backdrop CSS dropped).
- App is running on the latest code: mock upstream :3999, backend :3001
  (`/api/health` ok), frontend :3000 — dev server recompiled the pulled files
  with no errors (GET / 200). Preview:
  https://3000-204dde05e6623a51.monkeycode-ai.live
- No source changes and no tests this turn (docs only).

PREVIOUS TURN (2026-09-03, sidebar collapse toggles):
- The two stacked panels inside the left sidebar now collapse independently:
  the **Workspaces** chips and the **Collections** tree each have a chevron
  toggle in their section header (the rail button at the bottom still collapses
  the whole sidebar to rail-only).
  - `Sidebar.tsx`: added `workspacesCollapsed` / `collectionsCollapsed` state to
    the `Sidebar` component; `CollectionsTree` accepts new `collapsed` +
    `onToggleCollapsed` props. The per-node folder/collection collapse map was
    renamed `collapsedNodes` so it no longer collides with the new boolean prop.
    When a section is collapsed only its header stays visible (chevron points
    right); the header action buttons (New collection / Import-export / Share /
    Env) remain. Testids `collapse-workspaces`, `collapse-collections`.
  - `globals.css`: `.sidebar-section-head .section-chevron` rotates 90° down
    when open — same visual language as the tree chevrons.
- Verification: `npx tsc --noEmit` clean; dev-server HMR compiled (GET / 200).
  No tests run this turn (working order per docs/SESSION.md section 9).

EARLIER TURN (2026-09-03 — env boot + request-execution loader UI):
- Fresh environment boot (no code task): installed local PostgreSQL 15 +
  Redis, started both, created `apihub`, applied migrations 001–011, ran
  `seed:dev`; installed frontend deps. Services running: mock upstream :3999,
  backend :3001, frontend :3000.
- Feature: run feedback while a request executes.
  - `WorkspaceStore`: new `requestRunning` state + `requestRunningRef` guard —
    set true at the top of `runActiveRequest`/`runScratchpad`, cleared in
    `finally`; the ref prevents a Ctrl+Enter/Send race from firing twice.
    Exposed on the context value.
  - `ResponsePane`: while `ws.requestRunning`, a translucent overlay
    (`data-testid="response-loading"`) dims the pane and centers a large
    circular `.spinner-lg` loader — NO text, as requested.
  - Send button (request editor + scratchpad): label stays "Send" so the button
    keeps a constant size; only the 14px SendIcon is swapped for an equal-size
    `.spinner-sm` while running (bar no longer shifts). Button disabled with
    title "Running…".
  - CSS: `.spinner-sm` (14px), `.spinner-lg` (34px), `.response-loading-overlay`
    (absolute inset-0, centered flex, color-mix dim backdrop);
    `.response-pane` is now `position: relative`.
- Verification: `npx tsc --noEmit` clean; dev-server HMR compiled. No test runs
  this turn (explicitly waived by the user).

SERVICES STILL RUNNING: mock upstream :3999
(term_1788446455814_3), backend :3001 (term_1788446457814_4), frontend :3000
(term_1788446470277_5). Demo logins
`boss1785867669@test.io`/`bosspass123` (ADMIN), `pm1785867669@test.io`/`pmpass1234`,
`dev1785867669@test.io`/`devpass123`. Live `next build` is NOT safe while the
dev server is up (shared `.next`) — use tsc + Playwright + `npm test` instead.

M15 DONE (this turn): verified/fixed remote commit `7af6044` — see the
"Completed (this feature)" log.

M13 DONE (this turn, alongside M12):
- Backend: reuses existing `PUT /api/folders/:id` with `parentId` (cycle guard
  already enforced on the backend).
- Frontend: `WorkspaceStore.moveFolder(folderId, parentId)` (calls
  `folderApi.update`, patches `tree.folders` locally); `Sidebar.handleDragStart`
  generalized to `'request'|'folder'`; folder rows `draggable={!isRenaming}`;
  `handleDrop` folder path with cycle guard (folder into itself/descendant or
  root-when-already-root disallowed → toast `Cannot move a folder into itself or
  its subfolder`, else `Moved "NAME"`); `.tree-folder-row { cursor: grab }`.
  New e2e `folder-drag-move.spec.ts`.

M12 DONE (this turn, alongside M13):
- New hook `useTreeRenameShortcut({ selectedRow, tree, onStartRename })`
  (capture-mode F2 keydown, ignores INPUT/TEXTAREA/contentEditable).
- Wired into `CollectionsTree` in `Sidebar.tsx` (one call after `startRename`).
- New e2e `rename-f2.spec.ts`.

M11 DONE (earlier turn, alongside M10):
- Backend `POST /api/requests/:id/duplicate` (deep copy same collection+folder,
  same name) + `POST /api/folders/:id/duplicate` (deep-copies the folder and its
  whole subtree, re-parents copies to NEW copied ids) in `content.js`.
- Frontend: `contentApi.duplicateRequest`/`duplicateFolder`; store
  `moveRequest`/`duplicateRequest`/`duplicateFolder`; sidebar Duplicate items in
  request menu + folder actions + Ctrl/Cmd+C on a selected row (ignored while
  typing). New e2e `request-drag-move.spec.ts` + `request-duplicate.spec.ts`.

Plan (micro tasks, see `instructions.md`):
M1 CreateModal auto-detect cURL (remove Fill form/Paste cURL toggle) — DONE
M2 URL-field cURL auto-parse in existing request editor — DONE
+ Extra: Ctrl+Enter (Cmd+Enter) triggers Send in the request editor — DONE
M3 Dirty-state tracking in WorkspaceStore — DONE (pushed `cb2451c`)
M4 Dirty dot indicator in editor — DONE (pushed `2ad35d2`)
M5 Backend ephemeral run endpoint (POST /api/runs) — DONE (pushed `d9c80b4`)
M6 Send uses working copy — DONE (pushed this turn)
M7 Tabs for opened requests — DONE (pushed `183d7ab`)
M8 Test cURL without saving (scratchpad) — DONE (pushed `75143f7`)
M9 Docs + wrap-up — DONE (pushed `2d3ee16`)
M10 Drag-and-drop move: request into any folder/subfolder — DONE (pushed `c7ac1f3`)
M11 Duplicate request/folder/subfolder via Ctrl+C — DONE (pushed `c7ac1f3`)
M12 Rename focused tree item via F2 shortcut — DONE (this turn)
M13 Drag-and-drop move: folder between nested folders — DONE (this turn)
M14 Rework scratchpad: full-width editor pane + save location picker — DONE (this turn)
M15 Verify/fix pulled commit `7af6044` (Ctrl+Enter editors + formula helpers + admin Access) — DONE (this turn)

## Completed (this feature)

- **Pulled parallel agent's "sidebar click fixes" (`c853316`) + docs sync**
  (this turn). The co-author agent pushed fixes on top of the collapse-toggles
  work; pulled, tree clean, no source changes needed from me.
  - Tree-row menus now close via a document click listener (`.tree-menu-backdrop`
    removed) so the click passes through to the row underneath; trigger buttons
    tagged `data-tree-menu-trigger`.
  - `WorkspaceStore` gained `selectSeqRef` request-selection sequencing; deletes
    invalidate in-flight selections.
  - Collapse toggles from `d41b27c` verified intact after the refactor.
  - App confirmed running on this HEAD (backend :3001, frontend :3000, mock
    :3999; frontend recompiled clean). Preview:
    https://3000-204dde05e6623a51.monkeycode-ai.live
  - No tests run (docs only).

- **Sidebar section collapse toggles** (previous turn, pushed `d41b27c`). Both
  stacked panels of the left sidebar — the Workspaces chips and the Collections
  tree — now have their own collapse/expand chevron in the section header, so
  each can be hidden independently (previously only the whole sidebar could be
  collapsed via the rail button).
  - `Sidebar.tsx`: `workspacesCollapsed` / `collectionsCollapsed` state on the
    `Sidebar` component; `CollectionsTree` gained `collapsed` / `onToggleCollapsed`
    props. The internal per-node collapse `Record` was renamed `collapsedNodes`
    (the new prop is a `boolean`). Collapsed sections keep only their header.
  - `globals.css`: `.sidebar-section-head .section-chevron` — chevron points
    right when collapsed and rotates 90° down when open (matches the tree
    chevron pattern). Testids `collapse-workspaces` / `collapse-collections`.
  - Verified `npx tsc --noEmit` clean + dev-server HMR compiled; no tests run.

- **Request-execution loader UI** (earlier this day, pushed `4dd8c6d`). While a request is
  running (Ctrl+Enter / Send / scratchpad Send) the UI now gives visible
  feedback instead of appearing to do nothing:
  - `WorkspaceStore` gained `requestRunning` (boolean on the context) backed by
    a `requestRunningRef` guard so a Ctrl+Enter + Send race cannot double-fire.
    Set around `runActiveRequest` and `runScratchpad`, cleared in `finally`.
  - `ResponsePane` shows a centered circular loader: a full-pane translucent
    overlay (`.response-loading-overlay`) with a 34px `.spinner-lg` circle in
    the middle. No text labels — earlier text banners were rejected in review.
    Previous response content stays visible underneath and is revealed when the
    run resolves.
  - Send buttons (`RequestConfigurator` + `ScratchpadWorkspace`) keep a constant
    size while running: the label remains "Send" and only the 14px SendIcon is
    swapped for an equal-size `.spinner-sm`, so the request-bar no longer shifts;
    button is disabled and `title` becomes "Running…".
  - CSS additions: `.spinner-sm`/`.spinner-lg` size variants, white spinner on
    the gradient primary button, `.response-loading-overlay`, and
    `position: relative` on `.response-pane`.

- **M15 — verify/fix pulled remote commit `7af6044`** (this turn). The pull
  (`26189c9..7af6044`) bundled Ctrl+Enter-from-editors + formula-helpers-panel
  fixes plus the admin Access tab. Three fixes needed:
  1. `CodeEditor.tsx` regression: `extensionFor()` returns a single
     **non-iterable** `Extension` object, so `...(extensionFor(language) as
     any[])` threw at runtime and body/formula editors never rendered. Now
     wrapped in `[extensionFor(language)]` first.
  2. `globals.css`: the formula helpers panel still covered the edit pane
     (helper was `flex-shrink: 0` with a `42vh` cap on a ~220px tab) and the
     commit targeted the nonexistent `.cm-theme` wrapper (real class is
     `.cm-theme-dark`). Helper is now `flex: 0 1 auto; max-height: 45%` with an
     internally-scrolling body; `.cm-theme-dark` added so the editor fills.
  3. Backend restarted on :3001 (was running pre-pull code) so `/api/admin/access`
     grant/revoke routes load.
  Verified: body + formula Ctrl+Enter each produce exactly ONE history row (no
  double-fire); admin Access tab renders; all grant/revoke endpoints work.
  Tests: backend jest 47/47 · test:api 58/58 · test:api:unit 49/49 · frontend
  unit 68/68 · tsc clean. Key e2e specs pass standalone on fresh reset+seeded
  DB; the two full-suite failures are the documented pre-existing ordering issue.

- **M14 — rework scratchpad: full-width editor pane + save location picker**
  (pushed this turn). `ScratchpadWorkspace.tsx` full-width editor pane (method
  select, URL input with cURL auto-parse, Params/Headers/Body/Formula/Tests
  tabs, Send ephemeral / Save / Close, response via `ResponsePane` in a split);
  `ScratchpadSaveModal.tsx` location picker (required name + all collections in
  the current workspace with nested folders as an indented tree; confirm →
  `createRequest` + `updateRequest` + `reloadTree` + `selectRequest`). `AppShell`
  renders it full-width and closes on sidebar request selection; `ScratchpadModal`
  removed. New shared lib `frontend/src/lib/scratchpadDraft.js`; e2e
  `frontend/e2e/scratchpad.spec.ts` rewritten for the new UI.

- **M9 — docs + wrap-up** (pushed `2d3ee16`). Final micro task. Updated
  `session.md` (Current status → COMPLETE; M9 marked DONE in the plan and this
  completed log), `instructions.md` (M9 status-table row → done), and
  `docs/SESSION.md` (dated §5 narrative entry). Docs only — no source, test,
  or DB changes. Feature set M1–M9 fully shipped.

- **M7 — tabs for opened requests** (pushed `183d7ab`). `WorkspaceStore` gained
  `openRequestIds[]` + `activeRequestId` + `requestCopies{}` (a working copy per
  open request) + `baselines{}` (per-request saved baseline). `selectRequest`
  now opens a request once (dedupe) or activates an already-open tab WITHOUT
  refetching, so unsaved edits survive switching; `closeRequestTab` removes the
  tab and activates a neighbour (right, else left); `isTabDirty` exposes
  per-tab dirty state. Deletes/selection clear affected tabs. Pure helpers in
  `frontend/src/lib/tabs.js` (`openTab`/`closeTab`) + `tabs.test.cjs` (6 tests).
  New `RequestTabs` component (method badge + name + dirty dot + close ×,
  confirm before closing a dirty tab) rendered above the editor in `AppShell`,
  styled in `globals.css`. New e2e `frontend/e2e/request-tabs.spec.ts` (2 tests)
  and scoped `dirty-dot`/`send-working-copy` specs to the Save-button dot since
  tabs now carry their own dots. Verified: tsc clean, `next build` green, new
  unit 6/6, new e2e 2/2, affected specs 2/2.

- **M6 — Send uses the working copy** (pushed this turn). `runActiveRequest`
  now runs the **working copy**: when `isDirty` it calls the new
  `contentApi.runEphemeral` (`POST /api/runs`) with the current editor state +
  `collectionId` and `persistHistory: false` (scratch run, no history row, the
  stored request untouched); when clean it keeps `POST /requests/:id/run` so
  run_history stays linked to the request as before. New e2e
  `frontend/e2e/send-working-copy.spec.ts`: clean send → response +1 history
  row; dirty send → `/posts/2` executed (working copy), no history, dot stays,
  stored URL still `/posts/1`. Fixed implicit-any types in
  `dirty-dot.spec.ts`. `tsc --noEmit` clean, `next build` green, 47/47 frontend
  unit tests.
- **M5 — ephemeral run endpoint `POST /api/runs`** (pushed `d9c80b4`).
  `runner.js` refactored: the fetch pipeline is extracted into
  `executePipeline` (variable substitution → formula → folder auth provider →
  HTTP call → assertions → optional history), shared by `runRequest` (stored)
  and the new `runInMemoryRequest` (in-memory shape, no stored row).
  `resolveVariables`/`activeEnvironmentId` generalized to key off a
  `collectionId`. The route takes method/url/headers/queryParams/bodyType/
  bodyJson/formula/assertions + optional `collectionId` (env vars + auth
  provider, read-access checked) + `persistHistory`; run_history is written
  only when `persistHistory` is true (request_id NULL via the nullable FK —
  history read path already LEFT JOINs, verified). Live smoke on the running
  backend (SUCCESS + persisted + no-persist), new integration test file
  `backend/tests/ephemeralRuns.integration.test.cjs` (5 tests), backend jest
  47/47, API units 49/49, existing integration suites all green.
- **M4 — dirty dot indicator** (pushed `2ad35d2`). When `isDirty` is true the
  Save button shows a `data-testid="unsaved-dot"` `•` (color `--warn`) with
  title/aria-label "You have unsaved changes"; cleared on save. New e2e spec
  `frontend/e2e/dirty-dot.spec.ts` (self-contained: fresh user + own request)
  verifies no dot on load → dot on edit → dot gone after save. `tsc --noEmit`
  clean, `next build` green, 47/47 frontend unit tests, curl-import + nav-normal
  e2e still pass.
- **M3 — dirty-state tracking in `WorkspaceStore`** (pushed `cb2451c`). Store
  now holds a `savedBaseline` snapshot of the dirty-relevant fields
  (method, url, headers, queryParams, bodyType, bodyJson, formula, assertions),
  captured in `selectRequest` and after `saveActiveRequest` succeeds. `isDirty`
  is derived by deep-comparing the working copy against the baseline and is
  exposed on the store/context for M4. Verified: `tsc --noEmit` clean,
  `next build` green, 47/47 frontend unit tests pass.
- **Ctrl+Enter send shortcut** — pressing Ctrl/Cmd+Enter anywhere in the request
  editor triggers Send (`runActiveRequest`); Send button shows "Send (Ctrl+Enter)".
- **M2** — request editor URL field (`RequestConfigurator`) auto-detects a pasted
  `curl …` and applies method, URL, headers, query params, body via
  `updateActiveRequest`, with a "cURL parsed" toast. Added shared
  `isCurlCommand` to `lib/curl.js` (reused by CreateModal). `tsc --noEmit` +
  `next build` + 47 frontend unit tests clean.
- **M1** — removed the Fill form / Paste cURL toggle from `CreateModal`; the URL
  field auto-detects `curl …` via `parseCurl` and fills method + URL live;
  structured headers/params/body applied on create. Name optional with `METHOD
  host` fallback. Removed `.create-mode-*` CSS.

- **Aiven cloud Postgres** — backend reads a gitignored `backend/.env` `DATABASE_URL` (+
  `sslmode=require`, CA via `db/ca.pem`); local PG* env vars still take precedence for tests/tooling.
  Migrations 001–011 applied on Aiven; DB seeded with demo accounts + "Mock API Demo".
- **Migration 011** — `folders` table (collection_id, parent_id for nesting, cascade deletes) +
  `api_requests.folder_id` (SET NULL on delete so requests resurface at collection root) + RLS.
- **Backend** — folders CRUD (`POST/PUT/DELETE /api/folders[/:folderId]`, includes parent-cycle
  guard), requests gain `folder_id` on create/update, workspace content tree returns `folders[]`.
- **Frontend** — Sidebar renders nested folders; create/rename/delete folder UI (CreateModal +
  MoveModal); per-request edit/rename/delete stays in place. `WorkspaceStore`/`lib/api.ts` extended.
- **New API request modal now imports cURL** — `CreateModal` request mode has a **Fill form /
  Paste cURL** toggle. In cURL mode: paste a `curl …` command, it is parsed by `lib/curl.js`
  `parseCurl` into method, url, headers, query params, body; Name is optional and auto-derived
  (`METHOD host`). Creates the request then applies the structured fields via `updateRequest`.
  Verified live: POST orders curl → method/url/headers/queryParams/bodyType/bodyJson persisted on
  Aiven DB; `next build` + `tsc --noEmit` clean.

## Test status (2026-08-16, local PG+Redis, after folders + M1–M5)

backend jest: 47/47 · test:api: 40/40 (35 + new ephemeralRuns 5) · api units: 49/49 ·
db run.sh: all pass · frontend unit: 47/47 · tsc --noEmit: clean · next build: green ·
e2e (spot): dirty-dot, curl-import, nav-normal all pass (full suite needs a freshly
`reset:db`+`seed:dev` DB because specs leave requests in "Mock API Demo").
Folders added `backend/tests/folders.integration.test.cjs` + `db/tests/04_collection_folders.sql`.

## Decisions (durable)

- **S0 done (2026-08-08)** — root session.md slimmed to a state file; turn history moved to
  docs/SESSION.md §10 (nothing deleted). Pre-S0 narrative is archived there, newest first.
- **S1–S3 close a credential-leak defect**: shares.js redacts only `authorization` / `cookie` /
  `set-cookie` / `x-api-key` header keys, so an AUTH-type request's token can still leak through
  the response body, a query string, or a Set-Cookie value. Build a `redactSnapshot()` module first
  (S1), wire it everywhere (S2), then add retention (S3).
- **S4–S8 make the suite runnable from CI** (API tokens → server-side runs → CLI → reporters →
  local/Docker modes) — what the QA team actually needs; no amount of UI work substitutes for it.
- **Backlog #8 (comments) and #9 (global search) are deprioritised/deferred** — not next.

## Observations (spotted, deliberately not fixed)

- 2026-08-16 turn: this session had no `backend/.env` (Aiven creds) and no local
  Postgres/Redis, so I installed local postgresql 15 + redis and re-applied
  migrations + `seed:dev` on the local `apihub` DB to run the app (mock upstream
  :3999, backend :3001, frontend :3000 all up). Installed Playwright chromium
  browser + `install-deps` for e2e. A stray empty root `package-lock.json`
  (artifact of a failed root `npm install`) is left untracked in the working tree.
- `frontend/tsconfig.tsbuildinfo` shows as modified in `git status` (build artifact; leave it).
- Old top-of-file "Current turn (in progress)" block for #7 was stale (that item shipped in
  `ac6cd52`) — removed in S0.

## Blocked / needs answer from Ranjith

- **(none blocking)** — decisions Q1–Q6 for the two-subscription-portal plan
  were answered 2026-09-04 (see `## Pending — Two subscription portals`:
  generic standalone catalog; separate portal codebase; mock/manual invoicing;
  reuse existing `users`; Portal B roles ADMIN/MANAGER/SUPPORT/VIEWER on
  existing role infra; first milestone = A1+B1+X1).
- ~~Awaiting GO to start milestone `A1+B1+X1`~~ — GO given 2026-09-05;
  milestone COMPLETE (commits `71b2488` + `26d68f4`, verified this turn — see
  `## Current`). Stack/ports as decided at start: repo's Express 5 + Next 14
  in a new `portal/` folder — backend :3102 (`PORT=3102`), frontend :3002
  (`next dev -p 3002`, rewrites `/api` → `127.0.0.1:3102`). Seed rows shipped
  inside migration `013` (Free/Starter/Pro/Team/Enterprise, INR).
- A2 showcase polish COMPLETE (`0c9cb6d`), Portal B B2–B6 COMPLETE
  (`685eea6`), A4 purchase/checkout COMPLETE (`a1e02d4`) — pushed; see
  `## Current`. Remaining Portal A work = A5 subscriber self-service, then A6
  gateway/webhooks (later).

## Working rules

1. Update `session.md` FIRST — at the start of every turn, before any code change, record the
   plan/pending work so a fresh agent always sees the latest picture.
2. Make the changes.
3. Push code to GitHub every time — commit and `git push origin master`. Do not leave work
   uncommitted/unpushed at the end of a turn.
4. Update `session.md` AFTER the push too — refresh with what was completed, then commit + push
   that update as well. Keep `docs/SESSION.md` in sync when useful.
5. No-delete guardrail: move build caches aside (e.g. `.next.bak-*`) instead of `rm -rf`; never
   delete user data without confirmation.
6. Keep `data-testid` / `aria-label` hooks green so the Playwright e2e suite keeps passing.
7. AI/LLM feature is out of scope (deferred by the user) — do not build or add AI placeholders.

Session protocol: one step per session; post the plan and wait for GO before writing code; stop
after each step. If context budget (~70%) is reached: write a precise resume point here, push, say
"Context budget reached".

## Environment

- Backend: `cd backend && PORT=3001 node src/api/server.js` (port 3001, env below).
- Frontend: `cd frontend && npm run dev` (port 3000, proxies `/api` → 3001).
- Mock upstream: `cd backend && node scripts/mock-upstream.js` (port 3999; in-memory store seeded
  from `scripts/mock-data.json`, mutations reset on restart).
- PostgreSQL 15 (`apihub`), Redis (BullMQ, snapshots disabled). Backend env for dev/tests:
  `AUTH_SECRET=dev-secret VAULT_KEY=test-vault-key-do-not-use-in-prod PGHOST=127.0.0.1 PGPORT=5432
  PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub`.
- **Production DB is Aiven cloud Postgres** — a gitignored `backend/.env` holds
  `DATABASE_URL=postgres://…?...sslmode=require`; CA trust store is `db/ca.pem` (gitignored via
  `*.pem`). `db.js` prefers explicit PG* env vars over `DATABASE_URL`, so tests/psql still hit the
  local DB.
- Seed demo accounts + "Mock API Demo" collection: `cd backend && npm run seed:dev`. Login:
  boss1785867669@test.io/bosspass123 (ADMIN) · pm1785867669@test.io/pmpass1234 (MANAGER) ·
  dev1785867669@test.io/devpass123 (EDITOR).
- **Migrations are not auto-applied** — after `seed:dev`, apply yours manually via psql;
  `db/tests/run.sh` applies all of them. Applied through `016_portal_checkout_rls.sql`
  (Portal A checkout INSERT policies). Next free number: 017.
- **Portal (two subscription portals)**: backend `cd portal/backend && PORT=3102 npm start`
  (port 3102, reuses main backend DB + session scheme via `src/shared.js`); frontend
  `cd portal/frontend && npm run dev` (port 3002, rewrites `/api` → `127.0.0.1:3102`). Portal A
  = public catalog (`/api/public/plans`, no auth); Portal B = management behind RBAC
  (`/api/plans` CRUD, `/api/portal/summary`, `/api/me`). See
  `portal/backend/src/portalAccess.js` for the role matrix.
- **Restart the backend after adding/changing routes** — a stale process serves old handlers.
- **Full e2e run needs a freshly reset + seeded DB and mock upstream on :3999** — other specs
  leave requests in "Mock API Demo", so "Requests: 8" in assertions-runner.spec.ts breaks otherwise.
   - **Never run `next build` while `next dev` is live on the same `.next` dir** (clobbers dev chunks).

## Pending — Send item to another user (accept / reject)

Requested: any user should be able to send a request, sub-folder, folder,
collection, project, or workspace to any other user. The recipient gets
the send as a request they can **accept** or **reject**. On accept, a copy
is created in the recipient's account (they own the copy; the sender keeps
the original).

Not started. Suggested shape when picked up:
- New send/inbox table (pending / accepted / rejected) keyed by sender,
  recipient (`username` lookup), and item type + id.
- Recipient UI: inbox of pending sends with accept/reject.
- Accept clones the subtree into the recipient's default (or chosen)
  workspace/project, using existing duplicate helpers + sibling-unique
  names.
- Reject records the decision and notifies the sender.

## Pending — Two subscription portals (decisions made 2026-09-04)

Feature request from Ranjith: build TWO portals —
**Portal A** = public "website" for subscription showcase + purchase
(pricing/plans page, checkout, subscriber self-service), and
**Portal B** = internal management portal for subscription users/details with
**RBAC**. Recorded as segments so each can be its own micro-task/session.

Decisions (answered by Ranjith 2026-09-04):
- **Q1** Subscriptions are a **generic standalone SaaS catalog** (not API Hub
  seats); initial plans/pricing to be specified by Ranjith before Portal A2.
- **Q2/X1** **Separate portal codebase** (decided) — NOT extending the current
  Next app. New app(s) live outside the API Hub frontend/backend (structure TBD
  at milestone start: shared repo folder `portal/` with its own frontend +
  backend, own port; keep existing API Hub untouched).
- **Q3** **Mock/manual invoicing first** — real gateway + webhooks later.
- **Q4** **Reuse existing `users`** (auto-create on checkout, default role
  EDITOR/VIEWER), same DB cluster/`apihub`.
- **Q5** Portal B roles **ADMIN / MANAGER / SUPPORT / VIEWER** on the existing
  `role` enum infra (`users.role`, memberships, `access.js`); SUPPORT is new —
  added to the enum in migration `013` (not `012` — 012 was already used by
  `012_request_body_parts.sql`).
- **Q6** **First milestone = A1 + B1 + X1 foundation** (see below).

Current: Portal A `A4` COMPLETE (pushed `a1e02d4`; see `## Current` and
docs/SESSION.md §5.39). Foundation `A1+B1+X1` and Portal B `B2–B6` are done
(docs/SESSION.md §5.37). Remaining Portal A work = `A5` subscriber
self-service, then `A6` gateway/webhooks (later). Portal A2 showcase
landing+pricing is live; the catalog's first-recharge bonus (+5/+10/+15) is
now enforced by the A4 checkout/confirm flow.

### First milestone — A1 + B1 + X1 (data model + RBAC + architecture)

Scope when GO is given:
- **X1**: scaffold separate portal codebase (new `portal/` dir: its own
  Express/Next(?) backend + frontend per repo conventions; own port + proxy
  wiring for preview; confirm stack with Ranjith or reuse repo's Express 5 +
  Next 14 stack). — DONE: `portal/backend` (Express 5, :3102) +
  `portal/frontend` (Next 14, :3002, rewrites `/api` → :3102).
- **A1**: `plans`/catalog data model + public read API + admin CRUD — migration
  `012` (next free number) on the same `apihub` DB (plans/subscriptions/orders/
  invoices + SUPPORT role added to enum), reusing `db/migrations` numbering.
  — DONE as migration `013` (012 was taken); public read in
  `portal/backend/src/routes/publicCatalog.js`, admin CRUD in `routes/plans.js`.
- **B1**: Portal B RBAC — role gate middleware (extend pattern from
  `backend/src/api/access.js`), RLS policies for the new tables, endpoint
  matrix (ADMIN full / MANAGER ops / SUPPORT read-mostly / VIEWER read-only).
  — DONE: `portal/backend/src/portalAccess.js` + RLS policies in migration
  `013`.

### Portal A — public subscription showcase + purchase website (customer-facing)

| Seg | Deliverable |
|---|---|
| A1 | Plan/catalog data model + API: `plans` (name, features, price, billing cycle, trial days, active/published) — migration `013` (DONE; 012 was taken by request-body parts), public read endpoints, RBAC-scoped admin CRUD — DONE |
| A2 | Showcase UI: landing + plans/pricing pages rendered from the catalog (public, no login), responsive — DONE (`portal/frontend`, live on :3002) |
| A3 | Subscriber identity — DECIDED: reuse existing `users`, auto-create on checkout (default EDITOR/VIEWER) — DONE (wired into A4 checkout, 2026-09-06) |
| A4 | Purchase/checkout flow: pick plan → billing/contact info → create subscription + order → confirmation page. First recharge must grant the catalog's bonus validity (+5/+10/+15 days on trial_days) — DONE (pushed `a1e02d4`; see docs/SESSION.md §5.39) |
| A5 | Subscriber self-service: "My subscription" area — current plan, status, invoices, change/cancel — PENDING |
| A6 | Payment integration + webhooks + receipts (provider-dependent; see open questions) |

### Portal B — subscription management portal (internal, RBAC)

| Seg | Deliverable |
|---|---|
| B1 | RBAC design: portal roles (proposal: ADMIN / MANAGER / SUPPORT / VIEWER) mapped to existing `role` infra or a new enum; Express guard middleware + RLS policies; who may view/manage/suspend/refund |
| B2 | Dashboard & metrics: KPIs (active subscriptions, MRR, trials, expiring soon, churn), list views with filters |
| B3 | Subscriber/subscription management: search/list/detail of users + their subscriptions + orders; lifecycle actions (activate, suspend, cancel, upgrade/downgrade, refund) |
| B4 | Plan/catalog admin UI: create/edit/publish plans, prices, discounts/promo codes |
| B5 | Audit trail + export: log every admin action (actor, action, target, before/after) with RBAC-scoped report/export |
| B6 | Portal B UI shell + pages wired to B1–B5 |

### Cross-cutting (decide in X1 before coding)

| Seg | Deliverable |
|---|---|
| X1 | Architecture — DECIDED: separate portal codebase (not in the current Next app). Scaffold `portal/` with its own frontend + backend (stack + ports TBD at start of milestone) |
| X2 | Frontend patterns: keep `data-testid`/`aria-label` hooks (e2e green), component/store structure consistent with existing `WorkspaceStore`-style providers |
| X3 | DB: single new migration(s) `012+` covering plans/subscriptions/orders/invoices + RBAC/RLS; record applied migrations in the Environment note — DONE as migration `013` |


## Roadmap

| Step | Deliverable |
|---|---|
| S1 | redactSnapshot() credential-redaction module (pure function + unit tests) |
| S2 | Wire the redactor into share links, run history and every export path |
| S3 | Run-history retention setting + purge job — closes P0 |
| S4 | Personal API tokens for machine auth |
| S5 | POST /api/runs server-side execution endpoint |
| S6 | CLI: skeleton, remote mode, JSON reporter |
| S7 | JUnit XML + HTML reporters, exit codes 0/1/2 |
| S8 | CLI local mode, Docker image, CI recipes — closes P1 |
| S9+ | Data-driven runs, schema/contract assertions, async WAIT_FOR steps (specs to follow) |

## Completed

- **Collection folders feature (pushed as `b61a2c6`)** — Postman-style nested folders on Aiven:
  migration 011 (`folders` + `api_requests.folder_id` + RLS), backend folders CRUD + request-move
  + folder-aware tree, frontend nested sidebar tree + create/rename/delete UI + per-request
  edit/rename/delete, Aiven Postgres wired via gitignored `backend/.env` (`DATABASE_URL` +
  `db/ca.pem`), seeded demo data. New coverage: `backend/tests/folders.integration.test.cjs` +
  `db/tests/04_collection_folders.sql`.
- S2 — redactor wired everywhere (pushed as `90b88a7`): `shares.js` (public share → full response
  snapshot + stored request url/headers/query_params/body_json/body_text through the redactor, not
  the old header-only allowlist), `history.js` (detail snapshots + run-list url redacted),
  `workflows.js` + `automations.js` (run lists), `exports.js` (serialized collection requests).
  `redact.js` gained `redactRequestRecord` / `redactKvArray` / `redactJsonValue`; base64 response
  bodies are skipped. `shares.integration.test.cjs` updated to the `«redacted»` marker; 4 new unit
  tests (api units now 45). Verified live: query `?token=` and `Authorization: Bearer …` both
  redacted in `/api/history/:runId`.
- S1 — credential redactor `backend/src/api/redact.js` (`redactSnapshot()`, pure, never mutates input),
  committed + pushed as `60fe8b6`. Handles url (query string + userinfo), request/response headers,
  and bodies: JSON / form-urlencoded / multipart / XML-SOAP / raw text. Rules in order: exact
  `secretValues`, key-name pattern (`authorization|cookie|set-cookie|token|secret|password|passwd|
  api[-_]?key|client[-_]?secret|assertion|signature|sig`, case-insensitive, any depth), JWT-shape +
  `Bearer`/`Basic`/… auth-scheme heuristics. Marker `«redacted»`, key preserved. Options
  `{ secretValues, extraKeyPatterns, marker }`. 17 node:test tests in
  `backend/src/api/__tests__/redact.test.cjs` (run via `npm run test:api:unit`).
- S0 — restructure session.md + reset roadmap (docs only) — commit `edbe753`
