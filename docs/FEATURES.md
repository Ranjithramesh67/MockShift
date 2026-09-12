# API Hub / MockShift - Complete Feature Guide

This document describes every user-facing and programmatic feature in the
repository, how the pieces fit together, and which parts are incomplete. It is
written for both operators and contributors.

- Backend: Express API on port 3001 (`backend/src/api`)
- Frontend: Next.js 14 app on port 3000 (`frontend`)
- Database: PostgreSQL 15 (`apihub`) + Redis/BullMQ + isolated-vm
- Portal A/B: separate app under `portal/` (backend 3102, frontend 3002)
- SDK: `apihub-sdk` package under `sdk/`

The frontend reverse-proxies `/api/*` and `/mock/*` to the backend via
`frontend/next.config.mjs`, so a browser only ever talks to one origin.

---

## 1. Getting started

### 1.1 Accounts and authentication

| Feature | Endpoint | Notes |
| --- | --- | --- |
| Create account | `POST /api/auth/signup` | Nested response: `user.user.id`. Gated by `ALLOW_SELF_SIGNUP`. |
| Signup availability | `GET /api/auth/signup-status` | Tells the login page whether self-signup is open. |
| Log in | `POST /api/auth/login` | Sets the `ah.session` cookie (HMAC-signed). |
| Log out | `POST /api/auth/logout` | Clears the session cookie. |
| Current user | `GET /api/auth/me` | Requires auth; returns the full user record. |
| Session probe | `GET /api/auth/session` | Lightweight "am I logged in" check. |
| Change password | `POST /api/profile/password` | Requires the current password. |

Two authentication modes are accepted by `requireAuth`
(`backend/src/api/access.js`):

1. **Browser session** - the `ah.session` cookie.
2. **Bearer API token** - `Authorization: Bearer tkh_...`, used by scripts, CI
   and the SDK. See section 12.

### 1.2 Identity, organizations and roles

A user always belongs to at least one **organization**. New accounts join a
company organization (matched by email domain) when one exists, otherwise a
personal organization is created. Organization membership determines the base
role used across the app.

Role hierarchy (`ROLE_RANK` in `backend/src/api/access.js`):

```
ADMIN (4) > MANAGER (3) > EDITOR (2) > VIEWER (1)
```

- `ADMIN` - full control of the organization, including admin panel.
- `MANAGER` - can review access requests, manage members, use `/manage`.
- `EDITOR` - can create and edit requests, collections, docs, mocks, etc.
- `VIEWER` - read-only.
- `SUPPORT` exists in the role enum (migrations 001/003/013) but is not ranked
  in `ROLE_RANK`; treat it as a non-privileged label.

Workspace and project membership layer on top of the organization role, so a
user's effective permission is the maximum of their org role and their
per-resource role.

> **Gap:** there is no password reset / "forgot password" flow anywhere in the
> backend, frontend or portal. Recovery currently requires an admin action.

---

## 2. Navigation and configurable menus

The app is a single shell (`frontend/src/components/AppShell.tsx`) whose view is
selected from the pathname in `frontend/src/components/RouteViewSync.tsx`.
Menu visibility is driven by `MenuAccessStore.tsx`, which reads
`GET /api/menu-access`.

Configurable menu keys (admin panel > Menus tab):

```
teams, automations, history, docs, contracts, monitors,
mock-scenarios, copilot, collab, manage
```

- `apis` and `admin` are **never** toggleable.
- Overrides are scoped to `org` or `project`; a project override wins over an
  org override, and no row means "enabled".
- Disabling a menu hides it in the sidebar **and** makes the backend return
  `403 { error, code: "menu_disabled" }` from that feature's routes.
- The frontend fails open (it renders), but the backend always enforces.

Admin endpoints: `GET/PUT /api/admin/menus`, `DELETE /api/admin/menus/:id`.

Frontend routes:

| Path | View |
| --- | --- |
| `/` | Workspace / API editor |
| `/login`, `/signup` | Auth pages |
| `/profile` | Profile (incl. LLM config) |
| `/admin` | Admin panel |
| `/automations` | Automations |
| `/history` | Run history |
| `/inbox` | Send-item inbox |
| `/manage` | Manager console |
| `/settings/api-tokens` | API tokens |
| `/contracts` | Contract testing |
| `/monitors` | Monitors |
| `/mock-scenarios` | Mock scenarios |
| `/docs`, `/collab`, `/s/...` | Docs, collaboration, public shares |

