# MockShift tutorial video

A narrated, full product tour of MockShift built with Playwright. The tour
follows three teammates with different access levels and shows what each one
can do:

| Chapter | Role | Covers |
| --- | --- | --- |
| Introduction | - | Sign-in screen and the pitch |
| Editor access | EDITOR | Collections, sending requests, responses, environments, mock server, plan limits |
| Manager access | MANAGER | Management console: overview, projects, teams, run history, limits |
| Administrator access | ADMIN | Users, creating users, access requests, platform settings |
| Recap | - | Closing summary |

Output: `out/mockshift-tutorial.mp4` (1920x1080, H.264 + AAC, chapter markers)
plus one `out/<segment>.srt` subtitle file per chapter.

## How it works

The pipeline is four independent stages, each writing into `.work/`:

1. **`fixtures.mjs`** - logs in as each seeded user over the real API and
   idempotently creates the demo data (collection, requests, environments,
   mock server + scenario). Writes `.work/fixtures.json`. Nothing is deleted.
2. **`synth.mjs`** - synthesizes each scene's narration to a WAV with Piper
   and records its duration in `.work/narration.json`.
3. **`record.mjs`** - drives Playwright per segment, writes
   `.work/video/<segment>.webm` and `.work/timings.json` mapping every scene
   to its wall-clock start offset.
4. **`assemble.mjs`** - places each narration WAV at its recorded offset,
   burns in subtitles, concatenates the segments and adds chapter markers to
   `out/mockshift-tutorial.mp4`.

`script.mjs` is the single source of truth for the content: it defines the
`LOGIN` accounts and, for every segment and scene, the narration text plus the
Playwright actions that play while it is spoken. `lib/harness.mjs` injects the
visible cursor, click ripples, focus rings and captions into the recording.

## One-shot rebuild

With the frontend, backend and mock upstream already running:

```bash
./build-video.sh
```

## Prerequisites

- `ffmpeg` and `ffprobe` on `PATH`.
- `piper` on `PATH` (`pip install piper-tts`), with the voice model at
  `.voices/en_US-lessac-medium.onnx` (and `.onnx.json`). Download from the
  [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) repository,
  or point `PIPER_VOICE` at another model.
- Playwright's chromium available to the frontend install. The recorder loads
  it from `frontend/node_modules/playwright` by default.
- A seeded backend (see `backend/scripts/seed-dev.js`) and the mock upstream
  running on `:3999`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1:3000` | Frontend origin used by fixtures and the recorder. |
| `MOCK_UPSTREAM_BASE` | `http://127.0.0.1:3999` | Upstream echoed into the demo requests and environment. |
| `PLAYWRIGHT_PATH` | `/workspace/frontend/node_modules/playwright` | Playwright module to load. |
| `PIPER_VOICE` | `.voices/en_US-lessac-medium.onnx` | Piper voice model. |
| `SEGMENT` | *(empty = all)* | Record a single segment, e.g. `SEGMENT=editor node record.mjs`. |

## Re-recording one segment

After editing a scene in `script.mjs`, re-synthesize and re-record just the
affected part, then reassemble:

```bash
node synth.mjs
SEGMENT=manager node record.mjs
node assemble.mjs
```

`record.mjs` merges the single segment's timings into the existing
`.work/timings.json`, so the other segments are reused as recorded.

## Notes

- Playwright's `recordVideo` only emits frames when the page changes, so purely
  static screens would otherwise be truncated. `assemble.mjs` therefore pads
  each segment with cloned frames (`tpad=stop_mode=clone`) up to its target
  length before muxing.
- `.work/`, `.voices/` and `out/` are gitignored; only the scripts and this
  README are tracked.
