# MockShift — Session State

Last updated: 2026-08-16

> Canonical narrative log: docs/SESSION.md. This file is the working agreement + current state.
> Read this file first, every session. Open docs/SESSION.md only for detail on a past turn.

## Current

Step: Postman-style request editing (remove create toggle, cURL auto-detect,
dirty-state dot, request tabs, test-cURL-without-saving).
Status: COMPLETE — M1–M9 all done; feature shipped.

M9 DONE (pushed `2d3ee16`):
- Docs + wrap-up: `session.md` Current + Plan + Completed updated,
  `instructions.md` status table finalised (M9 → done), `docs/SESSION.md` gained
  a dated §5 narrative entry. Final commit records the full feature set. Docs
  only — no source, test, or DB changes.

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

## Completed (this feature)

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

- (none)

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
  `db/tests/run.sh` applies all of them. Use the next free migration number (012 next) and record
  it here.
- **Restart the backend after adding/changing routes** — a stale process serves old handlers.
- **Full e2e run needs a freshly reset + seeded DB and mock upstream on :3999** — other specs
  leave requests in "Mock API Demo", so "Requests: 8" in assertions-runner.spec.ts breaks otherwise.
- **Never run `next build` while `next dev` is live on the same `.next` dir** (clobbers dev chunks).

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
