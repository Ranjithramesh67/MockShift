# MockShift — Feature Instructions

This file is the runbook for the "Postman-style request editing" feature set.
Each feature is split into **micro tasks**; execute them one at a time and get
explicit approval before starting the next. On a "no", stop, update
`session.md`, and stop.

Repo: `Ranjithramesh67/MockShift` (branch `master`). Working rules + protocol
live in `session.md` (read first).

---

## Goal

Make request editing behave like Postman:

1. **New API request** — no "Fill form / Paste cURL" toggle; auto-detect a
   pasted cURL command and structure it automatically.
2. **Existing request URL field** — pasting a cURL command into the URL input
   auto-parses and applies method, URL, query params, headers and body.
3. **Unsaved-changes ("dirty") tracking** — edits are used immediately (Send
   runs the working copy); the saved data is only replaced when **Save** is
   clicked. Show a dot/indicator when there are unsaved changes.
4. **Tabs for opened requests** — a tab strip of every open request
   (browser-style), switch/close, with the dirty dot on each tab.
5. **Test cURL without saving** — paste a cURL (or edit a request) and run it
   immediately, without creating or saving a request — Postman scratchpad
   behaviour.

---

## Micro tasks

Order matters (each builds on the previous). All tasks need `tsc --noEmit` /
`next build` green where relevant and a live smoke test against the Aiven DB
unless testing is explicitly waived.

### M1 — CreateModal: auto-detect cURL (remove the toggle)

- Remove the "Fill form / Paste cURL" toggle (`create-mode-toggle`,
  `create-mode-form`, `create-mode-curl`, `create-curl-input`).
- Keep the existing Type/Method/URL fields; the **URL field** auto-detects: if
  the pasted/typed text looks like a cURL command (`curl …`), run `parseCurl`
  and populate method + URL; structured headers/params/body are applied on
  create (like the current curl path). Plain URLs keep working as-is.
- Name stays optional with the auto-derived `METHOD host` fallback.
- Testids preserved for the create flow (`new-api-modal`, `create-name`,
  `create-method`, `create-url`, `create-submit`).

### M2 — URL field cURL auto-parse in existing request editor

- In `RequestConfigurator.tsx`, detect a cURL command pasted into `url-input`.
  On detection: `parseCurl` → apply method, URL (base), headers, queryParams,
  bodyType/bodyJson to the working request via `updateActiveRequest`.
- Show a confirmation toast ("cURL parsed into the request.").

### M3 — Dirty-state tracking in WorkspaceStore

- Store a `savedBaseline` snapshot of each loaded request (captured in
  `selectRequest` / after `saveActiveRequest`).
- Derive `isDirty` = deep-compare of working copy vs baseline
  (method, url, headers, queryParams, bodyType, bodyJson, formula, assertions).
- Clear dirty on `saveActiveRequest` success and on `selectRequest`.
- Expose `isDirty` on the store/context.

### M4 — Dirty dot indicator in the editor

- Show a dot (e.g. `•` or a `data-testid="unsaved-dot"` element) next to the
  request name / on the Save button when `isDirty` is true.
- Tooltip/title "You have unsaved changes".

### M5 — Backend: ephemeral run endpoint (run without saving)

- New `POST /api/runs` (authenticated): accepts a full request shape
  (method, url, headers, queryParams, bodyType, bodyJson, formula, assertions)
  + optional `collectionId` (for env vars + auth provider) and optional
  `persistHistory` flag.
- Runs it through the same pipeline as `runRequest` (substitute vars, formula,
  auth provider, fetch, assertions) but **does not** require a stored request.
- Writes `run_history` only when `persistHistory` is true (request_id NULL is
  allowed via the existing nullable FK — history read paths must tolerate it).
- Reuse `backend/src/api/runner.js` internals (refactor `runRequest` so the
  fetch pipeline is callable with an in-memory request object).

### M6 — Send uses the working copy

- `runActiveRequest` calls `POST /api/runs` with the **current working copy**
  (so unsaved edits take effect), passing `collectionId`; history persisted as
  before when the request is saved/clean, or as scratch when dirty.
- Fall back to the stored `POST /requests/:id/run` for the clean case if
  behaviour parity is simpler to keep.

### M7 — Tabs for opened requests

- Store: `openRequestIds: string[]` + active id; opening a request adds it to
  the list (dedupe), closing removes it and activates a neighbour.
- UI: a tab strip above `RequestConfigurator` (new `RequestTabs` component)
  showing name + dirty dot + close button; click switches, close button
  removes the tab (confirm if dirty).
- Working copy per open request is preserved while switching tabs.

### M8 — Test cURL without saving (scratchpad)

- Entry point (TopBar or editor): paste a cURL → structured preview →
  **Send** runs it via `POST /api/runs` without creating/saving a request,
  showing the response in `ResponsePane`.
- Reuses M1 parser + M5 endpoint. No request created in the tree.

### M9 — Docs + wrap-up

- Update `session.md` + `docs/SESSION.md`; `instructions.md` status table.
- Commit + push each micro task to `master` as it completes; final commit
  records the full feature.

### M10 — Drag-and-drop move: request into any folder/sub-folder

