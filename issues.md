# Issues — Mockshift

Tracking register for defects found by the full E2E pass on 2026-09-15.
Source report: `E2E_BUG_REPORT.md`. Raw evidence: `/tmp/opencode/e2e-reports/`.

Status legend: `OPEN` · `IN PROGRESS` · `FIXED` · `VERIFIED` · `WON'T FIX` · `NEEDS VERIFICATION`

Convention: one commit per fix, Conventional Commits, with the issue id in the subject
(e.g. `fix(shares): ... (BLK-1)`). Update this file's Status/Commit columns in the same commit.

---

## Summary

| ID | Severity | Title | Status | Commit |
|----|----------|-------|--------|--------|
| BLK-1 | Blocker | `/s/[token]` share page crashes (`params.then is not a function`) | FIXED | eaeb870 |
| BLK-2 | Blocker | `POST /api/requests/:id/run` missing per-project authz (cross-tenant secret disclosure) | FIXED | 4cb9d9e |
| HIGH-1 | High | API token scopes not enforced outside sdk/serverRuns | FIXED | 83bbed0 |
| HIGH-2 | High | API token project/workspace binding not enforced | FIXED | b0428fe |
| HIGH-3 | High | Accepting a send bypasses plan count gates | FIXED | 4f7bc99 |
| HIGH-4 | High | Portal checkout `confirm` not race-safe (duplicate subscriptions) | FIXED | 96a2b4a |
| HIGH-5 | High | Share create double-POST → raw DB 500 instead of link | FIXED | 3c1a1f2 |
| HIGH-6 | High | Sidebar renders a workspace chip once per team membership | FIXED | cd50776 |
| HIGH-7 | High | `ALLOW_SELF_SIGNUP=1` opens direct signup in production, skipping plan selection | FIXED | ea0d6c6 |
| HIGH-8 | High | API, portal API, frontends and mock upstream listen on all interfaces, reachable over plaintext HTTP | FIXED | 4d46fc3 |
| HIGH-9 | High | Verification email never arrives: resend reports success while the mailer silently skips, and Portal A checkout never sends one | FIXED | 9797a56, 7522d9d |
| MED-1 | Medium | IDOR: `GET /api/collections/:id/auth-provider` has no access check | FIXED | df5e9a9 |
| MED-2 | Medium | IDOR: `GET /api/workspaces/:id/teams` leaks teams to non-members | FIXED | 4d56205 |
| MED-3 | Medium | Invalid input returns 500 and leaks raw Postgres errors | FIXED | d7356a2 |
| MED-4 | Medium | Reject-send has no concurrency guard | FIXED | 7ab38db |
| MED-5 | Medium | Review decision race (double decide) | FIXED | f7c52ea |
| MED-6 | Medium | Public-workspace visibility not honored at project level | WONTFIX (intended) | f40c53c |
| MED-7 | Medium | First-recharge bonus computed outside the lock | FIXED | 238b12f |
| MED-8 | Medium | Refund does not cancel the subscription | FIXED | 88d3ab6 |
| MED-9 | Medium | Portal B non-member login message is wiped | FIXED | f88e2d8 |
| LOW-1 | Low | Blank request name accepted | FIXED | e854183 |
| LOW-2 | Low | `PATCH /api/environments/:id` hardcodes `variable_count: 0` | FIXED | 8fda3b9 |
| LOW-3 | Low | Case-variant email creates a duplicate account | FIXED | b37db31 |
| LOW-4 | Low | Session cookie missing `Secure` flag | FIXED | 3353b2c |
| LOW-5 | Low | Workflow until-loop self-reference validation tests wrong key | FIXED | 329dbee |
| LOW-6 | Low | SSE room authorization frozen for connection lifetime | FIXED | aff4d9a |
| LOW-7 | Low | `syncAllSchedules` never removes stale cron schedulers | FIXED | 2609243 |
| LOW-8 | Low | Public doc-share lookup does not assert `kind='public'` | FIXED | 6b83c6a |
| LOW-9 | Low | Dead code (unused declarations) | FIXED | f3751cf |
| TEST-1 | Test | `environments.integration.test.cjs` missing `restrictions_enforced=false` | FIXED | b632b68 |
| TEST-2 | Test | 6 workflow e2e specs use removed `main-tab-workflow` | FIXED | 1c3d814 |
| TEST-3 | Test | `send-working-copy.spec` expects mock `/posts/2` (404) | FIXED | 5abeae1 |
| TEST-4 | Test | `history.spec` assumes empty history | FIXED | 9f88891 |

---

## Live production pass — 2026-10-10

Second full pass, run live against production with a real Chromium (the earlier
2026-09-15 pass was report-only against dev). New findings and fixes:

| ID | Severity | Title | Status | Commit |
|----|----------|-------|--------|--------|
| B1 | High | "Run in browser" aborted at 15s while Chrome's local-network prompt was pending | VERIFIED | 57b9575 |
| B2 | High | `POST /api/auth/login` (and change-password) 500 on non-string password | VERIFIED | 1a47814 |
| B3 | Medium | Vault decrypt threw `Wrong key or corrupt data`; one bad secret could 500 a request | VERIFIED | 6e2fcfe |
| B4 | Low | Monitor scheduler flooded logs on repeated DB outages | FIXED | 6e2fcfe |
| B5 | Low | Next "Failed to find Server Action" surfaced after redeploy | WON'T FIX (redeploy-transient) | — |
| B6 | Test | No committed, reusable live E2E suite | FIXED | see below |

