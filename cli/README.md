# apihub-cli

Official command-line client for the API Hub. Browse workspaces, projects,
collections and requests, trigger server-side runs, and turn results into
CI-friendly JUnit or Markdown reports.

Zero runtime dependencies (Node.js >= 18, built-in `fetch` only).

## Install

```bash
npm link
# or
npm install -g /path/to/this/repo
```

Then run `apihub --help`.

## Quickstart

```bash
# 1. Authenticate (writes the token to ~/.config/apihub/config.json)
apihub login --base-url http://localhost:3001 --token tkh_xxx

# 2. Verify identity and pick a workspace
apihub whoami
apihub workspace list
apihub workspace use <workspaceId>   # becomes the default for list commands

# 3. Browse
apihub project list
apihub collection list
apihub request list --collection <collectionId>
apihub request show <requestId>

# 4. Run a stored request on the server
apihub run <requestId>               # exit 0 = PASSED, exit 1 = FAILED
apihub run <requestId> --json > run.json

# 5. Generate CI reports from the last run
apihub report junit <runId> -o junit.xml
apihub report markdown <runId> -o report.md
apihub report junit --from run.json -o junit.xml   # reuse a saved payload
```

## Commands

| Command | Description |
| --- | --- |
| `login` | Authenticate with `--token` (or interactively) and store credentials |
| `logout` | Remove the stored token for the current server |
| `whoami` | Show the authenticated user and token prefix |
| `workspace list` / `use <id>` | List workspaces; set the default workspace |
| `project list` / `create <name>` | List projects; create a project (see note) |
| `collection list` | List collections (per project or default workspace) |
| `request list` / `show <requestId>` | List or inspect stored requests |
| `run <requestId>` | Trigger a server-side run (`POST /api/runs`) |
| `ci run <requestId>` | Alias of `run` with CI-friendly output and exit codes |
| `report junit\|markdown <runId>` | Build a report from a stored run |
| `report junit\|markdown --from <file>` | Build a report from a saved `run --json` payload |

Notes:

- `run <requestId>` requires an API token with the `runs` or `write` scope.
  The run itself executes on the API Hub server, so stored credentials,
  environments and collection variables of the request owner apply.
- Run "passed" means the HTTP call returned and every enabled assertion
  passed. A request with no assertions passes if the server completed the
  run (`status: ok`).
- `project create` is implemented but the current API Hub backend exposes no
  create-project route (projects are created implicitly with workspaces), so
  it will fail until such a route exists.

## Global options

| Option | Env var | Meaning |
| --- | --- | --- |
| `--base-url <url>` | `APIHUB_BASE_URL` | Server URL (default `http://localhost:3001`) |
| `--token <token>` | `APIHUB_TOKEN` | Personal API token |
| `--json` | — | Raw JSON output for list/show/run |
| `--no-color` | `NO_COLOR` | Disable ANSI colors |

Credentials are resolved in this order: command-line flags, then
environment variables, then `~/.config/apihub/config.json` (only the entry
matching the current base URL).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success (including a run that PASSED) |
| 1 | The run FAILED, or an API/operational error occurred |
| 2 | Usage error or not authenticated |

This contract is what makes `apihub ci run` safe to gate a pipeline on.

## Configuration & security

- Config file: `~/.config/apihub/config.json` (created with mode `0600`;
  the directory is created with mode `0700`). Override the location with
  `APIHUB_CONFIG_DIR` (used by the test suite).
- The token is stored as-is (same value you pass to `--token`). Log out
  after use on a shared machine (`apihub logout`).
- Never paste tokens into scripts; use the CI secret mechanism instead (see
  `ci/`).

## Using in CI

See `ci/README.md` for ready-made GitHub Actions and GitLab CI examples:

```bash
apihub login --base-url "$BASE_URL" --token "$APIHUB_TOKEN"
apihub ci run "$REQUEST_ID"
apihub report junit --from latest-run.json -o junit.xml   # or report markdown
```

## Development

```bash
node --test "test/*.test.js"   # 58 unit tests, zero dependencies
```

Layout:

```
bin/apihub.js            executable entry point
lib/cli.js               dispatch, help, exit-code mapping
lib/commands/            auth, browse, run, reports
lib/report/              JUnit XML + Markdown builders
lib/{client,config,parser,format,session,runmeta}.js
test/                    node:test suites
```
