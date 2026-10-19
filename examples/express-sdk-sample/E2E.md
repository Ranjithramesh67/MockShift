# SDK end-to-end run against production

Date: 2026-10-19
Instance: `https://mockshift.keerainnovations.com`
SDK: `mockshift-sdk@0.3.1` (packed tarball), Express `4.22.3`

## What was exercised

1. Created an SDK-scoped token bound to the `My Workspace` workspace.
2. Booted this sample with that token. The SDK discovered **8 routes** through
   nested routers, including the parameterised mount
   `GET /api/v1/orders/:orderId/items`.
3. Synced the manifest (`POST /api/sdk/sync`, HTTP 201).
4. Verified the project, collection, folders and requests through the account
   API and the `sdk_sync_runs` table.
5. Executed a synced request from the account (`GET /health`).

## Evidence

Discovered routes:

```text
GET  /health
POST /api/v1/auth/login
GET  /api/v1/users
GET  /api/v1/users/:userId
POST /api/v1/users
GET  /api/v1/orders
GET  /api/v1/orders/:orderId
GET  /api/v1/orders/:orderId/items
```

First sync (create) and second sync (update), from `sdk_sync_runs.summary`:

```json
{"folders":{"created":2,"updated":0},"requests":{"pruned":0,"created":8,"updated":0},"collections":{"created":1}}
{"folders":{"created":0,"updated":0},"requests":{"pruned":0,"created":0,"updated":8},"collections":{"created":0}}
```

Stored tree: project `SDK E2E Sample` (workspace `My Workspace`), collection
`SDK E2E Collection`, folders `Api` and `Health`, 8 requests with no duplicate
keys. Re-syncing updated all 8 in place.

Runnable request executed from the account:

```json
{
  "runId": "4a131e75-e1f4-4fe9-b80d-7d729e3f993a",
  "runStatus": "SUCCESS",
  "httpStatus": 200,
  "body": "{\"ok\":true,\"service\":\"mockshift-sdk-sample\"}"
}
```

## Defects found and fixed

| ID | Symptom | Fix |
| --- | --- | --- |
| SDK-2 | A workspace/project-bound token got `403 API token is bound to a different project or workspace` on `POST /api/sdk/sync`. | `tokenAuth.js` exempts the targetless sync route from binding checks; the route validates the binding itself. |
| SDK-1 | Router index routes synced as `GET /api/v1/users/`, and `GET /api/v1/orders/:orderId/items` was dropped. | Adapter normalises trailing slashes and parses parameterised mount sources recursively. |
| DB-3 | `/api/projects/:projectId/content` returned an empty tree for the SDK project while its collection and 8 requests appeared in the sibling `Default Project`. | The route now scopes collections by `collections.project_id` and lists the project's owned plus legacy mirror workspaces. |

Regression cover: SDK adapter 51/51, API token binding 3/3, SDK sync 9/9, and
the full integration suite (338 tests; the 9 SDK sync cases require the
dedicated `apihub_sdk_test` database).

## Residual limitations

- The synced URLs must point at an address the Mockshift server can reach;
  `127.0.0.1` only works when both processes share a host. This run used a
  preview URL for the sample.
- `mockshift-sdk@0.3.1` is not on npm yet; install the packed tarball until a
  maintainer publishes it.
- Express 5 still cannot recover routers mounted before `attach()` because the
  framework no longer stores the mount path on the layer.