Live E2E result after the fixes: **56/56 checks pass** across login, routes,
admin, functional, browser-run, api-validation and mobile suites (production).
Backend unit tests 137/137, vault integration 3/3.

---

## Details

### B1 — Browser-run aborted during the LNA permission prompt
- File: `frontend/src/lib/browserRunner.ts`.
- Cause: a 15s `AbortController` fired while Chrome's "Local Network Access" prompt (Chrome 142+, public site → loopback) was still waiting for a user decision, so runs against `localhost` failed with a bare `Request timed out after 15000ms (browser)`.
- Fix: raise `BROWSER_TIMEOUT_MS` to 120000; an abort while the permission is pending/denied now returns an actionable `LOCAL_ACCESS_HELP` message; `describeBrowserError` is async and permission-aware.
- Verified: headed run against a fake `:8082` service waits the full window, then shows the LNA guidance (not a bare timeout); rebuilt bundle contains the new string.
- Status: VERIFIED (57b9575)

### B2 — Login returns 500 for a non-string password
- File: `backend/src/api/authLib.js` (also reachable via change-password).
- Cause: `verifyPassword(undefined, ...)` threw `ERR_INVALID_ARG_TYPE` in `scrypt`, returning 500 for `{email}` / `{password:null}` / `{password:123}`.
- Fix: `verifyPassword` returns false for non-strings; `hashPassword` coerces `String()`. Malformed credentials now 401; valid login still 200.
- Test: `backend/src/api/__tests__/authLib.test.cjs` (+1 test).
- Status: VERIFIED (1a47814)

### B3 — Vault decrypt threw on corrupt data / missing key
- Files: `db/migrations/062_safe_decrypt.sql`, `backend/src/api/db.js`, `backend/src/api/routes/environments.js`.
- Cause: `error: Wrong key or corrupt data` spam; a single undecryptable secret (or a process without `VAULT_KEY`) could fail the whole variable-resolution path.
- Fix: `app.try_decrypt(bytea,text)` returns NULL instead of raising; `app.resolve_variables` and environments route use it; `db.js` no longer falls back to a dev key in production (fail-closed). Migration applied to prod.
- Test: `backend/tests/variableDecryptResilience.integration.test.cjs` (3 tests).
- Status: VERIFIED (6e2fcfe)

### B4 — Monitor scheduler log flood on DB outage
- File: `backend/src/api/monitorRunner.js`.
- Fix: throttle repeated DB-outage errors (first, then at most once per 5 minutes).
- Status: FIXED (6e2fcfe)

### B5 — "Failed to find Server Action"
- Assessment: the app has zero `use server` directives (no Server Actions). The error was transient from a redeploy while old bundle clients were still open and clears on reload.
- Status: WON'T FIX (no code change warranted)

### B6 — Reusable committed live E2E suite
- Added `e2e-live/`: env-configurable Playwright + HTTP suites (login, routes, admin, functional, browser-run, api-validation, mobile) with a `run-all.cjs` runner that writes JSON/Markdown reports to `e2e-live/artifacts/`. Credentials live in a gitignored `.env.local`; see `e2e-live/README.md`.
- Status: FIXED

### BLK-1 — Share view page crashes
- File: `frontend/app/s/[token]/page.tsx:158,168`
- Cause: `params` typed/used as a Promise (`params.then(...)`), but Next 14.2.35 passes a plain object.
- Impact: every `/s/<token>` load throws `TypeError: params.then is not a function`; no share card renders.
- Fix: read `params.token` synchronously.
- Status: FIXED

### BLK-2 — Request run missing per-project authorization
- File: `backend/src/api/routes/content.js:898-917` (runner `backend/src/api/runner.js:377-409`)
- Cause: run route resolves the project only for billing; never calls `canReadProjectContent`.
- Impact: cross-tenant run + disclosure of resolved secrets/auth token/request snapshot.
- Fix: require `canReadProjectContent(req.user.id, projectId)` before `chargeRuns`/`runRequest`.
- Status: FIXED

### HIGH-1 — API token scopes unenforced
- Files: `backend/src/api/tokenAuth.js`, `backend/src/api/access.js`; checks only in `routes/serverRuns.js:131`, `routes/sdk.js:213`.
- Impact: `read`-scope token can create/modify/delete/run.
- Fix: enforce token scopes centrally for mutating/run routes.
- Status: FIXED

### HIGH-2 — API token binding unenforced
- Files: same as HIGH-1.
- Impact: project/workspace-bound token works against any resource in the same org.
- Fix: validate the token binding against the target resource's project/workspace.
- Status: FIXED

### HIGH-3 — Accept-send bypasses plan gates
- File: `backend/src/api/routes/sends.js:936-1000` (cloners `:550-724`).
- Impact: accepting a send creates workspaces/projects/collections over plan limits.
- Fix: run `checkCountGate` (workspaces/projects/collections) before cloning; return `403 plan_limit`.
- Test: `backend/tests/acceptPlanLimits.integration.test.cjs`.
- Status: FIXED

