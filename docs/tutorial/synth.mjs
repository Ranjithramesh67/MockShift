// Synthesize every scene's narration to a WAV with Piper and record the
// measured duration into .work/narration.json. Runs before recording so the
// recorder can hold each scene long enough for its voice over.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segments } from './script.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE =
  process.env.PIPER_VOICE || path.join(__dirname, '.voices', 'en_US-lessac-medium.onnx');
const WORK = path.join(__dirname, '.work');
const AUDIO = path.join(WORK, 'audio');

function piper(text, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn('piper', [
      '-m', VOICE,
      '-f', outFile,
      '--sentence-silence', '0.35',
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
      const out = path.join(AUDIO, `${segment.id}__${scene.id}.wav`);
      process.stdout.write(`  [tts] ${key} ... `);
      await piper(scene.narration, out);
      const seconds = await duration(out);
      index[key] = {
        segment: segment.id,
        scene: scene.id,
        text: scene.narration,
        wav: out,
        duration: Number(seconds.toFixed(3)),
      };
      total += seconds;
      process.stdout.write(`${seconds.toFixed(2)}s\n`);
    }
  }
  await writeFile(path.join(WORK, 'narration.json'), JSON.stringify(index, null, 2));
  console.log(`\nNarration: ${Object.keys(index).length} lines, ${total.toFixed(1)}s total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
