# Issues — MockShift / API Hub

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

## Details

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