### HIGH-4 — Portal checkout confirm race
- File: `portal/backend/src/routes/publicCheckout.js:397-484` (contrast `paymentFinalize.js:101-178`).
- Impact: concurrent confirms create duplicate ACTIVE subscriptions.
- Fix: lock the order row `FOR UPDATE` and re-check status in-transaction.
- Test: `backend/tests/portalCheckoutConfirm.integration.test.cjs`.
- Status: FIXED

### HIGH-5 — Share create double-POST → raw DB 500
- Files: `backend/src/api/routes/shares.js:120-135`, `frontend/src/components/ShareLinksModal.tsx`.
- Impact: StrictMode double effect → duplicate-key 500 surfaced in the UI; no link.
- Fix: upsert `ON CONFLICT (item_type,item_id) DO NOTHING` + re-read the winner; de-dupe the modal's in-flight create per item; never show raw DB errors.
- Test: `backend/tests/sharesCreate.integration.test.cjs`.
- Status: FIXED

### HIGH-6 — Workspace chip duplicated per team
- File: `frontend/src/components/Sidebar.tsx:176-197`.
- Impact: duplicate `workspace-<name>` testids; broke 13 e2e specs.
- Fix: skip already-rendered workspaces while walking team groups (the existing `accounted` set is now applied per group too), so each workspace renders once.
- Test: `frontend/e2e/workspace-chip-dedupe.spec.ts`.
- Status: FIXED

### HIGH-7 — Signup bypasses plan selection in production
- File: `backend/src/api/routes/auth.js:25-38` (`selfServiceOpen`).
- Impact: the deploy's `ALLOW_SELF_SIGNUP=1` opt-in (meant for automated test/dev runs) was honored even with `NODE_ENV=production`, so `/signup` offered a direct Create-account form. That created a user with no plan chosen and none attached, bypassing the Portal A plans/checkout gateway that provisions the org and workspace.
- Fix: honor `ALLOW_SELF_SIGNUP` only when `NODE_ENV !== 'production'`, so the direct path can never open on a real deployment.
- Test: `backend/tests/signupGate.integration.test.cjs`.
- Verified: live `GET /api/auth/signup-status` → `{open:false}`, `POST /api/auth/signup` → 403, `/signup` renders the plans gateway and link to Portal A; Portal A checkout returns 404 without a plan and 201 with one.
- Status: FIXED (ea0d6c6)

### HIGH-8 — Services bound to all interfaces (plaintext bypass of TLS)
- Files: `backend/src/api/server.js:180`, `portal/backend/src/server.js:100`, `backend/scripts/mock-upstream.js:160`.
- Impact: `app.listen(port)` with no host bound the API, portal API, both Next frontends and the mock upstream to every interface. With ports 3000-3004 open, `POST http://<ip>:3001/api/auth/login` (or via the frontend rewrites) transmitted credentials as cleartext and bypassed Apache/TLS. The startup log also falsely reported `127.0.0.1`.
- Fix: read an optional `HOST` env var and pass it to `app.listen`/`server.listen`; the mock upstream defaults to `127.0.0.1`. Deploy sets `HOST=127.0.0.1` and starts both Next servers with `-H 127.0.0.1`.
- Verified on the box: all five sockets listen on `127.0.0.1` only; ports 3000/3001/3002/3102/3999 are unreachable from the internet; the three HTTPS domains still return 200 and login + `POST /api/requests/:id/run` (SUCCESS/200) work through the proxy.
- Status: FIXED (4d46fc3)

### HIGH-9 — Verification email never arrives (silent skip)
- Files: `backend/src/api/email.js`, `backend/src/api/routes/auth.js:181`, `portal/backend/src/routes/publicCheckout.js:383`, `frontend/src/components/AppShell.tsx:188`.
- Impact: two independent causes.
  1. The deploy had no `SMTP_*` set, so `sendMail` logged `SMTP not configured; skipped` and returned `{skipped:true}`. `/api/auth/resend-verification` still answered `{ok:true}` and the banner swallowed errors, so "Resend email" looked like a success while nothing was sent.
  2. Portal A checkout — the only account-creation path in production — provisioned the buyer's org/workspace but never issued a verification token, so a real customer could never receive the link at all.
- Fix: `email.isConfigured()`; `/resend-verification` returns `503 smtp_not_configured` (or `502 smtp_send_failed`) and refuses *before* invalidating the outstanding token; signup/checkout report `emailVerification: sent|not_configured|failed`; the banner shows a success/error toast; a shared `emailVerification.js` mints the token so the main app and portal cannot drift; checkout now mails the buyer; `scripts/send-test-email.js` verifies SMTP without starting the app.
- Test: `backend/src/api/__tests__/email.test.cjs`, `backend/tests/authEmail.integration.test.cjs`, `backend/tests/portalCheckoutEmail.integration.test.cjs`.
- Verified: against a local SMTP sink, signup delivered a real message whose link redeemed with `verify-email` 200 and `users.email_verified=true`.
- Status: FIXED (9797a56, 7522d9d)

### MED-1 — IDOR collection auth-provider
- File: `backend/src/api/routes/content.js:1031`.
- Fix: add the same collection read check used by PUT `:1044`.
- Test: `backend/tests/collectionAuthProviderAccess.integration.test.cjs`.
- Status: FIXED

