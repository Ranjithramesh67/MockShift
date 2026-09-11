// Assemble the tutorial: place each scene's narration at its recorded offset and
// mux it with the segment video (with light colour grade, vignette, fades and a
// chapter banner), then concatenate the segments between an animated intro and
// outro card, add chapter markers, and lay an original music bed underneath with
// side-chain ducking so it stays subtle while narration plays.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '.work');
const OUT = path.join(__dirname, 'out');

// Bump when the tour content changes so the share URL is never served from a
// stale CDN/browser cache (the previous file used the same name and stayed
// cached for hours). The stable name is rewritten as a copy for convenience.
const VERSION = process.env.TUTORIAL_VERSION || 'v2';

const FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const FONT_REG = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
const ACCENT = '0x39d98a';
const INTRO_CARD = 5.0;
const OUTRO_CARD = 6.0;

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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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
  "FontName=Liberation Sans,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&HA0000000," +
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

// Fade the chapter banner in, hold, then fade out.
const bannerAlpha = (start = 0.8, hold = 3.6, ramp = 0.4) => {
  const a = start;
  const b = start + ramp;
  const c = start + hold;
  const d = c + ramp;
  return `'if(lt(t,${a}),0,if(lt(t,${b}),(t-${a})/${ramp},if(lt(t,${c}),1,if(lt(t,${d}),(${d}-t)/${ramp},0))))'`;
};

function bannerFilter(title) {
  const esc = title.replace(/'/g, '');
  return (
    `drawtext=fontfile=${FONT_BOLD}:text='${esc}':fontcolor=white:fontsize=34:` +
    `box=1:boxcolor=black@0.5:boxborderw=18:x=(w-text_w)/2:y=92:` +
    `alpha=${bannerAlpha()}`
  );
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
  } else if (labels.length > 1) {
    audioGraph = `${parts.join(';')};${labels
      .map((l) => `[${l}]`)
      .join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;
  } else {
    audioGraph = 'anullsrc=r=48000:cl=stereo,asplit=1[aout]';
  }
  if (labels.length > 0) {
    const target = (segment.scenes[segment.scenes.length - 1].endMs + 600) / 1000;
    audioGraph += `;[aout]afade=t=in:d=0.12,afade=t=out:st=${Math.max(0, target - 0.25).toFixed(3)}:d=0.25[aoutf]`;
    audioMap = '[aoutf]';
  } else {
    audioMap = '[aout]';
  }

  const targetSec = (segment.scenes[segment.scenes.length - 1].endMs + 600) / 1000;
  const fadeOut = Math.max(0, targetSec - 0.6).toFixed(3);
  const videoFilter =
    `[0:v]scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration=180,fps=30,` +
    `eq=contrast=1.05:saturation=1.12,vignette=angle=PI/4.6,` +
    `${bannerFilter(segment.title)},` +
    `fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.6,` +
    `subtitles='${srtPath}':force_style='${SUB_STYLE}'[v]`;

  const filter = [videoFilter, audioGraph].filter(Boolean).join(';');

  const outFile = path.join(WORK, `${segment.id}.mp4`);
  await ff([
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', audioMap,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', '30', '-fps_mode', 'cfr',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', targetSec.toFixed(3),
    outFile,
  ]);
  return outFile;
}

// Animated, brand-coloured title card (silent stereo audio so concat stays simple).
async function makeCard(kind) {
  const file = path.join(WORK, `card-${kind}.mp4`);
  if (await exists(file)) return file;
  const dur = kind === 'intro' ? INTRO_CARD : OUTRO_CARD;
  const title = kind === 'intro' ? 'MockShift' : 'Thanks for watching';
  const titleSize = kind === 'intro' ? 150 : 96;
  const sub =
    kind === 'intro'
      ? 'Design  ·  Mock  ·  Test  ·  Document'
      : 'MockShift — the collaborative API workspace';
  const tag = kind === 'intro' ? 'The collaborative API workspace' : 'Build, mock and test APIs together';
  const tagSize = kind === 'intro' ? 40 : 34;
  const titleY = kind === 'intro' ? '(h/2)-170' : '(h/2)-150';
  const lineY = kind === 'intro' ? '(h/2)-20' : '(h/2)-18';

  const filter =
    `[0:v]` +
    `drawtext=fontfile=${FONT_BOLD}:text='${title}':fontcolor=white:fontsize=${titleSize}:x=(w-text_w)/2:y=${titleY},` +
    `drawbox=x='(iw-440)/2':y=${lineY.replace('(h/2)', '(ih/2)')}:w=440:h=6:color=${ACCENT}@1:t=fill:enable='gt(t,0.5)',` +
    `drawtext=fontfile=${FONT_REG}:text='${sub}':fontcolor=0xd7e6df:fontsize=${tagSize}:x=(w-text_w)/2:y=(h/2)+40,` +
    `drawtext=fontfile=${FONT_REG}:text='${tag}':fontcolor=0x8fa39c:fontsize=30:x=(w-text_w)/2:y=(h/2)+112,` +
    `fade=t=in:st=0:d=0.6,fade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.6[v]`;

  await ff([
    '-f', 'lavfi', '-i', `gradients=s=1920x1080:c0=0x070d18:c1=0x0d2a24:c2=0x0a1a2e:nb_colors=3:speed=0.03:d=${dur}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', filter,
    '-map', '[v]', '-map', '1:a',
    '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', '30', '-fps_mode', 'cfr',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    file,
  ]);
  return file;
}

