# mockshift-sdk

Sync the routes your Express or Node HTTP app defines into [Mockshift](https://github.com/Ranjithramesh67/MockShift) as collections, nested folders and testable requests — then keep them fresh by observing real traffic.

The SDK can:

- **Discover routes** by wrapping an Express app (`attach(app)`) or a raw `http.Server` (`attachHttp(server)`).
- **Infer structure** from live traffic: request payloads, response bodies (JSON schema), status codes and timings.
- **Suggest assertions** (`status`, `jsonPath`, `responseTime`) in the Mockshift engine shape, without clobbering your explicit ones.
- **Suggest formulas** for dynamic fields (ids, timestamps, emails).
- **Collapse dynamic paths** — `/users/42` becomes `/users/:id` before syncing.
- **Honour include/exclude** prefixes and custom path rules.
- Read a portal-generated **`mockshift.json`** config file, so app code stays minimal.

## Install

```bash
npm install mockshift-sdk
```

Express is an optional peer dependency — only needed for `attach(app)`.

## Quick start

Generate an SDK config from the portal (Settings → API tokens → create a token with the **SDK** scope). It downloads a `mockshift.json`:

```json
{
  "token": "tkh_…",
  "baseUrl": "https://mockshift.example.com",
  "source": "express",
  "autoSync": true
}
```

Then attach:

```js
const express = require('express');
const { attach } = require('mockshift-sdk');

const app = express();
attach(app); // reads ./mockshift.json, registers routes, syncs on listen

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id, name: 'Ada' }));

app.listen(4000);
```

Traffic through `/users/42` teaches the SDK that the route returns
`{ id: number, name: string }`, and it suggests a `status == 200` assertion plus a
`jsonPath name == "Ada"` assertion on the next sync.

### Plain http.Server

```js
const http = require('http');
const { attachHttp } = require('mockshift-sdk');

const server = http.createServer(handler);
attachHttp(server, { apiKey: process.env.MOCKSHIFT_API_KEY });
server.listen(4000);
```

### Middleware only

```js
const hub = attach(app);        // or: const hub = createHub({ configFile: 'mockshift.json' })
app.use(hub.middleware());      // capture without patching app.listen
```

## Explicit assertions and formulas

```js
const hub = attach(app);
app.get('/users/:id', handler);

// Explicit assertions always win over inferred ones.
hub.test('GET /users/:id', { status: 200, json: { id: '1' }, responseTimeMs: 250 });

// A formula is a per-request JS snippet (see the Mockshift formula panel).
hub.register({ method: 'POST', path: '/users', formula: 'req.body.id = $utils.uuid()' });
```

## Configuration

Options passed to `attach` / `createHub` override env vars, which override the config file.

| Option | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` / `token` | `MOCKSHIFT_API_KEY` (legacy: `APIHUB_API_KEY`) | — | Project- or workspace-bound API key (required). |
| `configFile` | `MOCKSHIFT_CONFIG` | `mockshift.json` | Path to the portal-generated config. |
| `baseUrl` | `MOCKSHIFT_BASE_URL` | `http://localhost:3001` | Mockshift backend base URL. |
| `project` | `MOCKSHIFT_PROJECT` | — | Project name (required for a workspace-bound key). |
| `workspace` | `MOCKSHIFT_WORKSPACE` | — | Workspace name (informational). |
| `collection` | `MOCKSHIFT_COLLECTION` | project name | Collection to sync into. |
| `targetBaseUrl` | `MOCKSHIFT_TARGET_BASE_URL` | '' | Base URL prepended to each route path. |
| `include` / `exclude` | — | `[]` | Path prefixes to include/exclude. |
| `pathRules` | — | `[]` | `[{ pattern, replacement }]` applied before `:id` collapsing. |
| `capture` | — | `{ enabled: true, … }` | Runtime observation (`requestBodies`, `responseBodies`, `maxBodyBytes`). |
| `assertions` | — | `{ status: true, json: true }` | Inference knobs (`suggest: false` disables, `maxResponseTimeMs`, `maxTopLevelFields`). |
| `autoSync` | — | `true` | Sync once the server starts listening. |
| `prune` | — | `false` | Delete synced requests missing from the manifest. |
| `timeoutMs` | — | `5000` | HTTP timeout for a sync call. |

## CLI

```bash
# Sync from a config file (JSON or a JS module exporting a hub)
npx mockshift-sdk sync --config ./mockshift.json
```

## Programmatic sync

```js
const { createHub } = require('mockshift-sdk');
const hub = createHub({ configFile: 'mockshift.json' });

hub.register({ method: 'GET', path: '/health' });
await hub.sync();      // resolves with { summary, projectId, collectionId }
hub.inspect();          // the manifest, including inferred schemas
```