### MED-2 — IDOR workspace teams
- File: backend workspaces route (`GET /:id/teams`).
- Fix: require workspace membership.
- Test: `backend/tests/workspaceTeamsAccess.integration.test.cjs`.
- Status: FIXED

### MED-3 — 500 + raw DB errors on invalid input
- Files: `backend/src/api/routes/history.js`, `notifications`, `automations.js`, `monitors.js`, `sends.js`, `content.js:205`/`access.js:87`, `environments.js:152`; `portal/backend/src/routes/plans.js:121,226`, `promoCodes.js:191,252`, `portal/backend/src/server.js:70-77`.
- Fix: validate `limit`/uuid/cron; return 400/404; generic error messages (no `err.message` leakage).
- Implemented: clamped `limit` in `history.js`, `notifications.js`, `automations.js` (runs); `isValidCron` gate on automation create/update; central handler in `backend/src/api/server.js` and `portal/backend/src/server.js` maps Postgres invalid-input codes (`22P02` etc.) to a generic 400 and returns a generic 500 otherwise. Route-level 4xx messages are preserved.
- Test: `backend/tests/inputValidation.integration.test.cjs` (4 tests, pass).
- Status: FIXED (d7356a2)

### MED-4 — Reject-send race
- File: `backend/src/api/routes/sends.js:1035-1038`.
- Fix: `AND status='pending'` + `rowCount` check → 409.
- Implemented: reject UPDATE now `WHERE id = $1 AND status = 'pending'`; `rowCount !== 1` returns 409, mirroring the accept path.
- Test: `backend/tests/rejectSendRace.integration.test.cjs` (pins the send row `FOR UPDATE` to force the interleave; fails pre-fix, passes post-fix).
- Status: FIXED (7ab38db)

### MED-5 — Review decision race
- File: `backend/src/api/routes/reviews.js:232-249`.
- Fix: guard UPDATE with `AND status='pending'`; check `rowCount`.
- Implemented: decision UPDATE now `WHERE id = $4 AND status = 'pending'`; `rowCount !== 1` returns 409 so the losing decision cannot overwrite the winner or emit duplicate notifications/audit.
- Test: `backend/tests/reviewDecisionRace.integration.test.cjs` (FOR UPDATE pin; fails pre-fix, passes post-fix). `collab.integration.test.cjs` still green.
- Status: FIXED (f7c52ea)

### MED-6 — Public workspace vs project visibility
- File: `backend/src/api/access.js:198-232` vs `:120-139`.
- Decision: PUBLIC workspace visibility is intentionally workspace-scoped (product decision, 2026-09-15). Org members may discover/read the workspace and its workspace-scoped resources (environments, tree), but each project keeps its own access gate; project contents (collections/requests), workflows, mock servers, events and project search hits remain non-member-inaccessible.
- Test: `backend/tests/publicWorkspaceAccess.integration.test.cjs` pins the contract (PUBLIC workspace visible; projects `can_access:false`; no collection leak; `GET /workflows?projectId` → 403).
- Status: WONTFIX / intended (f40c53c)

### MED-7 — First-recharge bonus race
- Files: `portal/backend/src/routes/publicCheckout.js:434-435`, `portal/backend/src/paymentFinalize.js:92-94`.
- Fix: compute first-paid/bonus inside the transaction under an advisory lock.
- Implemented: new `firstRechargeBonusTx(client, userId, trialDays)` takes a per-user `pg_advisory_xact_lock` and re-checks prior PAID orders inside the tx. Used by the A4 confirm route and by `finalizePaidOrder` (gateway pay + webhook). The informational previews at checkout / `GET /orders/:id` remain read-only.
- Test: `backend/tests/firstRechargeBonus.integration.test.cjs` (two concurrent first recharges award the bonus once; fails pre-fix with both 14 days). `portalCheckoutConfirm.integration.test.cjs` still green.
- Status: FIXED (238b12f)

### MED-8 — Refund does not cancel subscription
- File: `portal/backend/src/routes/subscribers.js:571-607`.
- Decision: refunding an order must revoke the entitlements it granted (product decision, 2026-09-15).
- Implemented: `POST /subscribers/orders/:id/refund` now locks the order row `FOR UPDATE`, marks it REFUNDED, voids the invoice, and sets the linked subscription to CANCELLED inside the same transaction; concurrent refunds settle once (one 200, one 409, one audit row). The audit `after` carries `cancelled_subscription_id`.
- Test: `backend/tests/portalRefund.integration.test.cjs` (cancellation + concurrent race; both fail pre-fix).
- Status: FIXED (88d3ab6)

### MED-9 — Portal B non-member login message wiped
- Files: `portal/frontend/app/manage/login/page.tsx`, `portal/frontend/src/lib/portalApi.ts:67`.
- Fix: surface the message after redirect (query param / not a full reload).
- Implemented: `apiLogout(redirect = '/manage/login')` now accepts `null` to clear the session without navigating; the login page calls `apiLogout(null)` before setting the error so the alert stays visible. Default redirect (ManageShell) unchanged.
- Test: Playwright against the running portal FE — post-fix alert visible at `/manage/login`; pre-fix times out because the navigation wiped it. No portal e2e harness exists to add a permanent spec.
- Status: FIXED (f88e2d8)

