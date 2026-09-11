// Original, royalty-free ambient music bed for the MockShift tutorial.
//
// The track is synthesized from scratch (additive sines + a soft pulse + a
// simple reverb) so it carries no third-party rights. Output: .work/music.wav.
// Re-run with FORCE_MUSIC=1 to regenerate.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '.work');
const OUT = path.join(WORK, 'music.wav');

const SR = 32000;
const CARD_SECONDS = 11;
const FORCE = process.env.FORCE_MUSIC === '1';

function totalSeconds() {
  try {
    const timings = JSON.parse(readFileSync(path.join(WORK, 'timings.json'), 'utf8'));
    let seconds = 0;
    for (const segment of timings.segments) {
      const last = segment.scenes[segment.scenes.length - 1];
      seconds += (last.endMs + 600) / 1000;
    }
    return Math.ceil(seconds) + CARD_SECONDS + 12;
  } catch {
    return Number(process.env.MUSIC_SECONDS || 340);
  }
}

// Deterministic noise so rebuilds are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addTone(buf, startSec, durSec, freq, gain, opts = {}) {
  const { attack = 0.01, release = 0.25, decayTau = null, partials = [1], detune = 0 } = opts;
  const start = Math.max(0, Math.round(startSec * SR));
  const len = Math.round(durSec * SR);
  const end = Math.min(buf.length, start + len);
  const twoPi = Math.PI * 2;
  for (let i = start; i < end; i += 1) {
    const t = (i - start) / SR;
    let env;
    if (t < attack) env = t / attack;
    else if (decayTau) env = Math.exp(-(t - attack) / decayTau);
    else env = 1;
    const rem = durSec - t;
    if (rem < release) env *= Math.max(0, rem / release);
    if (env <= 0) continue;
    let s = 0;
    for (let p = 0; p < partials.length; p += 1) {
      s += partials[p] * Math.sin(twoPi * freq * (p + 1) * t);
    }
    if (detune) s += 0.6 * Math.sin(twoPi * freq * (1 + detune) * t);
    buf[i] += gain * env * s;
  }
}

function addShaker(buf, startSec, gain, rnd) {
  const start = Math.round(startSec * SR);
  const len = Math.round(0.12 * SR);
  const end = Math.min(buf.length, start + len);
  let prev = 0;
  for (let i = start; i < end; i += 1) {
    const t = (i - start) / SR;
    const env = Math.exp(-t / 0.045);
    const n = rnd() * 2 - 1;
    const highpassed = n - prev;
    prev = n;
    buf[i] += gain * env * highpassed;
  }
}

function reverb(buf, delaySec, fb, mix) {
  const d = Math.floor(delaySec * SR);
  const out = new Float32Array(buf.length);
  let lp = 0;
  for (let i = 0; i < buf.length; i += 1) {
    let v = buf[i] + (i - d >= 0 ? fb * out[i - d] : 0);
    lp += 0.35 * (v - lp);
    out[i] = lp;
  }
  for (let i = 0; i < buf.length; i += 1) buf[i] += mix * out[i];
}

// A minor / C major progression. Each entry is a bar of pad tones plus its bass root.
const PROGRESSION = [
  { pad: [220.0, 261.63, 329.63, 392.0], bass: 110.0 }, // Am7
  { pad: [174.61, 220.0, 261.63, 329.63], bass: 87.31 }, // Fmaj7
  { pad: [130.81, 164.81, 196.0, 246.94], bass: 65.41 }, // Cmaj7
  { pad: [196.0, 246.94, 293.66, 329.63], bass: 98.0 }, // G6
];

const PENTATONIC = [440.0, 523.25, 587.33, 659.25, 783.99];

function build(seconds) {
  const n = Math.ceil(seconds * SR);
  const dry = new Float32Array(n);
  const wet = new Float32Array(n);
  const rnd = mulberry32(20260911);

  const bpm = 68;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const chordDur = bar * 2;
  const loop = chordDur * PROGRESSION.length;

  let chordIndex = 0;
  let arpStep = 0;
  for (let t = 0; t < seconds; t += chordDur) {
    const chord = PROGRESSION[chordIndex % PROGRESSION.length];
    // Warm pad across the whole chord.
    for (const freq of chord.pad) {
      addTone(wet, t, chordDur, freq, 0.075, {
        attack: 1.4,
        release: 1.8,
        partials: [1, 0.28, 0.1],
        detune: 0.003,
      });
    }
    // Deep, slow bass.
    addTone(dry, t, chordDur, chord.bass, 0.16, {
      attack: 0.05,
      release: 1.2,
      decayTau: 1.6,
      partials: [1, 0.12],
    });
    // Gentle plucked arpeggio on eighths.
    const eighth = beat / 2;
    for (let e = 0; e < Math.round(chordDur / eighth); e += 1) {
      const time = t + e * eighth;
      if (time >= seconds) break;
      const note = PENTATONIC[(arpStep * 2 + e) % PENTATONIC.length] / 2;
      addTone(wet, time, 1.3, note, 0.05, {
        attack: 0.004,
        release: 0.5,
        decayTau: 0.42,
        partials: [1, 0.22, 0.06],
      });
      arpStep += 1;
    }
    // Soft heartbeat + shaker for a little motion.
    for (let b = 0; b < 4; b += 1) {
      const time = t + b * beat;
      if (time >= seconds) break;
      if (b === 0 || b === 2) {
        addTone(dry, time, 0.5, 54, 0.12, { attack: 0.004, release: 0.35, decayTau: 0.16, partials: [1] });
      }
      addShaker(wet, time + beat / 2, b % 2 === 0 ? 0.012 : 0.02, rnd);
    }
    chordIndex += 1;
  }

  reverb(wet, 0.089, 0.42, 0.5);
  reverb(wet, 0.147, 0.36, 0.4);

  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    const v = dry[i] + wet[i] * 0.85;
    out[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const norm = peak > 0 ? 0.62 / peak : 1;
  for (let i = 0; i < n; i += 1) out[i] = Math.max(-1, Math.min(1, out[i] * norm));

  // Fade the ends in/out so the bed enters and leaves cleanly.
  const fade = Math.floor(3 * SR);
  for (let i = 0; i < fade && i < n; i += 1) out[i] *= i / fade;
  for (let i = 0; i < fade && i < n; i += 1) out[n - 1 - i] *= i / fade;
  return out;
}

function writeWav(file, samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  writeFileSync(file, buffer);
}

function main() {
  mkdirSync(WORK, { recursive: true });
  if (existsSync(OUT) && !FORCE) {
    console.log(`music.wav already present (${OUT}); FORCE_MUSIC=1 to rebuild`);
    return;
  }
  const seconds = totalSeconds();
  console.log(`Synthesizing ~${seconds}s of original ambient music ...`);
  const samples = build(seconds);
  writeWav(OUT, samples);
  console.log(`Wrote ${OUT}`);
}

main();