---

## 3. Workspaces, projects and API collections

### 3.1 Core hierarchy

```
Organization
  └── Workspace
        └── Project
              └── Collection
                    └── Folder (nestable)
                          └── API request
```

- `Workspace` - top-level container. Has members, teams, environments, settings.
- `Project` - belongs to a workspace; owns collections and a mock server.
- `Collection` - a group of requests; can be imported/exported, reviewed and
  versioned.
- `Folder` - nestable grouping with `parent_id` and optional `external_key` for
  SDK sync.
- `API request` - method, URL, headers, query params, body, assertions, auth.

Endpoints:

| Action | Endpoint |
| --- | --- |
| List/create workspaces | `GET /api/workspaces`, `POST /api/workspaces` |
| Rename/delete workspace | `PATCH /api/workspaces/:workspaceId`, `DELETE ...` |
| Workspace settings | `GET/PATCH /api/workspaces/:workspaceId/settings` |
| Workspace teams | `GET/POST /api/workspaces/:workspaceId/teams`, `DELETE .../:teamId` |
| Workspace content tree | `GET /api/workspaces/:workspaceId/content` |
| Create collection | `POST /api/collections` |
| Delete collection | `DELETE /api/collections/:collectionId` |
| Run whole collection | `POST /api/collections/:collectionId/run` |
| Collection auth provider | `GET/PUT/POST .../auth-provider[/test]` |
| Create folder | `POST /api/folders` |
| Rename/move/delete folder | `PUT/DELETE /api/folders/:folderId` |
| Duplicate folder | `POST /api/folders/:folderId/duplicate` |
| Create request | `POST /api/requests` |
| Read/update/delete request | `GET/PUT/DELETE /api/requests/:requestId` |
| Duplicate request | `POST /api/requests/:requestId/duplicate` |
| Run a request | `POST /api/requests/:requestId/run` or `POST /api/runs` |

### 3.2 Request execution

Requests can be executed server-side so secrets never reach the browser. The
engine:

- Resolves variables from the request's environment, then applies per-run
  `variables` overrides.
- Supports response assertions (status, JSON, headers, etc.), evaluated in the
  isolated-vm sandbox where dynamic evaluation is required.
- Redacts credentials from response snapshots before returning them.
- Records every execution as a run (section 3.5).

Canonical machine endpoint: `POST /api/runs` with a `runs` or `write` scoped
API token, or a browser session. Documented in `api/openapi.json`.

### 3.3 Environments and variables

- `GET/POST /api/workspaces/:workspaceId/environments`
- `PATCH/DELETE /api/environments/:environmentId`
- `GET/POST /api/environments/:environmentId/variables`
- `DELETE /api/environments/:environmentId/variables/:variableId`

Variables are namespaced per environment (for example `dev`, `staging`,
`prod`) and are substituted at run time.

### 3.4 Import and export

- `GET /api/collections/:collectionId/export` - export a collection (OpenAPI /
  Postman-style interchange).
- `POST /api/collections/import` - import a collection.
- Contract endpoints also import and validate OpenAPI documents (section 6).

### 3.5 History and versions

- `GET /api/history`, `GET /api/history/:runId` - every recorded run, gated by
  the `history` menu.
- `GET /api/versions`, `GET /api/versions/diff`, `GET /api/versions/:versionId`,
  `POST /api/versions` - snapshot and diff request/collection versions, gated by
  the `collab` menu.

---

## 4. Documentation and public sharing

Docs are rich pages built from blocks, with mentions that can reference API
content.

| Feature | Endpoint |
| --- | --- |
| List/create pages | `GET /api/docs`, `POST /api/docs` |
| Read/update/delete page | `GET/PUT/DELETE /api/docs/:pageId` |
| Replace page blocks | `PUT /api/docs/:pageId/blocks` |
| Export page | `GET /api/docs/:pageId/export` |
| Usage stats | `GET /api/docs/usage` |
| Shared-to-me pages | `GET /api/docs/shared` |
| Public OpenAPI reference | `GET /api/docs/api-reference` (public) |
| Add/remove mentions | `POST /api/docs/:pageId/mentions`, `DELETE .../:mentionId` |
| Share a page | `POST/DELETE /api/docs/:pageId/share` |
| Per-user shares | `GET/POST/DELETE /api/docs/:pageId/shares[/:shareId]` |