### LOW-1 — Blank request name
- File: `backend/src/api/routes/content.js:27`. Fix: reject blank → 400.
- Implemented: trimmed-name validation on POST /requests, PUT /requests/:id (rename), POST /collections and POST /folders; blank/whitespace-only now returns 400 instead of persisting `''`.
- Test: `backend/tests/blankName.integration.test.cjs`.
- Status: FIXED (e854183)

### LOW-2 — Env PATCH `variable_count: 0`
- File: environments route PATCH response. Fix: return the real count.
- Implemented: PATCH now re-selects the row with the list route's `variable_count` count subquery instead of hardcoding 0.
- Test: `backend/tests/envVariableCount.integration.test.cjs`.
- Status: FIXED (8fda3b9)

### LOW-3 — Case-variant email duplicate account
- Fix: case-insensitive unique index on `users.email` (migration) + normalize on signup/login.
- Implemented: normalize to lower-case in signup/login/forgot-password, admin create-user and portal checkout; lookups use `lower(email)`. Migration `048_ci_email.sql` lowercases stored rows and adds a unique index on `lower(email)` (guarded if duplicates already exist).
- Test: `backend/tests/caseInsensitiveEmail.integration.test.cjs`.
- Status: FIXED (b37db31)

### LOW-4 — Cookie missing `Secure`
- Fix: set `Secure` when serving over HTTPS/production.
- Implemented: `sessionCookie`/`clearSessionCookie` append `Secure` when `NODE_ENV=production` or `COOKIE_SECURE=1` / `FORCE_SECURE_COOKIES=1`; plain-HTTP local/test runs keep it off so the cookie is still sent.
- Test: `backend/src/api/__tests__/authLib.test.cjs`.
- Status: FIXED (3353b2c)

### LOW-5 — Workflow until-loop self-reference validation
- File: `frontend/src/lib/workflowValidation.js:127`. Fix: compare against both `step.id` and `sanitizeLabel(step.label || step.id)`.
- Implemented: the until-loop guard now matches condition references against `step.id` or the step's sanitized label, so a self-reference via `$steps['poll_status']` is rejected even when the id differs from the label.
- Test: `frontend/src/lib/__tests__/workflowValidation.test.cjs`.
- Status: FIXED (329dbee)

### LOW-6 — SSE auth frozen for connection lifetime
- File: `backend/src/api/routes/events.js:14-17,34-70`. Fix: periodic re-check.
- Implemented: the stream re-runs `authorizeRoom` on an interval (`REALTIME_AUTH_RECHECK_MS`, default 30s); a failed re-check sends an `error` frame with `{type:'unauthorized'}` and closes the stream. Transient DB errors are logged and retried.
- Test: `backend/tests/eventsAuthRecheck.integration.test.cjs` (revokes access mid-stream and asserts the frame + close).
- Status: FIXED (aff4d9a)

### LOW-7 — Stale cron schedulers
- File: `backend/src/api/workflowService.js:377-393`. Fix: remove schedulers not in the enabled set on sync.
- Implemented: `syncAllSchedules` now reconciles -- removes `automation:*` BullMQ schedulers absent from (or disabled in) the DB, then upserts the live set; unrelated schedulers are untouched. Added `listScheduleKeys()` export.
- Test: `backend/tests/scheduleSync.integration.test.cjs`.
- Status: FIXED (2609243)

### LOW-8 — Doc-share `kind` not asserted
- File: `backend/src/api/routes/docs.js:1512-1529`. Fix: filter `kind='public'`.
- Implemented: the anonymous token lookup now requires `s.kind = 'public'`. Defense-in-depth: migration 028's `doc_shares_token_kind_check` already makes a token non-null iff the share is public, so no externally reachable behaviour changed.
- Regression: `backend/tests/docsShares.integration.test.cjs`.
- Status: FIXED (6b83c6a)

### LOW-9 — Dead code
- File: `frontend/app/s/doc/[token]/page.tsx:9` (unused `token`), plus ~18 unused declarations.
- Implemented: removed all 18 declarations flagged by `tsc --noUnusedLocals --noUnusedParameters` (unused icons/React imports, doc-share `token` state, Sidebar `authCollectionId` state, unused params/helpers/type imports).
- Verified: `npx tsc --noEmit` clean; 133 frontend unit tests pass.
- Status: FIXED (f3751cf)

### TEST-1 — environments integration setup
- File: `backend/tests/environments.integration.test.cjs` `before()` — add `UPDATE portal_settings SET restrictions_enforced = false;`.
- Implemented: setup now disables plan restrictions after running migrations, matching `tests/support/harness.cjs`.
- Verified: 4 tests pass.
- Status: FIXED (b632b68)

### TEST-2 — Workflow e2e selectors
- Files: `frontend/e2e/workflow-infinite-loop.spec.ts`, `frontend/e2e/workflow-pass-inputs.spec.ts` — `main-tab-workflow` → `rail-workflow`.
- Implemented: updated all 5 call sites to the current `rail-workflow` testid (confirmed present in `Sidebar.tsx`); no `main-tab-workflow` references remain. Runtime verification needs a backend with `ALLOW_SELF_SIGNUP=1`.
- Status: FIXED (1c3d814)