async function mixMusic(videoFile, musicFile, outFile) {
  const filter =
    `[0:a]asplit=2[na][nsc];` +
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=90,volume=0.18[m];` +
    `[m][nsc]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=600:makeup=1[duck];` +
    `[duck][na]amix=inputs=2:normalize=0:duration=longest[aout]`;
  await ff([
    '-i', videoFile,
    '-i', musicFile,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-shortest',
    outFile,
  ]);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = JSON.parse(await readFile(path.join(WORK, 'timings.json'), 'utf8'));

  const segmentFiles = {};
  for (const segment of report.segments) {
    console.log(`Muxing ${segment.id} (${segment.scenes.length} scenes) ...`);
    const file = await muxSegment(segment);
    await copyFile(path.join(WORK, `${segment.id}.srt`), path.join(OUT, `${segment.id}.srt`));
    segmentFiles[segment.id] = file;
  }

  console.log('Rendering title cards ...');
  const introCard = await makeCard('intro');
  const outroCard = await makeCard('outro');

  // Order: intro card + intro segment form the Introduction chapter; outro
  // segment + outro card form the Recap chapter.
  const ordered = [
    { file: introCard, chapter: 'Introduction' },
    ...report.segments.map((s) => ({
      file: segmentFiles[s.id],
      chapter: s.id === 'intro' ? 'Introduction' : s.id === 'outro' ? 'Recap' : s.title,
    })),
    { file: outroCard, chapter: 'Recap' },
  ];

  const listFile = path.join(WORK, 'concat.txt');
  await writeFile(
    listFile,
    ordered.map((o) => `file '${o.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
  );

  const fullFile = path.join(WORK, 'full-silent.mp4');
  const chapterStarts = [];
  let cumulativeMs = 0;
  for (const item of ordered) {
    const dur = await probe(item.file);
    if (!chapterStarts.length || chapterStarts[chapterStarts.length - 1].title !== item.chapter) {
      chapterStarts.push({ title: item.chapter, startMs: cumulativeMs });
    }
    cumulativeMs += Math.round(dur * 1000);
  }

  const metaFile = path.join(WORK, 'chapters.txt');
  await writeFile(
    metaFile,
    ';FFMETADATA1\n' +
      chapterStarts
        .map(
          (c, i) =>
            `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c.startMs}\nEND=${
              i + 1 < chapterStarts.length ? chapterStarts[i + 1].startMs : cumulativeMs
            }\ntitle=${c.title}\n`
        )
        .join('')
  );

  console.log('Concatenating segments ...');
  await ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', fullFile]);
  await ff(['-i', fullFile, '-i', metaFile, '-map', '0', '-map_metadata', '1', '-c', 'copy', fullFile + '.tmp.mp4']);
  const withChapters = fullFile + '.tmp.mp4';

  const musicFile = path.join(WORK, 'music.wav');
  if (!(await exists(musicFile))) {
    throw new Error('missing .work/music.wav — run `node music.mjs` first');
  }

  const finalFile = path.join(OUT, `mockshift-tutorial-${VERSION}.mp4`);
  console.log('Mixing music bed ...');
  await mixMusic(withChapters, musicFile, finalFile);

  const stableFile = path.join(OUT, 'mockshift-tutorial.mp4');
  await copyFile(finalFile, stableFile);

  const total = await probe(finalFile);
  console.log(`\nDone: ${finalFile}`);
  console.log(`Copy:  ${stableFile}`);
  console.log(`Duration: ${(total / 60).toFixed(1)} min (${total.toFixed(1)}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
