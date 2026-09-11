#!/usr/bin/env bash
# Rebuild the whole MockShift tutorial video end to end.
#
# Requires: a running frontend on :3000, backend on :3001 and the mock upstream
# on :3999, plus ffmpeg/ffprobe and piper with the voice model in .voices/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> 1/4 preparing fixtures"
node fixtures.mjs

echo "==> 2/4 synthesizing narration"
node synth.mjs

echo "==> 3/4 recording segments"
node record.mjs

echo "==> 4/4 assembling video"
node assemble.mjs

echo "Done -> $DIR/out/mockshift-tutorial.mp4"