### TEST-3 — `send-working-copy` mock data
- File: `frontend/e2e/send-working-copy.spec.ts` / `backend/scripts/mock-data.json` — serve `/posts/2` or target `/posts/1`.
- Implemented: the spec now creates two dedicated mock records via `POST :3999/posts` and uses their ids for the clean/dirty runs, so it no longer depends on mutable seed data (the shared store is patched/deleted by manual testing).
- Verified: `npx tsc --noEmit` clean; runtime run needs `ALLOW_SELF_SIGNUP=1`.
- Status: FIXED (5abeae1)

### TEST-4 — `history` isolation assumption
- File: `frontend/e2e/history.spec.ts` — account for background recurring runs.
- Implemented: the cross-user test no longer expects `history-empty`; it asserts the privacy rule directly -- the dev user's history list never contains the boss's `history-e2e-request` run (works whether or not the dev has their own background runs).
- Verified: `npx tsc --noEmit` clean.
- Status: FIXED (9f88891)

---

## Repo audit pass — 2026-10-11

Static/code-review audit of the security- and correctness-sensitive paths (auth,
multi-tenant access, money, RLS, web state). No live stack was available (no
Postgres/Redis/Docker), so findings are backed by code reading plus the
dependency-free unit suites (`node --test`): backend 146/146, frontend 193/193.

### Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| AUTH-1 | High | API-token project/workspace binding not enforced on `POST /api/runs` | FIXED |
| AUTH-2 | High | `POST /api/mock-servers/:id/routes` accepted read access | FIXED |
| AUTH-3 | Medium | API-token lookup failures echoed as `401` with the raw DB error | FIXED |
| PORTAL-1 | High | `AUTH_SECRET` silently fell back to the committed default secret | FIXED |
| VAL-1 | High | Mock-gateway webhook accepted a committed default secret | FIXED |
| RACE-1 | Medium | Duplicate pending review returned a raw `23505` → 500 | FIXED |
| RACE-2 | Medium | Concurrent checkouts could collide on the invoice number | FIXED |
| DB-1 | Medium | `company_domains` write RLS was permissive (`USING/WITH CHECK true`) | FIXED |
| DATA-1 | Medium | Sign-out left the previous account's workspace state in memory | FIXED |
| FE-1 | Medium | An in-flight run could paint its response on the wrong request | FIXED |
| FE-2 | Low | Renaming an environment variable left the old key behind | FIXED |
| DB-2 | Low | `projects.workspace_id` legacy mirror still backs access fallbacks | FIXED | 8a6c5fe |

### AUTH-1 — API-token binding not enforced on the server-run route
- File: `backend/src/api/routes/serverRuns.js`.
- Cause: `/runs` checked the token *scope* but never called `apiTokenBindingError`, so a token bound to project/workspace X could run a request in project Y.
- Fix: after the scope check, set `req.apiToken` and reject with the helper's `403` when the bound token targets a different project/workspace.

### AUTH-2 — Mock-server route creation only required read access
- File: `backend/src/api/routes/mockServers.js`.
- Cause: `POST /mock-servers/:id/routes` gated on `canRead`, so a viewer could add routes.
- Fix: require `canWriteProject(req.user.id, server.project_id)` (editor/manager/admin), matching the other route mutations.

### AUTH-3 — Token-lookup errors surfaced as 401 with internals
- Files: `backend/src/api/access.js`, `backend/src/api/tokenAuth.js`, `backend/src/api/routes/serverRuns.js`.
- Cause: `catch (err) { res.status(err.status || 401).json({ error: err.message }) }` echoed any error — including transient DB failures — as a client-facing 401 with the raw message.
- Fix: only `err.code === 'invalid_api_token'` is echoed (401); everything else goes to `next(err)` for the central 500 handler.

### PORTAL-1 — Session secret defaulted to a committed value
- Files: `backend/src/api/authLib.js`, `backend/src/api/server.js`, `portal/backend/src/server.js`.
- Cause: `secret()` fell back to `'dev-only-auth-secret-change-me'` unconditionally, so a production deploy missing `AUTH_SECRET` would accept anyone's forged session cookie.
- Fix: `secret()` now throws in production when `AUTH_SECRET` is unset or still the built-in default; `assertAuthSecret()` is invoked at boot by both servers so a misconfiguration fails fast. Non-production keeps the dev default.

### VAL-1 — Mock-gateway webhook secret defaulted to a committed value
- Files: `portal/backend/src/routes/webhooks.js`, `portal/backend/src/server.js`.
- Cause: `GATEWAY_WEBHOOK_SECRET` fell back to `'whsec_apihub_sim_gateway_dev'`, so the opt-in mock gateway would accept the publicly known secret.
- Fix: an unset secret now fails closed (no signature can match); the portal warns at boot when `ALLOW_MOCK_GATEWAY=1` has no secret.

### RACE-1 — Duplicate pending review 500s
- File: `backend/src/api/routes/reviews.js`.
- Cause: two concurrent review requests both passed the pending pre-check; the partial unique index rejected the loser with a raw `23505`, surfacing as a 500.
- Fix: map `23505` to `409` ("already pending").

### RACE-2 — Invoice number collision
- File: `portal/backend/src/routes/publicCheckout.js`.
- Cause: `nextInvoiceNumber` computed `MAX+1` without serialising; two concurrent transactions read the same number and the `UNIQUE(number)` insert failed as a 500.
- Fix: take a transaction-scoped `pg_advisory_xact_lock` keyed by the invoice year before reading the max.

