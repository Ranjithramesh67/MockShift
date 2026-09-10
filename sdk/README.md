# apihub-sdk

Sync the routes your Express app defines into [MockShift / API Hub](https://github.com/Ranjithramesh67/MockShift) as collections, nested folders and testable requests.

## Install

```bash
npm install apihub-sdk
```

## Quick start

```js
const express = require('express');
const { attach } = require('apihub-sdk');

const app = express();
const hub = attach(app, {
  apiKey: process.env.APIHUB_API_KEY, // a project- or workspace-bound key
  baseUrl: 'http://localhost:3001',
  collection: 'Backend',
  targetBaseUrl: 'http://localhost:4000',
  folder: (route) => route.path.split('/').filter(Boolean)[0] || 'Root',
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

hub.test('GET /users/:id', { status: 200, json: { 'id': '1' } });
// Syncs automatically when the server starts. You can also call `await hub.sync()`.
app.listen(4000);
```

## Configuration

| Option | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` | `APIHUB_API_KEY` | — | Project- or workspace-bound API key (required). |
| `baseUrl` | `APIHUB_BASE_URL` | `http://localhost:3001` | MockShift backend base URL. |
| `project` | `APIHUB_PROJECT` | — | Project name (required for a workspace-bound key). |
| `workspace` | `APIHUB_WORKSPACE` | — | Workspace name (informational). |
| `collection` | `APIHUB_COLLECTION` | project name | Collection to sync into. |
| `targetBaseUrl` | `APIHUB_TARGET_BASE_URL` | '' | Base URL prepended to each route path. |
| `folder` | — | first path segment | String or `(route) => 'A/B'` nested folder path. |
| `structure` | — | — | `{ '/users': 'Users', '/users/:id/posts': 'Users/Posts' }` longest-prefix map. |
| `include` / `exclude` | — | `[]` | Path prefixes to include/exclude. |
| `autoSync` | — | `true` | Sync once the server starts listening. |
| `prune` | — | `false` | Delete synced requests missing from the manifest. |
| `timeoutMs` | — | `5000` | HTTP timeout for a sync call. |

## CLI

```bash
# apihub.config.cjs must export a configured hub (see README)
npx apihub-sdk sync --config ./apihub.config.cjs
```
