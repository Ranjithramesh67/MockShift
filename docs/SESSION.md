# Session History & Handoff

This document is the chat-history / handoff log for the MockShift (API Hub)
project. A fresh AI agent should read this file first to learn the current
state, what has already been done, and how to continue without redoing work.

## 1. Project at a glance

- Stack: Express 5 (backend, port 3001) + Next.js 14 (frontend, port 3000) +
  PostgreSQL 15 (`apihub` DB) + Redis (BullMQ). Sandboxed formula execution via
  `isolated-vm`.
- Layout:
  - `backend/` — execution engine + REST API (`src/api/server.js`, port 3001).
  - `frontend/` — Next.js app, `/api/*` proxied to 127.0.0.1:3001
    (`next.config.mjs`).
  - `db/` — SQL migrations (`migrations/`), tests (`tests/`), `seed.sql`.
  - `prisma/` — present but the backend uses raw SQL (pg), not Prisma.

## 2. Environment / services

| Service        | Port   | How to start                                                        |
|----------------|--------|---------------------------------------------------------------------|
| PostgreSQL     | 5432   | `pg_ctlcluster 15 main start` (root)                                |
| Redis          | 6379   | `redis-server --daemonize yes`                                      |
| Backend API    | 3001   | `cd backend && PORT=3001 node src/api/server.js`                    |
| Frontend (dev) | 3000   | `cd frontend && npm run dev`                                        |
| Mock upstream  | 3999   | `cd backend && node scripts/mock-upstream.js`                       |
| Preview        | tunnel | https://3000-1807d442a88c3aec.monkeycode-ai.live (from port 3000)   |

Backend env required for the dev server / tests:

```
AUTH_SECRET=dev-secret
VAULT_KEY=test-vault-key-do-not-use-in-prod
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub
```

- The frontend rewrites `/api/*` to `127.0.0.1:3001`; the mock upstream is only
  reachable from the backend process (same host).
- `allowedDevOrigins` in `frontend/next.config.mjs` already includes
  `.monkeycode-ai.live` for preview-domain access.

## 3. Seeded dev accounts (login via preview or API)

| Email                     | Password     | Role    |
|---------------------------|--------------|---------|
| boss1785867669@test.io    | bosspass123  | ADMIN   |
| pm1785867669@test.io      | pmpass1234   | MANAGER |
| dev1785867669@test.io     | devpass123   | EDITOR  |

Each has an org, a private "My Workspace" and a "Default Project" (mirrors the
signup bootstrap). Recreate any time with `cd backend && npm run seed:dev`.

## 4. Sample data & seed (retained)

The sample data survives DB resets because it is defined in code, not just in
the live DB:

- **App data seed**: `backend/scripts/seed-dev.js` (`npm run seed:dev`) is an
  idempotent script that (re)creates the three accounts above and, under the
  ADMIN's Default Project, a **"Mock API Demo"** collection with 6 requests:
  `GET all posts`, `GET post 1`, `POST create post`, `PUT replace post 1`,
  `PATCH post 1`, `DELETE post 2` — all pointed at the local mock upstream
  (http://127.0.0.1:3999). Rerunning is safe (users upserted, orgs/workspaces/
  projects/collections created only if missing, requests created-or-updated by
  name).
- **Mock data**: `backend/scripts/mock-data.json` holds the jsonplaceholder
  style seed records (posts/comments/users/todos). `backend/scripts/
  mock-upstream.js` loads this file at startup, so sample records are retained
  in the repo. NOTE: mutations (POST/PUT/DELETE) live in memory and reset on
  restart; `mock-data.json` is only the initial store.
- DB migrations are in `db/migrations/*.sql`. Migration `004_request_formula`
  adds `api_requests.formula text NOT NULL DEFAULT ''`.

## 5. What was done in this session (chronological)

### 5.1 Pre-request Formula feature (completed, committed in 472cdf4 as partial)
Already committed before this session's remaining work:
- `db/migrations/004_request_formula.sql` — formula column on `api_requests`.
- `backend/src/api/runner.js` — `loadRequest()` selects formula; `runRequest()`
  builds `req = {method,url,headers,query,body}`, runs the formula in a 150 ms
  sandbox via `FormulaRunner`, merges mutated `req`/`vars` back, substitutes
  `{{vars}}`, then fetches. Auth-token flow and `run_history` snapshot kept.
- `backend/src/api/routes/content.js` — GET `/requests/:id` returns `formula`;
  PUT persists it.
- `frontend/src/store/WorkspaceStore.tsx` + `frontend/src/lib/api.ts` —
  formula round-trips through the editor.

