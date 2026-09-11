// Assemble the tutorial: place each scene's narration at its recorded offset,
// mux it with the segment video, burn in subtitles, then concatenate all
// segments into one MP4 with chapter markers.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '.work');
const OUT = path.join(__dirname, 'out');

async function ff(args, opts = {}) {
  return execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
}

async function probe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  const msPart = String(t % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${msPart}`;
}

const SUB_STYLE =
  "FontName=DejaVu Sans,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&HA0000000," +
  'BorderStyle=3,BackColour=&H90000000,Outline=0,Shadow=0,Alignment=2,MarginV=34,Spacing=0.4';

function buildSrt(scenes) {
  let n = 0;
  return scenes
    .map((s) => {
      n += 1;
      return `${n}\n${srtTime(s.startMs)} --> ${srtTime(s.startMs + s.narrationDuration * 1000)}\n${s.text}\n`;
    })
    .join('\n');
}

async function muxSegment(segment) {
  const srtPath = path.join(WORK, `${segment.id}.srt`);
  await writeFile(srtPath, buildSrt(segment.scenes));

  const inputs = ['-i', segment.video];
  const parts = [];
  const labels = [];
  let idx = 1;
  for (const scene of segment.scenes) {
    inputs.push('-i', scene.wav);
    const delay = Math.round(scene.narrationStartMs);
    parts.push(`[${idx}:a]adelay=${delay}|${delay},volume=1.0[a${idx}]`);
    labels.push(`a${idx}`);
    idx += 1;
  }

  let audioGraph = '';
  let audioMap = '';
  if (labels.length === 1) {
    audioGraph = `${parts.join(';')};[${labels[0]}]anull[aout]`;
    audioMap = '[aout]';
  } else if (labels.length > 1) {
    audioGraph = `${parts.join(';')};${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;
    audioMap = '[aout]';
  }

  const filter = [
    `[0:v]tpad=stop_mode=clone:stop_duration=180,fps=30,subtitles='${srtPath}':force_style='${SUB_STYLE}'[v]`,
    audioGraph,
  ]
    .filter(Boolean)
    .join(';');

  const targetSec = (segment.scenes[segment.scenes.length - 1].endMs + 600) / 1000;
  const outFile = path.join(WORK, `${segment.id}.mp4`);
  const args = [
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]',
  ];
  if (audioMap) args.push('-map', audioMap);
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', '30', '-fps_mode', 'cfr',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', targetSec.toFixed(3),
    outFile
  );
  await ff(args);
  return outFile;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = JSON.parse(await readFile(path.join(WORK, 'timings.json'), 'utf8'));

  const segmentFiles = [];
  const chapterLines = [];
  let cumulativeMs = 0;
  for (const segment of report.segments) {
    console.log(`Muxing ${segment.id} (${segment.scenes.length} scenes) ...`);
    const file = await muxSegment(segment);
    const dur = await probe(file);
    await copyFile(path.join(WORK, `${segment.id}.srt`), path.join(OUT, `${segment.id}.srt`));
    segmentFiles.push(file);
    chapterLines.push({ title: segment.title, startMs: cumulativeMs });
    cumulativeMs += Math.round(dur * 1000);
    segment.durationSec = dur;
  }

  const listFile = path.join(WORK, 'concat.txt');
  await writeFile(
    listFile,
    segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
  );

  const metaFile = path.join(WORK, 'chapters.txt');
  await writeFile(
    metaFile,
    ';FFMETADATA1\n' +
      chapterLines
        .map(
          (c, i) =>
            `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c.startMs}\nEND=${
              i + 1 < chapterLines.length ? chapterLines[i + 1].startMs : cumulativeMs
            }\ntitle=${c.title}\n`
        )
        .join('')
  );

  const finalFile = path.join(OUT, 'mockshift-tutorial.mp4');
  await ff([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-i', metaFile,
    '-map', '0', '-map_metadata', '1', '-c', 'copy',
    finalFile,
  ]);

  const total = await probe(finalFile);
  console.log(`\nDone: ${finalFile}`);
  console.log(`Duration: ${(total / 60).toFixed(1)} min (${total.toFixed(1)}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
