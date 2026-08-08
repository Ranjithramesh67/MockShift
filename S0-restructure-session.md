# STEP S0 — Restructure session files (docs only, no code)

You are an AI coding agent working on the **MockShift / API Hub** repo at `/workspace`.
Your ONLY job in this session is **STEP S0**: restructure the session files so a fresh
agent can work from a compact state file. No code changes. Docs only.

Do NOT proceed to any later step (S1+) — those are separate sessions.

---

## 1. Repo context

- Repo: `Ranjithramesh67/MockShift` (branch `master`). Git author email on this machine:
  `monkeycode-ai@chaitin.com`. Remote: `origin`.
- Stack: Express 5 backend (port 3001) + Next.js frontend (port 3000, proxies `/api` to 3001)
  + PostgreSQL 15 (`apihub`) + Redis (BullMQ) + `isolated-vm` formula sandbox.
- Top-level layout: `backend/` (Express API + sandbox + scripts), `frontend/` (Next.js app),
  `db/` (migrations 001–009 in `db/migrations/*.sql` + `db/tests/run.sh`), `session.md`,
  `docs/SESSION.md`.

### Current git state (verify, don't assume)

```
git log --oneline -3
git status --porcelain
```

At the time this file was authored, HEAD was `ca9a7e4` ("docs(session): record share links
push (ac6cd52)") and the tree was clean except `frontend/tsconfig.tsbuildinfo` (ignored —
leave it alone). Backlog items #1–#7 are all on `master`; the last feature shipped was
**#7 Share links** (commit `ac6cd52`).

### Environment / services

| Service | How to run | Port |
|---|---|---|
| PostgreSQL 15 | `PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub` | 5432 |
| Redis | `redis-server` (snapshots disabled via `save ""`, pointed away from repo) | 6379 |
| Backend | `cd backend && PORT=3001 node src/api/server.js` | 3001 |
| Frontend | `cd frontend && npm run dev` | 3000 |
| Mock upstream | `cd backend && node scripts/mock-upstream.js` (in-memory store seeded from `scripts/mock-data.json`; mutations reset on restart) | 3999 |

### Backend env for dev/tests

`AUTH_SECRET=dev-secret VAULT_KEY=test-vault-key-do-not-use-in-prod PGHOST=127.0.0.1 PGPORT=5432
PGUSER=postgres PGPASSWORD=postgres PGDATABASE=apihub`

### Test matrix (green at last run)

- Backend: `cd backend && npm test` (jest) **47/47**; `npm run test:api` (integration) **35/35**;
  `npm run test:api:unit` **24/24**.
- DB: `cd db && bash tests/run.sh` — all pass (applies every migration).
- Frontend: `cd frontend && npm run test` (jest) **47/47**; `npx tsc --noEmit` clean;
  `npm run test:e2e` (Playwright) **23/23** — e2e only green on a freshly
  `reset:db` + `seed:dev` DB (other specs leave requests in the seeded "Mock API Demo"
  collection, so `assertions-runner.spec.ts`'s "Requests: 8" breaks otherwise).
- After any DB reset or `db/tests/run.sh`, run `cd backend && npm run seed:dev` to restore
  demo accounts + the "Mock API Demo" collection + admin demo rows.

### Login accounts (created by `npm run seed:dev`)

| Email | Password | Role |
|---|---|---|
| boss1785867669@test.io | bosspass123 | ADMIN |
| pm1785867669@test.io | pmpass1234 | MANAGER |
| dev1785867669@test.io | devpass123 | EDITOR |

---

## 2. Working rules (user-mandated — follow every session)

1. **Update `session.md` FIRST** — at the start of every turn, before any code change, record
   the plan/pending work so a fresh agent always sees the latest picture.
2. **Make the changes**.
3. **Push code to GitHub every time** — commit and `git push origin master`. Do not leave work
   uncommitted/unpushed at the end of a turn.
4. **Update `session.md` AFTER the push too** — refresh with what was completed, then commit +
   push that update as well. Keep `docs/SESSION.md` in sync when useful.
5. No-delete guardrail: move build caches aside (e.g. `.next.bak-*`) instead of `rm -rf`; never
   delete user data without confirmation.
6. Keep `data-testid` / `aria-label` hooks green so the Playwright e2e suite keeps passing.
7. AI/LLM feature is **out of scope** (deferred by the user) — do not build or add AI placeholders.

## 3. Session protocol (user-mandated, applies to this and every later step)

- **One step per session.** A session executes exactly one roadmap step (S0, then S1, S2, …).
- **Post the plan and wait for GO.** Before making any file changes, post your concise plan and
  WAIT for the user to reply `GO`. Do not start editing until you get it.
- **Stop after each step.** When the step is complete (verified + committed + pushed), stop and
  report. Do not start the next step.
- **Resume rule.** If this session runs out of context mid-step: the next chat starts by pasting
  this same file again; read `session.md` and resume from the recorded resume point.
- Every later prompt assumes `session.md` is already in the compact shape this step produces.

---

## 4. The problem S0 fixes

`session.md` has become a 421-line chronological turn-log (a `## Current turn (...)` block per
commit), while `docs/SESSION.md` holds the detailed canonical log. The working rules ask the
agent to "update session.md first" every turn — but appending one more turn block per session
keeps bloating the file instead of keeping it a **short status snapshot**. It also currently
starts with a stale block claiming "#7 Share links" is still in progress even though #7 was
already pushed (`ac6cd52`).

Target shape (from the top of `docs/SESSION.md`): a compact **state file** that fits the working
loop — at a glance + environment/services + running loop + roadmap/backlog status + known
gotchas — with the verbose turn history living only in `docs/SESSION.md`.

## 5. S0 task

Everything below is docs-only. Make no code changes.

### 5.1 Archive the turn history

- The current `session.md` is a turn-log. Its `## Current turn (…)` blocks describe completed,
  pushed work. They belong in `docs/SESSION.md`, not in the state file.
- Append to `docs/SESSION.md` a chronological section covering the backlog-item turns that are
  already on `master` but may not yet be recorded there, in the same style as its existing
  `## 5. What was done in this session (chronological)` / per-feature subsections:
  - **#5 Workflow triggers & notifications** (commit `c15149e`)
  - **#6 Export / import collections** (commit `f496e7f`)
  - **#7 Share links for requests** (commit `ac6cd52`)
  - **#4 Mock server per project** (marked DONE)
- Preserve the genuinely durable notes (e2e reseed requirement, backend restart after pulls,
  `seed:dev` restores admin demo rows since #5, migration-not-auto-applied, `next build` vs
  `next dev` `.next` clobber warning) — put them in the compact state file's gotchas section or
  the `docs/SESSION.md` known-issues section, not in an archived turn block.
- If `docs/SESSION.md` is itself getting unwieldy, slim it the same way: keep durable
  environment/service/known-issue content at the top, move old per-turn narrative into an
  archival section. Do not delete content — restructure.

### 5.2 Rewrite `session.md` as a compact state file

Replace the 421-line turn-log with a state file containing (in this order, headers are a
suggestion — match what reads best):

1. **Project at a glance** — what the app is, the stack, where each part lives (1–3 lines).
2. **Repo layout** — one line each for `backend/`, `frontend/`, `db/`, plus where session
   docs live and which file is canonical (`docs/SESSION.md`) vs the state snapshot (`session.md`).
3. **Environment / services** — the table from section 1 above.
4. **Backend env for dev/tests** — the env block from section 1.
5. **Working loop** — the user-mandated loop (section 2, condensed): update `session.md` first →
   change → push → update `session.md` again.
6. **Session protocol** — section 3, condensed: one step per session; post plan, wait for `GO`;
   stop after each step; resume rule.
7. **Roadmap** — the table from section 6 below (S0–S8), marking **S0 DONE (this step)**.
8. **Backlog (product features)** — the two remaining user-approved items **#8 Comments &
   collaboration** and **#9 Global search** (these are separate from the platform-hardening
   roadmap; keep their one-line descriptions).