### 5.2 Sandbox helper expansion (this session, uncommitted)
`backend/src/sandbox/formulaRunner.js` — the `HELPERS_SOURCE` IIFE (sandboxed,
pure JS, no Node builtins) now also exposes: `addHours`, `addMinutes`,
`addMonths` (clamps to end of month), `timestamp()` (epoch ms), `capitalize`,
`lower`, `upper`, `trim`, `base64Encode`, `base64Decode` (own UTF-8 + base64
implementations; verified byte-for-byte against Node's `Buffer`).
`frontend/src/components/FormulaHelper.tsx` snippet picker updated to match the
new helper names.
Tests: extended `backend/tests/sandbox.rce.test.js` and added a formula
integration test in `backend/tests/apiAuth.integration.test.cjs` (creates a
JSON-body request with `req.body.userId = 2`, runs it, asserts the dispatched
and upstream-echoed bodies contain `userId: 2`, and asserts
`GET /requests/:id` round-trips the saved formula).

### 5.3 Mock API for GET/POST/PUT checks (this session, uncommitted)
`backend/scripts/mock-upstream.js` is now a jsonplaceholder-style REST mock on
3999: `GET/POST/PUT/PATCH/DELETE` on `posts`, `users`, `comments`, `todos`
(in-memory store seeded from `mock-data.json`), plus the legacy `/token` and
`/echo` endpoints. Demo requests live in the "Mock API Demo" collection.

### 5.4 Seed retention (this session, uncommitted)
- `backend/scripts/seed-dev.js` + `npm run seed:dev` (see section 4).
- `backend/package.json` — added `seed:dev` script.

## 6. Verification performed

- Formula live check (API): set `formula: "req.body.userId = 2"` on a POST to
  the mock, `GET /requests/:id` returns the formula, Run dispatches
  `{"amount":19.99,"userId":2}`, upstream echoes `userId: 2`,
  `run_history.request_snapshot` persists the mutated body.
- All six mock API requests run through the app successfully
  (GET 200, POST 201, PUT 200, PATCH 200, DELETE 200).
- Full reset → `npm run seed:dev` → login as all three accounts → demo
  collection present with 6 requests → runs work → formula still mutates body
  (`req.body.userId = 42` dispatched as `userId: 42`).

### Test matrix (all green at last run)
- Backend: `npm run test:api` 16/16 · `npm run test:api:unit` 14/14 ·
  `npm test` (jest) 39/39.
- Frontend: `npm run test` 28/28 · `npm run build` OK (after the `Link`
  import fix) · `npm run test:e2e` (Playwright) 4/4.
- DB: `cd db && bash tests/run.sh` — all pass (includes migration 005).

## 7. Current uncommitted changes

```
M backend/src/api/routes/manage.js        (COALESCE '(deleted)' for orphaned run rows)
M backend/tests/apiAuth.integration.test.cjs (regression test: delete a run request)
M frontend/src/components/Sidebar.tsx     (import Link from 'next/link' — fixes next build)
?? db/migrations/005_relax_run_history_target.sql
```

The response-pane prettify/preview/PDF feature and all prior session work are
already committed and pushed on `master` (HEAD `22f4e17` + this session's
commit).

## 8. Known issues / notes for the next agent

- ~~**Deleting a run request via the API fails**~~ **FIXED**: migration
  `005_relax_run_history_target.sql` relaxes the `run_history_target` CHECK constraint to
  `NOT (request_id IS NOT NULL AND workflow_id IS NOT NULL)`, so `ON DELETE SET NULL` from a request/
  workflow deletion no longer violates it. Run history is preserved as an audit trail; the manage
  `/history` query labels orphaned rows `(deleted)` via a third `COALESCE` fallback. Regression test
  added to `apiAuth.integration.test.cjs` (run a request → delete it → 200, rows preserved). App RLS
  hides both-null rows from user-visible history, which is acceptable.
- **Production build bug fixed**: `Sidebar.tsx` was missing `import Link from 'next/link'` (added);
  `next build` now passes. `npm run test:e2e` may spawn its own dev server and conflict with a running
  one on port 3000 — kill existing `next dev` before running e2e, or rely on `reuseExistingServer`.
- The mock store is in-memory; restarting `mock-upstream.js` resets POST/PUT/
  DELETE mutations back to `mock-data.json`.
- `redis-cli config set dir` is a protected setting in this build; Redis was
  pointed away from the repo so no `dump.rdb` is written into `/workspace`
  (snapshots disabled via `save ""`).
- Installing Postgres/Redis/Playwright was required in this environment (they
  were absent); see section 2 for how they are started.

## 9. How to continue

**Working order (user-mandated):** 1) update `session.md` first, 2) make the
changes, 3) commit + push to `origin/master`, 4) update `session.md` again
after the push with what was completed and push that update too.

1. If services are down, start them per section 2, then hit the preview link.
2. If the DB was reset (e.g., by `db/tests/run.sh` or an integration test),
   restore sample data with `cd backend && npm run seed:dev`.
3. Sign in as `boss1785867669@test.io` / `bosspass123`, open "Mock API Demo",
   press Run on any request to confirm the stack.
4. The `DELETE /requests/:id` run-history bug is fixed (section 8).