Public docs assets are served from `/api/docs/public/*`, mounted **before** the
auth middleware in `backend/src/api/server.js`.

`api/openapi.json` is a hand-authored OpenAPI 3.0.3 document served at
`GET /api/docs/api-reference` and used by the Contracts feature. It currently
documents the machine API (runs, tokens, sends, profile); it does **not** yet
list the SDK or copilot endpoints.

---

## 5. Collaboration

Gated by the `collab` menu.

- **Comments** - `GET/POST /api/comments`, `POST /api/comments/:commentId/resolve`,
  `POST /api/comments/:commentId/unresolve`, `DELETE /api/comments/:commentId`.
- **Reviews** - `GET /api/reviews`,
  `GET /api/reviews/collections/:collectionId/status`, `POST /api/reviews`,
  `POST /api/reviews/:reviewId/decision`.
- **Versions** - see section 3.5.

Review decisions generate notifications for the affected users.

---

## 6. Contract testing

Gated by the `contracts` menu.

| Feature | Endpoint |
| --- | --- |
| List specs | `GET /api/contracts` |
| Import a spec | `POST /api/contracts/import` |
| Diff versions | `POST /api/contracts/diff` |
| Validate a spec | `POST /api/contracts/validate` |
| List/create checks | `GET/POST /api/contracts/checks` |
| Delete check | `DELETE /api/contracts/checks/:checkId` |
| Validate a request against a spec | `POST /api/contracts/validate-request` |
| List operations | `GET /api/contracts/:specId/operations` |
| Read spec | `GET /api/contracts/:specId` |

The OpenAPI parser/primitives live in `backend/src/api/openapi.js`.

---

## 7. Monitors

Gated by the `monitors` menu. Monitors run checks on a schedule started by
`startMonitorScheduler` (`backend/src/api/server.js`).

- `GET/POST /api/monitors`
- `GET /api/monitors/:monitorId`, `PATCH/DELETE /api/monitors/:monitorId`
- `GET /api/monitors/:monitorId/results`
- `POST /api/monitors/:monitorId/check` (manual run)

---

## 8. Mock servers and scenarios

### 8.1 Mock server

- `GET/POST /api/projects/:projectId/mock-server`
- `PATCH/DELETE /api/mock-servers/:id`
- `GET/POST /api/mock-servers/:id/routes`
- `PATCH/DELETE /api/mock-routes/:id`

Public mock traffic is served at `/mock/:projectId/*` with **no auth**, so
external clients can hit a mock URL. The frontend proxies `/mock/*` through its
Next server.

### 8.2 Mock scenarios

Gated by the `mock-scenarios` menu. Scenarios provide alternative route
responses, including sequenced responses and call-log replay.

- `GET/POST /api/mock-scenarios`, `PATCH/DELETE /api/mock-scenarios/:id`
- `GET /api/mock-scenarios/links`
- `GET/POST /api/mock-routes/:routeId/responses`
- `PATCH/DELETE /api/mock-responses/:id`
- `POST /api/mock-routes/:routeId/sequence/reset`
- `GET /api/mock-call-logs`, `DELETE /api/mock-call-logs`
- `POST /api/mock-call-logs/:id/replay`

---

## 9. Automations and workflows

Gated by the `automations` menu. Schedules are loaded at boot by
`syncAllSchedules`.

**Automations**

- `GET/POST /api/automations`
- `GET/PATCH/DELETE /api/automations/:automationId`
- `GET /api/automations/:automationId/runs`
- `POST /api/automations/:automationId/trigger`

**Workflows** (multi-step chains)

- `POST/GET /api/workflows`, `GET/PUT/DELETE /api/workflows/:workflowId`
- `POST /api/workflows/:workflowId/run`
- `GET /api/workflows/:workflowId/runs`

---

## 10. AI Copilot (bring your own LLM)

Gated by the `copilot` menu. AI features always use a bring-your-own-key model
configuration; the platform never supplies its own key.

Endpoints:

- `GET /api/copilot/status` - reports whether AI is configured and from which
  source (`env` or `user`).
