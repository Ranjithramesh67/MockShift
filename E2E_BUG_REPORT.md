# End-to-End Test Report — MockShift / API Hub

Date: 2026-09-15
Scope: full application (main app frontend + backend API) and the Portal app (Portal A/B).
Method: six independent test agents run in parallel (frontend specs, frontend exploratory,
backend integration suite, live API probing, portal E2E, static logic review).
Mode: report-only — no application code or test code was modified and nothing was committed.

Test stack used: main frontend `:3000`, main backend `:3001`, portal frontend `:3002`,
portal backend `:3102`, mock upstream `:3999`, Postgres dev `:5432` / scratch `:5441`.

Totals: **2 blockers, 6 high, 9 medium, ~10 low**. The backend integration suite itself is
green (247 tests, 243 pass / 4 fail where the 4 are a stale test setup, not app defects).

Detailed per-agent reports:
- `/tmp/opencode/e2e-reports/agent1-api-integration.md`
- `/tmp/opencode/e2e-reports/agent2-frontend-static.md`
- `/tmp/opencode/e2e-reports/agent3-frontend-e2e.md`
- `/tmp/opencode/e2e-reports/agent4-api-functional.md`
- `/tmp/opencode/e2e-reports/agent5-portal-e2e.md`
- `/tmp/opencode/e2e-reports/agent6-logic-review.md`

---

## BLOCKERS

### BLK-1 — Share view page `/s/[token]` crashes (share feature 100% broken)
- Confirmed live with a real browser: opening any share link throws `TypeError: params.then is not a function`.
- File: `frontend/app/s/[token]/page.tsx:168` (and the type at `:158`).
- Cause: `params` is written as a Next 15 Promise (`params.then(...)`), but the app runs
  **Next 14.2.35**, where `params` is a plain object. The effect throws on mount, so neither the
  `.share-card` nor `[data-testid="share-login-required"]` ever renders.
- Impact: the entire login-gated share view (recently built) is unusable, and `e2e/share-links.spec.ts` fails.
- Fix direction: read `params.token` synchronously (Next 14 style), or gate on `use(params)` only after a Next 15 upgrade.

### BLK-2 — `POST /api/requests/:id/run` has no per-project authorization (cross-tenant secret disclosure)
- File: `backend/src/api/routes/content.js:898-917` (`runRequest` at `backend/src/api/runner.js:377-409`).
- Cause: the route resolves the owning project only for billing and never calls
  `canReadProjectContent` (every sibling route does: GET `:614`, PUT `:662`, DELETE `:792`,
  duplicate `:817`).
- Impact: any authenticated user who knows a request UUID can run another tenant's stored request and
  receives the resolved environment variables (secrets), the resolved auth token, and the full
  substituted request snapshot in the response.
- Fix direction: require `canReadProjectContent(req.user.id, projectId)` (403) before `chargeRuns`/`runRequest`.

---

## HIGH

### HIGH-1 — API token scopes are not enforced outside `sdk.js` / `serverRuns.js`
- Files: `backend/src/api/tokenAuth.js`, `backend/src/api/access.js#requireAuth`; scope checks only at
  `backend/src/api/routes/serverRuns.js:131` and `backend/src/api/routes/sdk.js:213`.
- Impact: a token minted with `scopes:["read"]` can create, modify, delete and run content
  (e.g. `DELETE /api/collections/:id` → 200, `POST /api/collections` → 201, `POST /api/requests/:id/run`).
- Fix direction: enforce the token's scopes centrally for all mutating/run routes.

### HIGH-2 — API token project/workspace binding is not enforced
- Files: same as HIGH-1; `projectId`/workspace binding is stored but never consulted.
- Impact: a project- or workspace-bound token works against any resource in the same org (same-org escape).
- Fix direction: validate the token's binding against the target resource's project/workspace.

### HIGH-3 — Accepting a send bypasses plan count gates
- File: `backend/src/api/routes/sends.js:936-1000` (cloners `sends.js:550-724`).
- Cause: the accept branch deep-clones workspaces/projects/collections (and can even create an org)
  with no `checkCountGate` and no entitlements import; create paths like `content.js:821` and
  `workspaces.js:77` do gate.