- In the sidebar tree, drag a **request** row and drop it onto any folder
  (nested or not) to move it there; drop on the collection root (or empty
  space in the collection body) moves it back to the root (`folder_id` null).
- Backend move already exists: `PUT /api/requests/:id` accepts `folderId`
  (same-collection check) — reuse it.
- Store: add `moveRequest(requestId, folderId)` that calls the API and updates
  the local `tree.requests` row (new `folder_id`).
- Keep the tree hierarchy in sync after a move (no refetch needed).
- e2e spec: drag request folder A → folder B (nested) and back to root.

### M11 — Duplicate request / folder / sub-folder via Ctrl+C

- Backend:
  - `POST /api/requests/:requestId/duplicate` — full deep copy of the request
    (method, url, headers, queryParams, bodyType/bodyJson/bodyText, apiType,
    formula, assertions) into the **same collection + folder**, name kept
    identical to the source (no suffix) — user asked "same copy ... with same
    name". Returns the new request row.
  - `POST /api/folders/:folderId/duplicate` — deep copy of the folder AND its
    entire subtree (sub-folders + requests), same names, same collection.
    Returns the created folder row(s) + requests so the tree can update.
  - Write-access checks mirror the existing folder/request routes.
- Frontend:
  - Clicking a request/folder row selects it (highlight). `Ctrl+C` / `Cmd+C`
    on a selected row duplicates it via the store action. Folder copies bring
    their whole contents.
  - Also add a **Duplicate** item to the existing row context menus
    (request menu + folder actions) as the clickable fallback.
  - Store: `duplicateRequest(requestId)`, `duplicateFolder(folderId)` — call
    the API then merge the returned rows into `tree`.
- e2e spec: select + Ctrl+C duplicates a request; folder duplicate copies its
  sub-folders + requests.

### M12 — Rename focused tree item with F2 shortcut

- F2 (and Cmd/Ctrl+R is NOT used — conflicts with browser refresh; use only
  F2) on a selected/focused request or folder row starts the existing inline
  rename (`startRename`). The focused row is the last clicked one.
- Reuses the current rename input + `commitRename` flow (Enter commits,
  Escape cancels).
- e2e spec: select request, press F2, type new name, Enter → name updated.

### M13 — Drag-and-drop move: folder between nested folders

- Drag a **folder** row and drop it onto another folder to re-parent it
  (nested move); drop on the collection root moves it to root (`parent_id`
  null).
- Backend move already exists: `PUT /api/folders/:id` accepts `parentId` with
  the cycle guard — reuse it.
- Store: add `moveFolder(folderId, parentId)` that calls the API and updates
  the local `tree.folders` row.
- e2e spec: drag folder A into nested folder B; drag it back to the collection
  root.

### M14 — Rework M8 scratchpad: full-width editor pane + save location picker

User decisions (2026-08-16):
- "Test cURL" opens a **full-width editor pane** in the main area (like the
  request tab) — NOT a modal. It has a method select + URL input (paste a curl
  → auto-parse), tabs Params/Headers/Body/Formula/Tests, explicit
  **Send** (ephemeral, nothing saved) / **Save** / **Close** controls, and the
  response shown in a split pane below.
- **Save** opens a picker that **asks for a request name** (required, editable —
  do not silently auto-derive) and lists **all collections in the current
  workspace** with **nested folders** as an indented tree. Cannot save into a
  folder belonging to a different collection (backend enforces a 400). On
  confirm: `contentApi.createRequest({collectionId, name, method, url, apiType,
  folderId})` then `contentApi.updateRequest(id, patch)` with headers /
  queryParams / bodyType / bodyJson/bodyText / formula / assertions, then
  `reloadTree()` + `selectRequest(id)`.

Steps:
1. Shared constants: `frontend/src/lib/requestForm.ts` (METHODS, API_TYPES,
   METHOD_COLORS, BODY_KIND_OPTIONS, bodyKindOf, bodyTypeForKind, BodyKind) —
   refactor `RequestConfigurator` to import them. — DONE (committed)
2. `WorkspaceStore.runScratchpad` accepts `formula` + `assertions` (passes them
   through to `contentApi.runEphemeral`); add `clearScratchpadRun`. — DONE (committed)
3. `ScratchpadWorkspace.tsx` full-width editor pane with local draft state
   (method, url, headers, queryParams, bodyKind/bodyJson, formula, assertions),
   tab bar, Send → `ws.runScratchpad(...)`, Save → open picker, Close.
4. `ScratchpadSaveModal.tsx` location picker (name + collection/folder tree).
5. `AppShell.tsx`: render `<ScratchpadWorkspace>` full-width when open; close on
   sidebar request selection; remove `ScratchpadModal`.
6. CSS in globals.css for the scratchpad header/bar + picker tree.
7. Rewrite `frontend/e2e/scratchpad.spec.ts` for the new UI (editor tabs, send,
   save-to-location incl. nested folder).
8. Verify: `npx tsc --noEmit`, `npm test`, Playwright (scratchpad + regression
   request-tabs/nav-normal/request-duplicate/folder-drag-move/rename-f2); update
   docs; commit + push.

