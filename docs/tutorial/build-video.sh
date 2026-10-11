#!/usr/bin/env bash
# Rebuild the whole MockShift tutorial video end to end.
#
# Requires: a running frontend on :3000, backend on :3001 and the mock upstream
# on :3999, plus ffmpeg/ffprobe and piper with the voice model in .voices/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> 1/5 preparing fixtures"
node fixtures.mjs

echo "==> 2/5 synthesizing narration"
node synth.mjs

echo "==> 3/5 recording segments"
node record.mjs

echo "==> 4/5 generating music bed"
FORCE_MUSIC=1 node music.mjs

echo "==> 5/5 assembling video"
node assemble.mjs

VERSION="${TUTORIAL_VERSION:-v2}"
echo "Done -> $DIR/out/mockshift-tutorial-$VERSION.mp4 (copy: out/mockshift-tutorial.mp4)"