### DB-1 — Permissive RLS on `company_domains`
- Files: `db/migrations/063_company_domains_rls.sql`, `backend/src/api/companyNetwork.js`.
- Cause: migration 052 allowed INSERT/UPDATE/DELETE for every app connection, relying only on route-layer checks.
- Fix: new migration restricts INSERT/UPDATE/DELETE to platform ADMIN/MANAGER (the main-app admin route is ADMIN, the portal route MANAGER+), keeps SELECT open for signup/login classification, and moves the pre-auth "link domain to org" update into a narrowly-scoped `SECURITY DEFINER` function (`app.link_company_domain`) that can only set `organization_id` on an existing row.
- Note: migration not executed here (no database); reviewed against the existing RLS patterns in 003/025/033.

### DATA-1 — Sign-out left stale workspace state
- File: `frontend/src/store/WorkspaceStore.tsx`.
- Cause: when `user` became null, `refresh()` cleared the list state only; the active workspace/project/collection, tree, open tabs, cached runs and edit buffers survived, so the next account could briefly see the previous session's data.
- Fix: the `!user` branch of `refresh` now resets every selection and per-request cache and invalidates in-flight selections.

### FE-1 — Run result applied to the wrong active request
- File: `frontend/src/store/WorkspaceStore.tsx`.
- Cause: `runActiveRequest` always called `setLastRun(result)` on resolve, so switching tabs mid-flight painted request A's response on request B.
- Fix: capture the initiating id, always cache the response under it, but only `setLastRun` when that request is still active (mirrored via a ref).

### FE-2 — Renaming an environment variable kept the old key
- File: `frontend/src/components/EnvironmentsModal.tsx`.
- Cause: save upserted by key and only deleted drafts matched by id, so a rename inserted the new key and left the old row.
- Fix: delete every stored variable whose key is no longer present, then upsert the drafts (key-based, so renames, additions and deletions all settle correctly).

### DB-2 — Legacy `projects.workspace_id` (fixed)
- Files: `backend/src/api/access.js` (`getProjectAccess`), `backend/src/api/routes/projects.js` (`GET /api/projects`), `backend/src/api/routes/content.js` (`workspace content tree`), `backend/src/api/runner.js` (`activeEnvironmentId`), `backend/src/api/routes/serverRuns.js` (`environmentMatchesRequest`), `backend/src/api/tokenAuth.js` (`resolveBindingTarget`).
- Cause: after 057/058 a project may own several workspaces, but project access, project listings, the workspace content tree, run-environment resolution and token binding still keyed off the single legacy `projects.workspace_id` mirror (the primary workspace). A member of a non-primary workspace could be denied unless also a project member, and runs from secondary workspaces resolved the wrong active environment.
- Fix: derive access from every workspace under the project (highest role wins), include all project workspaces in listings and the content tree, resolve run environments from `collections.workspace_id`, and make token binding recover path-based targets (the router-level auth middleware runs before `req.params` is populated) with workspace-to-project context.
- Tests: new `backend/tests/projectWorkspaceAccess.integration.test.cjs` covers secondary-workspace read, sibling non-leak, secondary-workspace active environment, workspace-bound token runs, and project-bound token context on workspace paths. Verified: Jest 47/47, API units 147/147, integration 336/336.

---

## QA feature — Collection Runner options (2026-10-11)

Additive product work alongside the audit, aimed at QA/tester throughput.

| ID | Title | Status |
|----|-------|--------|
| QA-1 | Collection Runner run options, datasets, retries and result exports | IMPLEMENTED |

### QA-1 — Collection Runner QA options
- Backend: `backend/src/api/collectionRun.js` (pure helpers: option clamping, data-row normalisation, run-plan building, failure/summary logic) + `backend/src/api/__tests__/collectionRun.test.cjs`; `runner.js` `runRequest(id, userId, extraVars)` overlays per-row variables; `routes/content.js` `/collections/:id/run` accepts `stopOnError, delayMs, retries, iterations, requestIds, data`, charges `plan.length` calls up-front, retries, stops early, and fires workflow events once per execution.
- Dataset: each row is exposed to templates as both `{{data.<field>}}` and `{{<field>}}`.
- Frontend: `frontend/src/lib/collectionRun.js` (CSV/JSON dataset parse) and `frontend/src/lib/collectionReport.js` (json/junit/csv/markdown/html reports) with `node:test` suites; `lib/api.ts` types; `WorkspaceStore.runCollection(id, options?)`; `CollectionRunnerModal.tsx` gains an options fieldset, dataset box, "re-run failed" and export buttons; `Sidebar.tsx` passes the collection id and run handler; `globals.css` styles.
- Limits: iterations ≤ 50, retries ≤ 5, delay ≤ 10000ms, data rows ≤ 200, request ids ≤ 500, cell length ≤ 2000.
- Verified: frontend 193/193 and backend 146/146 unit tests pass; `node --check` clean on the edited JS.

---

## Live test-pyramid pass — 2026-10-11