- Impact: a recipient on a restricted/free plan can exceed `workspaces`/`projects`/`collections` limits by accepting sends.
- Fix direction: run the same `checkCountGate` calls as the create routes before cloning; return `403 plan_limit`.

### HIGH-4 — Portal checkout `confirm` is not race-safe (duplicate ACTIVE subscriptions)
- File: `portal/backend/src/routes/publicCheckout.js:397-484`; compare the correct path
  `portal/backend/src/paymentFinalize.js:101-178`.
- Cause: the "idempotent" confirm route never locks the order row `FOR UPDATE` and never re-checks
  status inside the transaction (the PENDING check is a pre-transaction read).
- Impact: two concurrent confirms (double-click / two tabs) create two ACTIVE subscriptions and violate
  the "one current subscription" invariant.
- Fix direction: mirror `finalizePaidOrder` — lock the order row and re-check status inside the transaction.

### HIGH-5 — Creating a share link double-POSTs and surfaces a raw DB error
- Files: `backend/src/api/routes/shares.js:120-135` (non-atomic SELECT+INSERT), `frontend/src/components/ShareLinksModal.tsx`.
- Cause: React StrictMode runs the modal effect twice; the second `POST /api/shares` hits
  `duplicate key value violates unique constraint "item_shares_item_type_item_id_key"`, and the UI
  displays that raw error instead of the share URL.
- Impact: users click Share and see a database error rather than a link (deterministic in dev).
- Fix direction: make the insert an upsert (`INSERT ... ON CONFLICT (item_type, item_id) DO UPDATE ... RETURNING`),
  guard the effect, and never surface raw DB errors.

### HIGH-6 — Sidebar renders a workspace chip once per team membership
- File: `frontend/src/components/Sidebar.tsx:176-197`.
- Cause: loops over `ws.groups.groups` and renders `chips` per group with no cross-group de-duplication,
  producing N identical `data-testid="workspace-<name>"` nodes.
- Impact: visible duplicate chips; strict-mode violation breaks 13 existing e2e specs.
- Note: the test data was amplified by several teams ("Check", "E2E Team", "Test") all containing the
  same workspace; confirm whether multi-team grouping is intended before choosing dedup vs team-scoped testids.

---

## MEDIUM

### MED-1 — IDOR: `GET /api/collections/:collectionId/auth-provider` has no access check
- `backend/src/api/routes/content.js:1031` (the sibling PUT `:1044` / POST `:1091` are guarded).
- Impact: any logged-in user reads another tenant's auth-provider config (`tokenRequestId`, `headerKey`, ...) → 200.

