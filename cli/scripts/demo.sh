#!/usr/bin/env bash
# Demo of the mockshift CLI against a live Mockshift server.
# Fill in BASE_URL / TOKEN / REQUEST_ID below, then: bash scripts/demo.sh
set -euo pipefail

BASE_URL="${MOCKSHIFT_BASE_URL:-http://localhost:3001}"
TOKEN="${MOCKSHIFT_TOKEN:-tkh_xxx}"
REQUEST_ID="${REQUEST_ID:-00000000-0000-0000-0000-000000000000}"
TMPDIR="$(mktemp -d)"
# Artifacts stay in $TMPDIR (printed below); remove them by hand when done.

log() { printf '\n== %s ==\n' "$*"; }

log "login"
mockshift login --base-url "$BASE_URL" --token "$TOKEN"

log "whoami"
mockshift whoami

log "workspace list"
mockshift workspace list

WS_ID="$(mockshift workspace list --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).workspaces[0].id))")"
log "workspace use $WS_ID"
mockshift workspace use "$WS_ID"

log "project list"
mockshift project list

log "request list"
mockshift request list

log "run request (exit code reflects PASS/FAIL)"
set +e
mockshift run "$REQUEST_ID"
RUN_EXIT=$?
set -e
echo "run exit: $RUN_EXIT"

log "capture raw JSON for report generation"
mockshift run "$REQUEST_ID" --json > "$TMPDIR/latest.json"

log "junit report"
mockshift report junit --from "$TMPDIR/latest.json" -o "$TMPDIR/junit.xml"
cat "$TMPDIR/junit.xml"

log "markdown report"
mockshift report markdown --from "$TMPDIR/latest.json" -o "$TMPDIR/report.md"
cat "$TMPDIR/report.md"

log "cleanup"
mockshift logout

echo
echo "Done. Run exit code was $RUN_EXIT (0 = passed, 1 = failed)."
echo "Artifacts were written to $TMPDIR"