- `POST /api/copilot/generate-assertions` - suggest assertions for a response.
- `POST /api/copilot/explain-run` - explain a failed run.
- `POST /api/copilot/generate-docs` - draft documentation from content.

### 10.1 Per-user key configuration

- Only available when an admin enables it globally:
  `GET/PUT /api/admin/settings/individual-llm` toggles
  `portal_settings.allow_individual_llm` (default **false**).
- When enabled, a user configures their own key via the Profile page:
  `GET/PUT/DELETE /api/profile/llm`.
- Keys are encrypted at rest with `pgp_sym_encrypt(key, app.vault_key())` in
  `user_llm_configs` and are never returned, logged, or stored in
  `ai_copilot_usage`.
- Resolution order (`backend/src/api/llm.js`): user config (only when the
  global toggle is on) else environment variables (`USER_LLM_*`). The copilot
  never consults platform-internal `MCAI_*` / `OPENAI_API_KEY` variables.

---

## 11. Notifications

- `GET /api/notifications` - list the current user's notifications (the bell in
  the top bar).
- `POST /api/notifications/:notificationId/read`
- `POST /api/notifications/read-all`

Notifications are created on events such as review decisions and access-request
decisions.

---

## 12. API tokens and programmatic access

Manage tokens under Settings > API tokens (`frontend/app/settings`). Backend
routes are in `backend/src/api/routes/tokens.js`.

- `GET /api/tokens` - list your tokens (never returns secrets).
- `POST /api/tokens` - create a token. The secret (`tkh_...`) is returned
  **once only**.
- `DELETE /api/tokens/:id` - revoke a token.

Token properties:

| Property | Detail |
| --- | --- |
| Secret format | `tkh_` + 24 random bytes (hex); only the SHA-256 hash is stored. |
| Displayed prefix | First 12 characters. |
| Scopes | Subset of `read`, `write`, `runs`, `sdk` (default `read`). |
| Binding | Optional `projectId` **or** `workspaceId` (not both). |
| Expiry | Optional ISO date, must be in the future. |
| Status | `active` / revoked. `last_used_at` is tracked. |

Binding rules:

- Project-bound tokens require the creator to have `EDITOR`+ on that project.
- Workspace-bound tokens require workspace write access.
- Unbound (personal) tokens can run requests and sync the SDK with an explicit
  `projectId` the user can edit.

Token auth is implemented in `backend/src/api/tokenAuth.js` and is accepted by
`requireAuth` as a Bearer fallback.

---

## 13. SDK (`apihub-sdk`)

Full details are in `docs/SDK.md`. Summary:

- Syncs the routes an Express app defines into API Hub as collections, nested
  folders and testable requests.
- `POST /api/sdk/sync` (Bearer token with `sdk` or `write` scope) accepts a
  manifest and upserts folders/requests by `external_key`, so repeat syncs
  update in place. `prune: true` removes synced requests missing from the
  manifest.
- Every sync is recorded in `sdk_sync_runs`.
- Works with project-bound keys, workspace-bound keys (auto-creates the
  project/collection), or an explicit `projectId` on an unbound token.
- Respects plan count gates (`projects`, `collections`, `api_requests`).
- Local assertions can be attached with `hub.test(...)`.

SDK package files: `sdk/src/{client,config,manifest,folders,assertions,cli,index,errors}.js`,
`sdk/src/adapters/express.js`, TypeScript types in `sdk/src/index.d.ts`.
Backend: `backend/src/api/routes/sdk.js`, `backend/src/api/sdkManifest.js`,
migration `db/migrations/037_sdk_sync.sql`.

---

## 14. Teams, sharing and access management

### 14.1 Teams

Gated by the `teams` menu.

- `GET/POST /api/teams`, `DELETE /api/teams/:teamId`
- `GET /api/teams/groups`
- `GET/POST /api/teams/:teamId/members`, `PATCH/DELETE .../:userId`
- `GET /api/teams/:teamId/org-users`

### 14.2 Project and workspace membership

- Project members: `GET/POST /api/projects/:projectId/members`,
  `PATCH/DELETE /api/projects/:projectId/members/:userId`,
  `GET /api/projects/:projectId/org-users`.