### MED-2 — IDOR: `GET /api/workspaces/:workspaceId/teams` leaks teams to non-members
- Backend workspaces route (reproduced as R5/I2 in the API agent's artifacts).
- Impact: a non-member gets 200 with the workspace's team names/share ids; sibling `/content`, `/settings`, `/variables` correctly 403.

### MED-3 — Invalid input returns 500 and leaks raw Postgres errors (validation cluster)
- Negative `limit` → 500: `GET /api/history?limit=-1`, `GET /api/notifications?limit=-1`, `GET /api/automations/:id/runs?limit=-1`.
- Invalid cron → 500: `POST /api/automations`.
- Non-UUID path/body → 500 with `invalid input syntax for type uuid`: `POST /api/monitors` (projectId),
  `POST /api/sends/:uuid/accept`, `GET /api/workspaces/:id/content`, `PATCH /api/environments/:id/variables`.
- Portal: `GET/DELETE /api/plans/:id`, `GET/PUT /api/promo-codes/:id` with a non-UUID → 500
  (`portal/backend/src/routes/plans.js:121,226`, `promoCodes.js:191,252`); the generic handler
  `portal/backend/src/server.js:70-77` returns `err.message` verbatim.
- Expected: 400/404 with a generic message; never leak DB internals or return 500 for client errors.

### MED-4 — Reject-send has no concurrency guard
- `backend/src/api/routes/sends.js:1035-1038` (accept is guarded `:980-989`).
- Impact: a concurrent accept + reject can leave the send marked `rejected` while the cloned item tree exists.

### MED-5 — Review decision race (double decide)
- `backend/src/api/routes/reviews.js:232-249` — pre-check is not backed by `AND status='pending'` on the UPDATE.
- Impact: two concurrent decisions both apply; the losing decision still fires notifications/audit.

### MED-6 — Public-workspace visibility not honored at project level (needs verification)
- `backend/src/api/access.js:198-232` (`canReadProject`) vs `:120-139` (`canReadWorkspace` PUBLIC branch).
- Impact: a PUBLIC workspace is readable but its projects are denied by project-level helpers
  (events room auth, search) → inconsistent access surface. May be intended; reconcile/document.

### MED-7 — First-recharge bonus computed outside the lock
- `portal/backend/src/routes/publicCheckout.js:434-435`, `portal/backend/src/paymentFinalize.js:92-94`.
- Impact: two different PENDING orders finalized concurrently both see "no prior paid order" and both grant trial bonus days.

### MED-8 — Refund does not cancel the subscription (needs verification)
- `portal/backend/src/routes/subscribers.js:571-607` sets the order REFUNDED / voids the invoice but
  never cancels the created subscription (and the status pre-check has no `FOR UPDATE`).
- Impact: customer keeps paid entitlements after refund; concurrent refunds both write audits.

### MED-9 — Portal B non-member login message is wiped before it can be read
- `portal/frontend/app/manage/login/page.tsx` sets the error then calls `apiLogout()`, which does a full
  `window.location.assign('/manage/login')` (`portal/frontend/src/lib/portalApi.ts:67`).
- Impact: a valid non-portal account is bounced to a blank login form with no explanation.

---

## LOW / HARDENING

- LOW-1 Blank request name accepted (`POST /api/requests` empty/whitespace name → 201) — `backend/src/api/routes/content.js:27`.
- LOW-2 `PATCH /api/environments/:id` always returns hardcoded `variable_count: 0`.
- LOW-3 Case-variant email creates a duplicate account (`User@x.io` vs `user@x.io`); email UNIQUE is case-sensitive.
- LOW-4 Session cookie is missing the `Secure` flag (fine for local, hardening for HTTPS).
- LOW-5 Workflow until-loop self-reference validation tests `step.id` but conditions reference the sanitized label
  (`frontend/src/lib/workflowValidation.js:127`); an unterminating loop passes client validation (bounded by `MAX_LOOP_ITERATIONS`).
- LOW-6 SSE room authorization is frozen for the life of a connection (documented v1 limitation).
- LOW-7 `syncAllSchedules` never removes stale cron schedulers for disabled/deleted automations (`backend/src/api/workflowService.js:377-393`).
- LOW-8 Public doc-share lookup does not assert `kind='public'` (`backend/src/api/routes/docs.js:1512-1529`) — safe today, implicit invariant.
- LOW-9 Dead code: unused `token` state in `frontend/app/s/doc/[token]/page.tsx:9`; ~18 unused declarations under opt-in unused checks.

---

## TEST / ENVIRONMENT ISSUES (not app defects)

- `backend/tests/environments.integration.test.cjs` omits `UPDATE portal_settings SET restrictions_enforced = false;`
  in its `before()` (the shared harness does it at `tests/support/harness.cjs:39`), so 4 tests fail on
  plan limits. Fix the test setup, not the app.
- 6 e2e workflow specs still click the removed `main-tab-workflow`; navigation moved to `rail-workflow`.
- `e2e/send-working-copy.spec.ts` expects mock `POST /posts/2` but the mock upstream serves only `/posts/1` (404).
- `e2e/history.spec.ts` assumes an empty history, but a recurring "List payments" run (every 5 min) is recorded.
- `e2e/helpers.ts#signupFreshUser` needs `ALLOW_SELF_SIGNUP=1`; self-service signup is closed by default (403).
- Running `next build` while `next dev` shares the same `.next` directory corrupts the dev server
  (`Cannot find module './682.js'`, all routes 500). Run builds in an isolated copy, or clear/restart.
- Pre-existing frontend static gates pass: `npm test` 132/132, `tsc --noEmit` clean, isolated `next build` 23/23 routes.