Full pyramid run against a live local stack (Postgres 15 + Redis, backend `:3001`,
mock upstream `:3999`, `next dev` `:3000`) on a fresh `npm run reset:db` +
`npm run seed:dev`. New defects found and fixed:

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| SNAP-1 | Medium | JSON/GraphQL request-body snapshots stored as objects, so credential redaction skipped them | FIXED |
| WEB-1 | Medium | Sidebar "APIs" click during an in-flight away-navigation could be superseded | FIXED |
| WEB-2 | Low | Environment secret toggle was not clickable by pointer/automation | FIXED |
| TEST-5 | Test | Integration harness could not provision a second test DB (cluster-global `app_user` drop) | FIXED |
| TEST-6 | Test | Five Playwright specs assumed pre-"project-first" UI / anonymous share pages | FIXED |
| TEST-7 | Test | `e2e-live` LNA-guidance check assumed a public target, so it failed on a loopback `E2E_MAIN` | FIXED |

### SNAP-1 — JSON request snapshots skipped credential redaction
- File: `backend/src/api/bodyCodec.js`.
- Cause: `serializeBody` returned the parsed object as the snapshot for JSON/GraphQL bodies, while every other body type (text/XML/multipart) and every response snapshot is a string. `redactSnapshot` in `backend/src/api/redact.js` only redacts `typeof body === 'string'`, so a JSON request body containing `password`/`token`/... was persisted to `run_history` and public shares unredacted. It also contradicted the client contract (`requestSnapshot.body: string | null`).
- Fix: snapshot JSON/GraphQL bodies as the serialized string.
- Test: `backend/src/api/__tests__/bodyCodec.test.cjs` asserts the snapshot equals the serialized body; the `apiAuth` formula round-trip integration test parses it as before.

### WEB-1 — Sidebar navigation race
- File: `frontend/src/components/Sidebar.tsx`.
- Cause: `goWorkspace()` guarded its `router.push('/')` on `window.location.pathname === '/'`. While a `/manage`|`/admin`|`/automations` navigation was still in flight the committed pathname was still `/`, so the guard skipped the push and the pending away-navigation won, leaving the app off the workspace view.
- Fix: `onClickCapture` on the rail marks in-flight away-navigations (`navPendingRef`, cleared on `pathname` change); `goWorkspace` skips the push only when genuinely parked on `/`.
- Regression: `frontend/e2e/nav-race.spec.ts`.

### WEB-2 — Environment secret toggle not clickable
- File: `frontend/app/globals.css`.
- Cause: `.toggle-switch-input` was hidden with `clip: rect(0 0 0 0)` at 1x1, so pointer/automation hit-testing landed on the spanning track instead of the checkbox.
- Fix: the input overlays the switch (`position:absolute; inset:0; width/height 100%; opacity:0; z-index:1`).
- Regression: `frontend/e2e/environments.spec.ts`.

### TEST-5 — Shared `app_user` role blocked a second test DB
- File: `db/migrations/001_init.sql`.
- Cause: the migration unconditionally `DROP ROLE IF EXISTS app_user; CREATE ROLE app_user`. The role is cluster-global, so once its objects existed in `apihub`, the `sdkSync` suite's re-application against `apihub_sdk_test` failed with `role "app_user" cannot be dropped because some objects depend on it` (9 tests).
- Fix: create the role only when absent (`DO $$ ... pg_roles ... $$`); the following `GRANT`s stay idempotent.

### TEST-6 — Playwright specs after the project-first refactor
- Files: `frontend/e2e/{collection-export-import,mock-server,project-overview,share-links,scratchpad}.spec.ts`, `frontend/playwright.config.ts`.
- Changes: open project overview / mock tabs from the `project-switcher-button` dropdown (the tree rows were removed); `page.reload()` before selecting API-created collections (the sidebar renders `projectTree`, which `selectWorkspace` does not refresh); the share page is login-gated, so the spec signs in through the context cookie jar; the scratchpad save spec now awaits the async save (picker close / editor open) instead of racing the `/content` refetch; `expect.timeout` raised to 15s for cold `next dev` compiles.

### TEST-7 — e2e-live LNA-guidance check failed on a loopback target
- File: `e2e-live/suites/05-browser-run.cjs`.
- Cause: the `browser-run.lna-guidance` check assumes Chrome gates a public-site-to-loopback fetch (`Local Network Access`) so the run errors with actionable guidance. When `E2E_MAIN` is itself `http://127.0.0.1:3000` (local runs) the page origin is already local, so the gate never fires, the request succeeds, `denied.err` is empty, and the check failed even though nothing is wrong.
- Fix: detect a loopback `E2E_MAIN` and report the check as a `warn` (gate cannot fire) instead of a `fail`. The `no-stale-timeout` guard still runs.

Verification (live stack, fresh `reset:db` + `seed:dev`):

- Frontend: Playwright **53/53**, `tsc --noEmit` clean, `npm test` **193/193**, `next build` OK.
- Backend: jest **47/47**, `test:api:unit` **147/147**, integration (`tests/*.integration.test.cjs`) **331/331**.
- Live (`node e2e-live/run-all.cjs` against the local stack, portal `:3002` + portal-api `:3102` included): **54 pass / 0 fail / 2 warn** (`login.signup-closed` open because the local backend runs `ALLOW_SELF_SIGNUP=1`; `browser-run.lna-guidance` skipped per TEST-7).
