// Synthesize every scene's narration with Piper and record the measured
// duration into .work/narration.json. Runs before recording so the recorder can
// hold each scene long enough for its voice over.
//
// The voice is a higher-quality single-speaker model, spoken slightly faster
// than default, with leading/trailing silence trimmed and light production
// polish (EQ, gentle compression, a touch of room, loudness normalisation) so
// it reads less like a flat synthetic TTS and more like a produced voice over.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segments } from './script.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE =
  process.env.PIPER_VOICE || path.join(__dirname, '.voices', 'en_US-ryan-high.onnx');
const WORK = path.join(__dirname, '.work');
const AUDIO = path.join(WORK, 'audio');

const POLISH =
  'highpass=f=90,lowpass=f=12000,' +
  'silenceremove=start_periods=1:start_silence=0.03:start_threshold=-45dB,' +
  'areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,' +
  'acompressor=threshold=-18dB:ratio=3:attack=8:release=180,' +
  'aecho=0.8:0.88:40|63:0.05|0.04,' +
  'loudnorm=I=-16:TP=-1.5:LRA=11,' +
  'aresample=48000';

function piper(text, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn('piper', [
      '-m', VOICE,
      '-f', outFile,
      '--length_scale', '0.96',
      '--noise_scale', '0.667',
      '--noise_w', '0.8',
      '--sentence-silence', '0.12',
    ]);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr}`));
    });
    child.stdin.write(`${text}\n`);
    child.stdin.end();
  });
}

async function polish(inFile, outFile) {
  await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', inFile, '-af', POLISH, '-ac', '1', outFile], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function duration(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function main() {
  await mkdir(AUDIO, { recursive: true });
  const index = {};
  let total = 0;
  for (const segment of segments) {
    for (const scene of segment.scenes) {
      const key = `${segment.id}/${scene.id}`;
      const raw = path.join(AUDIO, `${segment.id}__${scene.id}.raw.wav`);
      const out = path.join(AUDIO, `${segment.id}__${scene.id}.wav`);
      process.stdout.write(`  [tts] ${key} ... `);
      await piper(scene.narration, raw);
      await polish(raw, out);
      const seconds = await duration(out);
      index[key] = { wav: out, duration: seconds, text: scene.narration };
      total += seconds;
      process.stdout.write(`${seconds.toFixed(2)}s\n`);
    }
  }
  await writeFile(path.join(WORK, 'narration.json'), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${path.join(WORK, 'narration.json')} (${segments.length} segments, ${total.toFixed(1)}s narration)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
