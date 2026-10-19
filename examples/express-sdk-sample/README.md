# Express + mockshift-sdk sample

A small Express API whose routes sync into Mockshift as a project, collection,
nested folders and runnable requests. It exercises nested routers, so the
synced keys include the full mount path.

## Routes

| Method | Path |
| --- | --- |
| GET | `/health` |
| POST | `/api/v1/auth/login` |
| GET | `/api/v1/users` |
| POST | `/api/v1/users` |
| GET | `/api/v1/users/:userId` |
| GET | `/api/v1/orders` |
| GET | `/api/v1/orders/:orderId` |
| GET | `/api/v1/orders/:orderId/items` |

## Run it

1. In Mockshift, create an API token with the **SDK** scope bound to a project
   or workspace (Settings -> API tokens).
2. Copy `.env.example` to `.env` and fill in `MOCKSHIFT_API_KEY` plus
   `MOCKSHIFT_BASE_URL`.
3. Install and start:

```bash
npm install
node --env-file=.env src/server.js
```

On boot the SDK prints the discovered routes, then syncs them. Re-running the
app updates the same requests in place because the SDK keys them by
`METHOD /path`.

Set `SAMPLE_BASE_URL` to a URL Mockshift can reach (for local development a
preview/tunnel URL, or the deployed app) so the synced requests are runnable.
Without it the stored URLs point at `http://127.0.0.1:4100`, which only works
when Mockshift runs on the same machine.

`MOCKSHIFT_TIMEOUT_MS` defaults to `30000` here because a sync against a remote
instance with a managed database can take longer than the SDK's 5s
local-development default.

## Verify what synced

The sync response summarises created/updated folders and requests. You can also
open the project in the Mockshift UI, or check from the API:

```bash
curl -s "$MOCKSHIFT_BASE_URL/api/projects" -H "Authorization: Bearer $MOCKSHIFT_API_KEY"
```

`mockshift-sdk@0.3.1` is published, so `npm install` pulls it from the public
registry. See `E2E.md` for the recorded end-to-end run against a production
instance.