- Admin variants: `POST/DELETE /api/admin/projects/:projectId/members[/:userId]`,
  `POST/DELETE /api/admin/projects/:projectId/managers[/:userId]`,
  `POST/DELETE /api/admin/workspaces/:workspaceId/members[/:userId]`.
- Manager console variants: `POST/DELETE /api/manage/projects/:projectId/managers[/:userId]`.

### 14.3 Request sharing

- `POST /api/requests/:requestId/share` - create a share token.
- `GET /api/shares/:token` - read a shared request (token in URL).
- `DELETE /api/shares/:token` - revoke.

### 14.4 Public webhooks

`POST /api/webhooks/:token` is mounted before auth, allowing external systems to
trigger configured actions with a secret token.

---

## 15. Access requests and the inbox (important distinction)

There are **three separate systems** that are easy to confuse:

```
Project access request    -> access_requests            (request via /inbox or workspace UI; review in /manage)
Workspace access request  -> workspace_access_requests  (request from the workspace switcher; review in /manage)
Send item ("inbox")       -> sends                      (/inbox Received / Sent tabs)
```

Access requests and send items share the `/inbox` page but are different tabs:
the **Requests** tab tracks the caller's own access requests (project and
workspace, cancellable while pending), while **Received** / **Sent** track the
peer-to-peer send-item handshake.

### 15.1 Project access requests

A user who cannot access a project requests a role on it.

- **Request**: `POST /api/projects/:projectId/access-requests`
  (`{ role?, reason? }`). One pending request per `(project_id, user_id)`.
- **List**: `GET /api/projects/:projectId/access-requests` (project managers).
- **Mine**: `GET /api/access-requests/mine` - the requester's own requests.
- **Review queue**: `GET /api/manage/access-requests` (global MANAGER/ADMIN).
- **Decision**: `POST /api/manage/access-requests/:requestId/review`
  (`{ approve, role? }`).
- **Cancel**: `POST /api/projects/:projectId/access-requests/:requestId/cancel`
  (creator only, `PENDING` only). Returns `200`; `404` when the row is missing
  or belongs to someone else; `409` when the request is not `PENDING`. Sets
  `status = 'CANCELLED'` and audit-logs `cancel`.
- **Re-request (reopen)**: if a row already exists in a non-pending state,
  `POST` reopens it (`status = 'PENDING'`, `reviewed_by`/`reviewed_at` cleared),
  audit-logs `request_access` with `{ reopened: true }`, and re-notifies
  reviewers.
- **Reviewer notifications**: both the fresh-INSERT and reopen branches call
  `notifyUsers` for the project's reviewers (platform admins + assigned
  managers, resolved via `projectReviewerIds`) with `kind: 'request'` and a
  `/manage?tab=requests` deep link.
- Creation UI: the workspace sidebar plus an "API mention" chip in Docs.
- Review UI: the Manage console at `/manage`.
- Table columns: `id, project_id, user_id, role (default VIEWER), reason,
  status (PENDING|APPROVED|DENIED|CANCELLED), requested_at, reviewed_by,
  reviewed_at`, with `UNIQUE(project_id, user_id)`.

### 15.2 Workspace access requests

- `POST /api/docs/workspace-access-requests` (`{ workspaceId, reason? }`)
- `GET /api/docs/workspace-access-requests?workspaceId=<uuid>[&mine=1][&status=PENDING]`
- `POST /api/docs/workspace-access-requests/:id/review` (`{ approve }`)
- `POST /api/docs/workspace-access-requests/:id/cancel` (creator only)
- **Manage queue**: `GET /api/manage/workspace-access-requests` lists every
  workspace request (platform MANAGER/ADMIN, or the workspace's admins via
  `workspaceAccessFor`); `POST /api/manage/workspace-access-requests/:requestId/review`
  (`{ approve }`) decides it. Both are surfaced in the unified Manage Access
  requests tab (`/manage?tab=requests`).
- **Reviewer notifications**: creation calls `notifyUsers` for the workspace's
  reviewers (platform admins + workspace admins, resolved via
  `workspaceReviewerIds`) with `kind: 'request'` and a
  `/manage?tab=requests` deep link. Decisions notify the requester.
- **Creation UI**: the workspace switcher shows a "Request access" action on
  chips for workspaces the caller is not a member of, opening a reason modal
  that calls `docsSharedApi.requestWorkspaceAccess`.
