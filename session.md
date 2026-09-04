# MockShift — Session State

Last updated: 2026-09-04

> Canonical narrative log: docs/SESSION.md. This file is the working agreement + current state.
> Read this file first, every session. Open docs/SESSION.md only for detail on a past turn.

## Current

Step: Postman-style structured MULTIPART bodies — text + FILE parts end-to-end
(request editor, scratchpad, runner, persistence, exports/shares/redaction).
Status: COMPLETE — all gates green, committed and pushed to `origin/master`.

THIS TURN (2026-09-04, structured multipart file parts):
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
