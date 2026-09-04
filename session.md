# MockShift — Session State

Last updated: 2026-09-04

> Canonical narrative log: docs/SESSION.md. This file is the working agreement + current state.
> Read this file first, every session. Open docs/SESSION.md only for detail on a past turn.

## Current

Step: NOT STARTED — milestone `A1+B1+X1` (first foundation milestone) is
scoped below; no code written yet.
Status: AWAITING GO — decisions Q1–Q6 answered and recorded in
`## Pending — Two subscription portals`; everything else under
`## Blocked / needs answer from Ranjith`. Start milestone `A1+B1+X1` (scaffold
separate portal codebase + plans/catalog model+migration `012` + Portal B RBAC
on existing role infra) as soon as Ranjith says GO.

THIS TURN (2026-09-04, plan two subscription portals — docs only):
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
- Awaiting **GO to start milestone `A1+B1+X1`**. Before coding, two minor
  inputs are needed (can be decided by the agent at start if Ranjith prefers):
  - Portal stack + location: reuse the repo's Express 5 + Next 14 stack in a
    new `portal/` folder with its own backend + frontend (recommended), or a
    different stack? Which ports?
  - Initial `plans` seed rows for the catalog (first milestone only needs the
    model + admin CRUD, so placeholders fine until Portal A2 showcase).

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
  add to enum in migration `012`.
- **Q6** **First milestone = A1 + B1 + X1 foundation** (see below).

Current: AWAITING GO to start milestone `A1+B1+X1` (plan below).

### First milestone — A1 + B1 + X1 (data model + RBAC + architecture)

Scope when GO is given:
- **X1**: scaffold separate portal codebase (new `portal/` dir: its own
  Express/Next(?) backend + frontend per repo conventions; own port + proxy
  wiring for preview; confirm stack with Ranjith or reuse repo's Express 5 +
  Next 14 stack).
- **A1**: `plans`/catalog data model + public read API + admin CRUD — migration
  `012` (next free number) on the same `apihub` DB (plans/subscriptions/orders/
  invoices + SUPPORT role added to enum), reusing `db/migrations` numbering.
- **B1**: Portal B RBAC — role gate middleware (extend pattern from
  `backend/src/api/access.js`), RLS policies for the new tables, endpoint
  matrix (ADMIN full / MANAGER ops / SUPPORT read-mostly / VIEWER read-only).

### Portal A — public subscription showcase + purchase website (customer-facing)

| Seg | Deliverable |
|---|---|
| A1 | Plan/catalog data model + API: `plans` (name, features, price, billing cycle, trial days, active/published) — migration `012` (next free number), public read endpoints, RBAC-scoped admin CRUD |
| A2 | Showcase UI: landing + plans/pricing pages rendered from the catalog (public, no login), responsive |
| A3 | Subscriber identity — DECIDED: reuse existing `users`, auto-create on checkout (default EDITOR/VIEWER) |
| A4 | Purchase/checkout flow: pick plan → billing/contact info → create subscription + order → confirmation page |
| A5 | Subscriber self-service: "My subscription" area — current plan, status, invoices, change/cancel |
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
| X3 | DB: single new migration(s) `012+` covering plans/subscriptions/orders/invoices + RBAC/RLS; record applied migrations in the Environment note |


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