- **Requester visibility**: the `/inbox` **Requests** tab lists the caller's
  own project and workspace requests and lets them cancel pending ones.
- Non-terminal status is `PENDING`; a decision sets `APPROVED` or `DENIED`,
  and a creator cancel sets `CANCELLED` (`status` accepts
  `PENDING|APPROVED|DENIED|CANCELLED`). Creation and cancel are audit-logged
  (`request_access`, `cancel`); decisions are audit-logged by the reviewer.

### 15.3 The inbox: send items and access requests

`/inbox` (`frontend/src/components/InboxView.tsx`) has three tabs. **Received**
and **Sent** display **send items**, a peer-to-peer sharing handshake:

- `POST /api/sends` - send an item to a recipient.
- `GET /api/sends/inbox` - items sent to me.
- `GET /api/sends/outbox` - items I sent.
- `GET /api/sends/recipients` - candidate recipients.
- `POST /api/sends/:sendId/accept`, `POST /api/sends/:sendId/reject`.

The third tab, **Requests**, is where a user tracks their own access requests
(both project and workspace). It merges `accessRequestApi.mine()` with
`docsSharedApi.listWorkspaceRequests({ mine: true })` via `mergeMyRequests`
and offers a cancel action while a request is `PENDING`. Send items and access
requests remain distinct systems - they only share this page - so use the tab
name, not the page, to disambiguate.

Notifications are separate again: the top-bar bell surfaces them, and each
notification's `link` is followed as a deep link (for example
`/manage?tab=requests` for reviewer notifications, `/inbox?tab=requests` for
requester decisions). Bell rows style the `request` and `send` kinds.

---

## 16. Admin panel and governance

Reachable at `/admin`; the `/api/admin` router is protected by
`requireAuth` + `requireAdmin`.

| Area | Endpoints |
| --- | --- |
| Access overview | `GET /api/admin/access` |
| Users | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:userId` |
| Menu settings | `GET/PUT /api/admin/menus`, `DELETE /api/admin/menus/:id` |
| Individual LLM toggle | `GET/PUT /api/admin/settings/individual-llm` |
| Membership admin | see section 14.2 |

### 16.1 Manager console (`/manage`)

Gated by the `manage` menu and manager/admin role.

- `GET /api/manage/overview`, `GET /api/manage/users`,
  `GET /api/manage/projects`, `GET /api/manage/projects/:projectId`
- Access request review: `GET /api/manage/access-requests`,
  `POST /api/manage/access-requests/:requestId/review`
- Teams: `GET /api/manage/teams`
- Governance: `GET /api/manage/audit-logs`, `GET /api/manage/history`

### 16.2 Retention

A retention scheduler (`startRetentionScheduler`) runs in the backend process
and trims records according to configured retention policy.

---

## 17. Plans and entitlements

Plans are catalog rows in `plans`; an organization's covering plan is its newest
non-terminal subscription. Plan-less accounts fall back to the Free plan.
Enterprise plans are never limited. Entitlements are defined in
`backend/src/api/entitlements.js`.

Canonical limit keys:

```
workspaces, projects, collections, teams, seats, storage_mb,
runs_per_month, public_sharing, api_requests, mock_servers, doc_pages
```

- Enforcement requires the global `portal_settings.restrictions_enforced` flag
  **and** a plan without `enforce: false`.
- Over-limit calls return `403` with `{ error, code: "plan_limit", key, limit,
  usage, upgrade: true }`.
- Run counts use calendar-month buckets in `plan_usage`.
- Free fallback defaults include `workspaces: 1`, `projects: 1`, `seats: 1`,
  `api_requests: 50`, `mock_servers: 1`, `doc_pages: 20`, `storage_mb: 200`;
  collections, teams and runs-per-month default to unlimited.

The SDK sync path checks the `projects`, `collections` and `api_requests`
gates.

---

## 18. Profile and settings

- `GET/PATCH /api/profile` - name, username and other account fields.
- `GET /api/profile/usage` - usage against plan limits.
- `GET/POST /api/profile/avatar` - avatar upload/read.
- `POST /api/profile/password` - change password.
- `GET/PUT/DELETE /api/profile/llm` - personal LLM configuration.
- Settings > API tokens - token management (section 12).

---

## 19. Permission matrix

| Capability | ADMIN | MANAGER | EDITOR | VIEWER |
| --- | --- | --- | --- | --- |
| Edit requests/collections | yes | yes | yes | no |
| Run requests | yes | yes | yes | yes |
| Review access requests | yes | yes | no | no |
| Manage members | yes | yes | no | no |
| Use `/manage` | yes | yes | no | no |
| Admin panel | yes | no | no | no |
| Toggle menus / LLM policy | yes | no | no | no |

Menu gating is independent of role: a disabled menu returns `menu_disabled`
even to admins (except `apis`/`admin`, which cannot be disabled).

---

## 20. Endpoint reference

All paths are relative to the backend base URL (`http://localhost:3001`).
`public` means mounted before auth.