Testids to use: `scratchpad-workspace`, `scratchpad-method`, `scratchpad-url`,
`scratchpad-send`, `scratchpad-save`, `scratchpad-close`, tab prefix
`scratchpad-`, `scratchpad-save-name`, `scratchpad-save-confirm`,
`scratchpad-save-cancel`.

---

## Status

| # | Micro task | Status |
|---|------------|--------|
| M1 | CreateModal auto-detect cURL | done (pushed `e80c29c`) |
| M2 | URL-field cURL auto-parse | done (pushed `e61cc82`) |
| EXT | Ctrl+Enter sends request | done (this turn) |
| M3 | Dirty-state tracking | done (pushed `cb2451c`) |
| M4 | Dirty dot indicator | done (pushed `2ad35d2`) |
| M5 | Backend ephemeral run endpoint | done (pushed `d9c80b4`) |
| M6 | Send uses working copy | done (pushed `6dd891e`) |
| M7 | Tabs for opened requests | done (pushed `183d7ab`) |
| M8 | Test cURL without saving | done (pushed `75143f7`) |
| M9 | Docs + wrap-up | done (pushed `2d3ee16`) |
| M10 | Drag-and-drop move: request into folder/sub-folder | done (pushed `c7ac1f3`) |
| M11 | Duplicate request/folder via Ctrl+C | done (pushed `c7ac1f3`) |
| M12 | Rename focused item via F2 | done (this turn) |
| M13 | Drag-and-drop move: folder between nested folders | done (this turn) |
| M14 | Rework scratchpad: full-width editor + save location picker | done (pushed `edff412`) |
| M15 | Verify/fix pulled commit `7af6044` (Ctrl+Enter editors + formula helpers panel + admin Access tab) | done (this turn, pushed) |

## M14 — Rework scratchpad (done)

The M8 scratchpad modal was reworked into a full-width editor pane + a save
location picker (user decisions above):

- `ScratchpadWorkspace.tsx` — full-width editor pane in the main area: method
  select + URL input with cURL auto-parse (reuses `parseCurl`), tabs
  Params/Headers/Body/Formula/Tests, explicit **Send** (ephemeral — nothing
  saved) / **Save** / **Close** controls, response shown via `ResponsePane` in
  a split below. Local draft state (no WS store wiring); Send →
  `ws.runScratchpad(...)`; Save → open the picker.
- `ScratchpadSaveModal.tsx` — save-location picker: required name field (no
  silent auto-derive) + all collections in the current workspace with nested
  folders as an indented tree; on confirm →
  `contentApi.createRequest({collectionId,name,method,url,apiType,folderId})`
  then `contentApi.updateRequest(id, patch)` (headers, queryParams, bodyType,
  bodyJson/bodyText, formula, assertions), then `ws.reloadTree()` +
  `ws.selectRequest(id)`.
- `AppShell` renders `<ScratchpadWorkspace>` full-width instead of the modal
  and closes it on sidebar request selection; `ScratchpadModal.tsx` removed
  (`.scratchpad-preview` CSS dropped, `curl-input` kept).
- New shared lib `frontend/src/lib/scratchpadDraft.js`
  (`defaultScratchDraft`, `scratchDraftToRunInput`, `scratchDraftToServerPatch`).
- e2e `frontend/e2e/scratchpad.spec.ts` rewritten for the new UI (open editor,
  method/url, send → response shown + no request created; save → picker asks
  name, pick collection + nested folder → request appears at that folder).

## M15 — Verify/fix pulled remote commit `7af6044` (done)

The remote fast-forward `26189c9..7af6044` bundled "ctrl+enter sends request
from body/formula editors; formula helpers stop covering the edit pane" plus
the admin Access tab. Inspected it, then fixed three things:

- **`CodeEditor.tsx` runtime crash** — `extensionFor(language)` returns a single
  non-iterable `Extension`, so `...(extensionFor(language) as any[])` threw
  `extensionFor is not a function or its return value is not iterable` and
  body/formula editors never rendered. Fixed: `const baseExtensions =
  [extensionFor(language)]`.
- **`globals.css` formula-helpers panel** — helper was `flex-shrink: 0` with a
  `42vh` body cap, so on the ~220px formula tab it overflowed and covered the
  editor; the commit also targeted the nonexistent `.cm-theme` wrapper (real:
  `.cm-theme-dark`). Fixed: helper is `flex: 0 1 auto; max-height: 45%` with an
  internally-scrolling body; added `.cm-theme-dark` height rule so the editor
  fills the remaining space.
- **Stale backend** — restarted on :3001 so `/api/admin/access` grant/revoke
  routes load.

Verified: body + formula Ctrl+Enter each run the request exactly once (history
delta 1); admin Access tab renders and all grant/revoke endpoints work.
Backend jest 47/47, `test:api` 58/58, `test:api:unit` 49/49, frontend unit
68/68, `tsc --noEmit` clean. Key e2e specs pass standalone on a fresh
reset+seeded DB; the two full-suite failures (`send-working-copy`,
`assertions-runner`) are the documented pre-existing ordering issue (shared
mock-upstream + "Mock API Demo" mutation).
