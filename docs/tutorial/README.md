# MockShift tutorial video

A narrated, full product tour of MockShift built with Playwright. The tour
follows three teammates with different access levels and visits every rail:

| Chapter | Role | Covers |
| --- | --- | --- |
| Introduction | - | Sign-in screen and the pitch |
| Editor access | EDITOR | Collections, sending requests, responses, environments, mock server + scenarios, contracts, monitors, automations, docs, collaboration, history, copilot, teams |
| Manager access | MANAGER | Management console: overview, projects, teams, access requests, audit log, run history, settings |
| Administrator access | ADMIN | Users, creating users, access, platform settings, API tokens, inbox |
| Recap | - | Closing summary |

Output: `out/mockshift-tutorial-v2.mp4` (1920x1080, H.264 + AAC, chapter markers,
original music bed) plus one `out/<segment>.srt` subtitle file per chapter. The
same render is copied to `out/mockshift-tutorial.mp4` for convenience, but share
the versioned name so a stale CDN/browser cache never serves an old cut. Bump
`TUTORIAL_VERSION` (or the default in `assemble.mjs`) whenever the tour changes.

## How it works

The pipeline is five independent stages, each writing into `.work/`:

1. **`fixtures.mjs`** - logs in as each seeded user over the real API and
   idempotently creates the demo data the tour deep-links to: collections,
   requests, environments, a mock server with routes and a `maintenance`
   scenario, docs pages, an imported OpenAPI contract, a monitor, an automation,
   collaboration comments/reviews/version, a team, an API token, an incoming
   send and a pending access request. Writes `.work/fixtures.json`. Nothing is
   deleted and every section is best-effort (a failure just shows less on that
   page).
2. **`synth.mjs`** - synthesizes each scene's narration to a WAV with Piper,
   applies light production polish (EQ, compression, room, loudness
   normalisation) and records its duration in `.work/narration.json`.
3. **`music.mjs`** - generates an original, royalty-free ambient music bed
   (additive sines + pulse + reverb) sized to the recording in `.work/music.wav`.
4. **`record.mjs`** - drives Playwright per segment, writes
   `.work/video/<segment>.webm` and `.work/timings.json` mapping every scene
   to its wall-clock start offset.
5. **`assemble.mjs`** - places each narration WAV at its recorded offset, adds
   light grade + vignette, burns in subtitles, bookends the tour with animated
   intro/outro cards, concatenates the segments with chapter markers and ducks
   the music bed under the narration into `out/mockshift-tutorial-<version>.mp4`.

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

- `ffmpeg` and `ffprobe` on `PATH` (build uses `gradients`, `drawtext`,
  `sidechaincompress`, `vignette`, `subtitles`).
- `piper` on `PATH` (`pip install piper-tts`), with a voice model under
  `.voices/`. The default is `en_US-ryan-high.onnx` (and `.onnx.json`); download
  voices from the
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
| `PIPER_VOICE` | `.voices/en_US-ryan-high.onnx` | Piper voice model. |
| `FORCE_MUSIC` | *(unset)* | `FORCE_MUSIC=1` rebuilds `.work/music.wav` even if it exists. |
| `SEGMENT` | *(empty = all)* | Record a single segment, e.g. `SEGMENT=admin node record.mjs`. |

## Re-recording one segment

After editing a scene in `script.mjs`, re-synthesize and re-record just the
affected part, then reassemble:

```bash
node synth.mjs
FORCE_MUSIC=1 node music.mjs
SEGMENT=manager node record.mjs
node assemble.mjs
```

`record.mjs` merges the single segment's timings into the existing
`.work/timings.json`, so the other segments are reused as recorded.

## Notes

- Recording happens at 1600x900 (a smaller capture keeps the encoder fast on
  CPU-only machines); `assemble.mjs` scales to 1920x1080 with lanczos.
- `record.mjs` warms every route once before recording so `next dev` compiles
  pages before the camera rolls.
- Playwright's `recordVideo` only emits frames when the page changes, so purely
  static screens would otherwise be truncated. `assemble.mjs` therefore pads
  each segment with cloned frames (`tpad=stop_mode=clone`) up to its target
  length before muxing.
- Modals that use a custom overlay (the admin create-user form) are closed via
  their Cancel button, not Escape - otherwise the overlay would swallow every
  later click.
- `.work/`, `.voices/` and `out/` are gitignored; only the scripts and this
  README are tracked.