### Auth - `/api/auth`

```
POST   /signup                GET  /signup-status
POST   /login                 POST /logout
GET    /me                    GET  /session
```

### Runs and history

```
POST   /api/runs              POST /api/requests/:requestId/run
POST   /api/collections/:collectionId/run
GET    /api/history           GET  /api/history/:runId
```

### Tokens

```
GET    /api/tokens            POST /api/tokens
DELETE /api/tokens/:id
```

### SDK

```
POST   /api/sdk/sync
```

### Sends (inbox)

```
POST   /api/sends
GET    /api/sends/inbox       GET  /api/sends/outbox
GET    /api/sends/recipients
POST   /api/sends/:sendId/accept
POST   /api/sends/:sendId/reject
```

### Notifications

```
GET    /api/notifications
POST   /api/notifications/:notificationId/read
POST   /api/notifications/read-all
```

### Access requests

```
POST   /api/projects/:projectId/access-requests
GET    /api/projects/:projectId/access-requests
POST   /api/projects/:projectId/access-requests/:requestId/cancel
GET    /api/access-requests/mine
GET    /api/manage/access-requests
POST   /api/manage/access-requests/:requestId/review
GET    /api/manage/workspace-access-requests
POST   /api/manage/workspace-access-requests/:requestId/review
POST   /api/docs/workspace-access-requests
GET    /api/docs/workspace-access-requests
POST   /api/docs/workspace-access-requests/:id/review
POST   /api/docs/workspace-access-requests/:id/cancel
```

### Docs, menus, admin, LLM

```
GET    /api/docs              POST /api/docs
GET    /api/docs/api-reference            (public)
GET    /api/docs/:pageId      PUT / DELETE
GET    /api/menu-access
GET    /api/admin/menus       PUT / DELETE
GET    /api/admin/settings/individual-llm
PUT    /api/admin/settings/individual-llm
GET/PUT/DELETE /api/profile/llm
```

### Mock (public)

```
ANY    /mock/:projectId/*
POST   /api/webhooks/:token               (public)
```

---

## 21. Known gaps and not-implemented features

1. **No password reset / forgot-password** flow anywhere.
2. **`/inbox` does not surface notifications** - it now has a Requests tab for
   the caller's own access requests, but notifications remain in the top-bar
   bell.
3. **`api/openapi.json` is partial** - it documents the machine API but omits
   SDK and copilot endpoints.
4. **SDK plan checkboxes are unticked** in
   `docs/superpowers/plans/2026-09-10-apihub-sdk-route-sync.md` even though the
   implementation exists; the plan document was not updated.
5. **`SUPPORT` role** exists in the enum but has no rank or dedicated behavior.
6. **Portal A/B** (`portal/`) is separate and its backend is not part of the
   main dev startup; it can drift from the main app.
7. The doc claim in `sdk/README.md` that the SDK auto-syncs on
   `app.listen` breaks if the app uses `app.all(...)` before attach - see
   `docs/SDK.md` for the workaround.

---

## 22. Testing

- Backend unit tests: `cd backend && npm run test:api:unit`
- Frontend unit tests: `cd frontend && npm test`
- Frontend typecheck: `cd frontend && npx tsc --noEmit`
- Targeted integration test:

```bash
PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub \
  ALLOW_SELF_SIGNUP=1 node --test tests/<spec>.test.cjs
```

Integration suites recreate the schema, re-apply `db/migrations/*.sql` in sorted
order and set `portal_settings.restrictions_enforced = false`. Do not point them
at the shared dev database on 5432.
