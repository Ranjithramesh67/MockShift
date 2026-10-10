# Live end-to-end suite

Browser + HTTP checks run against a live MockShift deployment (production by
default). The suite is intentionally self-contained: it drives the real UI with
Playwright and calls the real API, and it writes a machine-readable report to
`e2e-live/artifacts/`.

## Run

```bash
# full suite against the default (production) target
node e2e-live/run-all.cjs

# a subset of suites
E2E_ONLY=login,browser-run node e2e-live/run-all.cjs

# watch a suite in a real window (needs a display / xvfb)
E2E_HEADED=1 E2E_ONLY=functional node e2e-live/run-all.cjs
```

Exit code is `0` when every check passes, `1` when any check fails, `2` on a
fatal error. The last run is always written to
`e2e-live/artifacts/report.json` and `e2e-live/artifacts/report.md`.

## Configuration

Defaults target production. Copy `.env.example` to `.env.local` (gitignored) to
override the target, credentials, Chromium path, or ports.

```bash
cp e2e-live/.env.example e2e-live/.env.local
```

Credentials are never committed. If a password is unset, the suites that need it
report `warn` instead of failing, so the log currently shows an `unauthenticated`
warning until provided.

## Suites

| Suite | What it covers |
|---|---|
| `login` | Boss + superadmin UI login; malformed-credential regressions (401, not 500) |
| `routes` | Crawls every main-app and portal route; asserts no 5xx and no page errors |
| `admin` | `/admin` and `/superadmin` render for a superadmin |
| `functional` | Create + run a request, run appears in history, share link renders, scratchpad run |
| `browser-run` | "Run in browser" pipeline against a throwaway localhost service; LNA guidance message |
| `api-validation` | Malformed input returns clean 4xx (no leaked Postgres errors); new endpoints are auth-gated |
| `mobile` | 390px viewport has no horizontal overflow |

Requires `frontend/node_modules/playwright-core` and the Chromium build it
manages. Set `E2E_PW` / `E2E_CHROMIUM` if they live elsewhere.
