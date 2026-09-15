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
| MED-1 | Medium | IDOR: `GET /api/collections/:id/auth-provider` has no access check | FIXED | df5e9a9 |
| MED-2 | Medium | IDOR: `GET /api/workspaces/:id/teams` leaks teams to non-members | FIXED | 4d56205 |
| MED-3 | Medium | Invalid input returns 500 and leaks raw Postgres errors | FIXED | d7356a2 |
| MED-4 | Medium | Reject-send has no concurrency guard | OPEN | |
| MED-5 | Medium | Review decision race (double decide) | OPEN | |
| MED-6 | Medium | Public-workspace visibility not honored at project level | NEEDS VERIFICATION | |
| MED-7 | Medium | First-recharge bonus computed outside the lock | OPEN | |
| MED-8 | Medium | Refund does not cancel the subscription | NEEDS VERIFICATION | |
| MED-9 | Medium | Portal B non-member login message is wiped | OPEN | |
| LOW-1 | Low | Blank request name accepted | OPEN | |
| LOW-2 | Low | `PATCH /api/environments/:id` hardcodes `variable_count: 0` | OPEN | |
| LOW-3 | Low | Case-variant email creates a duplicate account | OPEN | |
| LOW-4 | Low | Session cookie missing `Secure` flag | OPEN | |
| LOW-5 | Low | Workflow until-loop self-reference validation tests wrong key | OPEN | |
| LOW-6 | Low | SSE room authorization frozen for connection lifetime | OPEN | |
| LOW-7 | Low | `syncAllSchedules` never removes stale cron schedulers | OPEN | |
| LOW-8 | Low | Public doc-share lookup does not assert `kind='public'` | OPEN | |
| LOW-9 | Low | Dead code (unused declarations) | OPEN | |
| TEST-1 | Test | `environments.integration.test.cjs` missing `restrictions_enforced=false` | OPEN | |
| TEST-2 | Test | 6 workflow e2e specs use removed `main-tab-workflow` | OPEN | |
| TEST-3 | Test | `send-working-copy.spec` expects mock `/posts/2` (404) | OPEN | |
| TEST-4 | Test | `history.spec` assumes empty history | OPEN | |

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
- Status: OPEN

### MED-5 — Review decision race
- File: `backend/src/api/routes/reviews.js:232-249`.
- Fix: guard UPDATE with `AND status='pending'`; check `rowCount`.
- Status: OPEN

### MED-6 — Public workspace vs project visibility
- File: `backend/src/api/access.js:198-232` vs `:120-139`.
- Status: NEEDS VERIFICATION (may be intended) — confirm product intent, then reconcile.

### MED-7 — First-recharge bonus race
- Files: `portal/backend/src/routes/publicCheckout.js:434-435`, `portal/backend/src/paymentFinalize.js:92-94`.
- Fix: compute first-paid/bonus inside the transaction under an advisory lock.
- Status: OPEN

### MED-8 — Refund does not cancel subscription
- File: `portal/backend/src/routes/subscribers.js:571-607`.
- Status: NEEDS VERIFICATION (may be manual settlement) — confirm, then cancel + lock.

### MED-9 — Portal B non-member login message wiped
- Files: `portal/frontend/app/manage/login/page.tsx`, `portal/frontend/src/lib/portalApi.ts:67`.
- Fix: surface the message after redirect (query param / not a full reload).
- Status: OPEN

### LOW-1 — Blank request name
- File: `backend/src/api/routes/content.js:27`. Fix: reject blank → 400.
- Status: OPEN

### LOW-2 — Env PATCH `variable_count: 0`
- File: environments route PATCH response. Fix: return the real count.
- Status: OPEN

### LOW-3 — Case-variant email duplicate account
- Fix: case-insensitive unique index on `users.email` (migration) + normalize on signup/login.
- Status: OPEN

### LOW-4 — Cookie missing `Secure`
- Fix: set `Secure` when serving over HTTPS/production.
- Status: OPEN

### LOW-5 — Workflow until-loop self-reference validation
- File: `frontend/src/lib/workflowValidation.js:127`. Fix: compare against both `step.id` and `sanitizeLabel(step.label || step.id)`.
- Status: OPEN

### LOW-6 — SSE auth frozen for connection lifetime
- File: `backend/src/api/routes/events.js:14-17,34-70`. Fix: periodic re-check.
- Status: OPEN

### LOW-7 — Stale cron schedulers
- File: `backend/src/api/workflowService.js:377-393`. Fix: remove schedulers not in the enabled set on sync.
- Status: OPEN

### LOW-8 — Doc-share `kind` not asserted
- File: `backend/src/api/routes/docs.js:1512-1529`. Fix: filter `kind='public'`.
- Status: OPEN

### LOW-9 — Dead code
- File: `frontend/app/s/doc/[token]/page.tsx:9` (unused `token`), plus ~18 unused declarations.
- Status: OPEN

### TEST-1 — environments integration setup
- File: `backend/tests/environments.integration.test.cjs` `before()` — add `UPDATE portal_settings SET restrictions_enforced = false;`.
- Status: OPEN

### TEST-2 — Workflow e2e selectors
- Files: `frontend/e2e/workflow-infinite-loop.spec.ts`, `frontend/e2e/workflow-pass-inputs.spec.ts` — `main-tab-workflow` → `rail-workflow`.
- Status: OPEN

### TEST-3 — `send-working-copy` mock data
- File: `frontend/e2e/send-working-copy.spec.ts` / `backend/scripts/mock-data.json` — serve `/posts/2` or target `/posts/1`.
- Status: OPEN

### TEST-4 — `history` isolation assumption
- File: `frontend/e2e/history.spec.ts` — account for background recurring runs.
- Status: OPEN
