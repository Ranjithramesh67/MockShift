#!/usr/bin/env bash
# Demo of the apihub CLI against a live API Hub server.
# Fill in BASE_URL / TOKEN / REQUEST_ID below, then: bash scripts/demo.sh
set -euo pipefail

BASE_URL="${APIHUB_BASE_URL:-http://localhost:3001}"
TOKEN="${APIHUB_TOKEN:-tkh_xxx}"
REQUEST_ID="${REQUEST_ID:-00000000-0000-0000-0000-000000000000}"
TMPDIR="$(mktemp -d)"
# Artifacts stay in $TMPDIR (printed below); remove them by hand when done.

log() { printf '\n== %s ==\n' "$*"; }

log "login"
apihub login --base-url "$BASE_URL" --token "$TOKEN"

log "whoami"
apihub whoami

log "workspace list"
apihub workspace list

WS_ID="$(apihub workspace list --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).workspaces[0].id))")"
log "workspace use $WS_ID"
apihub workspace use "$WS_ID"

log "project list"
apihub project list

log "request list"
apihub request list

log "run request (exit code reflects PASS/FAIL)"
set +e
apihub run "$REQUEST_ID"
RUN_EXIT=$?
set -e
echo "run exit: $RUN_EXIT"

log "capture raw JSON for report generation"
apihub run "$REQUEST_ID" --json > "$TMPDIR/latest.json"

log "junit report"
apihub report junit --from "$TMPDIR/latest.json" -o "$TMPDIR/junit.xml"
cat "$TMPDIR/junit.xml"

log "markdown report"
apihub report markdown --from "$TMPDIR/latest.json" -o "$TMPDIR/report.md"
cat "$TMPDIR/report.md"

log "cleanup"
apihub logout

echo
echo "Done. Run exit code was $RUN_EXIT (0 = passed, 1 = failed)."
echo "Artifacts were written to $TMPDIR"