9. **Run it** — the commands from section 1's services table + `npm run seed:dev`.
10. **Login accounts** — the table from section 1.
11. **Known gotchas** — the durable notes called out in 5.1 (e2e reseed requirement, backend
    restart after pulls, `seed:dev` restores admin demo rows, migrations not auto-applied,
    `next build`/`next dev` `.next` clobber, "Invalid email or password" = DB was reset).
12. **Resume point** — a one-liner: `S0 complete at <commit>; next step is S1`.

Keep it tight (target roughly ≤ 150 lines). Drop the old per-commit turn blocks and any content
that is now captured in `docs/SESSION.md`.

### 5.3 Remove the stale block

The top block currently claiming "#7 Share links" is **in progress** is stale (#7 is pushed).
Delete it; the roadmap/backlog status in the new state file reflects reality.

### 5.4 Verify

- Read the new `session.md` back: it must be self-contained for a fresh agent (no dependency on
  `docs/SESSION.md` to understand the environment, the loop, or the roadmap).
- `docs/SESSION.md` and `session.md` must not contradict each other.
- No source, test, migration, or config file changed (`git status` shows only the two session
  docs + nothing else).

### 5.5 Commit + push

Commit in two pushes per the working loop, on `master`:

```
git add session.md docs/SESSION.md S0-restructure-session.md
git commit -m "docs(session): slim session.md to a state file and archive turn history to docs/SESSION.md"
git push origin master
```

Then update the **Resume point** line of `session.md` with the actual commit hash, commit that
update, and push it too.

## 6. Roadmap (install this into the new session.md)

| Step | Title | What it is |
|---|---|---|
| **S0** | Restructure session files | This step. Docs only. ✅ DONE after this session. |
| **S1** | Credential redactor module | Centralized module that redacts secrets (auth-provider credentials, headers like `authorization`/`cookie`/`x-api-key`, token responses) before they reach logs, run history, and share links. |
| **S2** | Run-history retention & purge | DB retention/cleanup policy for `run_history` (audit trail) — pruning, archive, configurable retention. Closes **P0**. |
| **S3** | API tokens | Long-lived API tokens for headless/CI access (scoped, revocable), backed by a `api_tokens` table. |
| **S4** | Server-side runs endpoint | Programmatic run API (trigger a request/collection/workflow run server-side, return a run id), building on S3 auth. |
| **S5** | CLI | Command-line client with reporters + exit codes, and local / Docker / CI execution modes, backed by S3+S4. Closes **P1**. |
| **S6** | Platform hardening — **TBD** | Spec pinned down after S5 lands (see below). |
| **S7** | Platform hardening — **TBD** | Spec pinned down after S5 lands. |
| **S8** | Platform hardening — **TBD** | Spec pinned down after S5 lands. |

Notes:
- **S6–S8 are TBD placeholders.** Their specs are defined in the main brief and will be pinned
  down before each is authored — do not invent details for them.
- **Steps S9–S23** (data-driven runs, schema/contract assertions, async `WAIT_FOR` steps) exist
  in the main brief but their prompts MUST NOT be written until S8 lands (the CLI shape may
  change details). Do not reference S9+ in the roadmap beyond a one-line "later phases" note.

---

## 7. How to work

1. Post your plan for S0 (sections 5.1–5.3, including your proposed new `session.md` outline).
2. **Wait for `GO`.**
3. Execute, verify (5.4), commit + push (5.5).
4. Stop and report. Do not start S1.
