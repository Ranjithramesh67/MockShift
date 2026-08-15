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

---

## Status

| # | Micro task | Status |
|---|------------|--------|
| M1 | CreateModal auto-detect cURL | done (pushed) |
| M2 | URL-field cURL auto-parse | pending |
| M3 | Dirty-state tracking | pending |
| M4 | Dirty dot indicator | pending |
| M5 | Backend ephemeral run endpoint | pending |
| M6 | Send uses working copy | pending |
| M7 | Tabs for opened requests | pending |
| M8 | Test cURL without saving | pending |
| M9 | Docs + wrap-up | pending |
