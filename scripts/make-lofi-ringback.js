// Composes the "chamando" (outgoing DM call) loop: an original lo-fi beat made
// entirely by synthesis here (no samples, no third-party music), so it carries
// no copyright but ours. Writes assets/audio/chamando-lofi.wav, a seamless loop.
//
// 72 BPM, 8 bars: Dm9 - G13 - Cmaj9 - Am9 twice, electric piano with tremolo,
// soft bass, swung kick/snare/hats, a sparse pentatonic melody, tape hiss and
// vinyl crackle, all through a gentle low-pass.
//
// Usage: node scripts/make-lofi-ringback.js

const fs = require("fs");
const path = require("path");

const SR = 44100;
const BPM = 72;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 8;
const LENGTH = BAR * BARS;
const N = Math.round(LENGTH * SR);

// Deterministic randomness: the same file every time the script runs
let seed = 20261104;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const keys = new Float32Array(N);
const bass = new Float32Array(N);
const drums = new Float32Array(N);
const lead = new Float32Array(N);

// Adds a sound into `buf` starting at time t (wraps around the loop end, so
// tails that cross it come back in at the start and the loop is seamless)
function add(buf, t, durSec, fn) {
  const start = Math.round(t * SR);
  const len = Math.round(durSec * SR);
  for (let i = 0; i < len; i++) {
    const v = fn(i / SR, i);
    buf[(start + i) % N] += v;
  }
}

// Electric piano: a few sine partials, soft attack, long decay, tremolo
function epiano(t, note, dur, vel) {
  const f = midi(note);
  const detune = 1 + (rand() - 0.5) * 0.002;
  add(keys, t, dur + 1.2, (x) => {
    const env = Math.min(1, x / 0.012) * Math.exp(-x * 1.6) * (x > dur ? Math.exp(-(x - dur) * 6) : 1);
    const trem = 1 + 0.18 * Math.sin(2 * Math.PI * 4.2 * x);
    const s =
      Math.sin(2 * Math.PI * f * detune * x) +
      0.35 * Math.sin(2 * Math.PI * f * 2 * x) * Math.exp(-x * 4) +
      0.12 * Math.sin(2 * Math.PI * f * 3.01 * x) * Math.exp(-x * 7) +
      0.05 * Math.sin(2 * Math.PI * f * 4.02 * x) * Math.exp(-x * 12);
    return s * env * trem * vel * 0.11;
  });
}

function bassNote(t, note, dur, vel) {
  const f = midi(note);
  add(bass, t, dur + 0.2, (x) => {
    const env = Math.min(1, x / 0.02) * (x > dur ? Math.exp(-(x - dur) * 20) : Math.exp(-x * 0.9));
    return (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(2 * Math.PI * f * 2 * x)) * env * vel * 0.32;
  });
}

function kick(t, vel) {
  add(drums, t, 0.45, (x) => {
    const freq = 45 + 75 * Math.exp(-x * 30);
    const phase = 2 * Math.PI * (45 * x + (75 / 30) * (1 - Math.exp(-x * 30)));
    return Math.sin(phase) * Math.exp(-x * 9) * vel * 0.55 + (x < 0.004 ? (rand() - 0.5) * 0.1 * vel : 0) + 0 * freq;
  });
}

function snare(t, vel) {
  let lp = 0;
  add(drums, t, 0.3, (x) => {
    const noise = rand() * 2 - 1;
    lp += 0.45 * (noise - lp); // darker noise (lo-fi)
    const body = Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 30);
    return (lp * Math.exp(-x * 16) * 0.5 + body * 0.35) * vel * 0.38;
  });
}

function hat(t, vel) {
  let prev = 0;
  add(drums, t, 0.06, (x) => {
    const noise = rand() * 2 - 1;
    const hp = noise - prev; // crude high-pass
    prev = noise;
    return hp * Math.exp(-x * 70) * vel * 0.07;
  });
}

function bell(t, note, vel) {
  const f = midi(note);
  add(lead, t, 2.2, (x) => {
    const env = Math.min(1, x / 0.006) * Math.exp(-x * 2.4);
    const s = Math.sin(2 * Math.PI * f * x + 0.8 * Math.sin(2 * Math.PI * f * 2 * x) * Math.exp(-x * 5));
    return s * env * vel * 0.085;
  });
}

// Chords (voicings in the middle register) with their bass root
const CHORDS = [
  { root: 38, notes: [53, 57, 60, 64] }, // Dm9: F A C E
  { root: 43, notes: [53, 57, 59, 64] }, // G13: F A B E
  { root: 36, notes: [52, 55, 59, 62] }, // Cmaj9: E G B D
  { root: 45, notes: [55, 59, 60, 64] } // Am9: G B C E
];

for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR;
  const chord = CHORDS[bar % 4];
  // Chord strummed a little, then pushed again on the "and" of 3
  chord.notes.forEach((n, i) => epiano(t0 + i * 0.018, n, BEAT * 2.4, 0.9 + rand() * 0.15));
  chord.notes.forEach((n, i) => epiano(t0 + BEAT * 2.5 + i * 0.015, n, BEAT * 1.3, 0.55 + rand() * 0.1));
  // Bass on 1, the "and" of 2, and 3
  bassNote(t0, chord.root, BEAT * 1.4, 1);
  bassNote(t0 + BEAT * 1.5, chord.root + 12, BEAT * 0.4, 0.6);
  bassNote(t0 + BEAT * 2, chord.root + 7, BEAT * 1.6, 0.85);
  // Drums, swung (off-beat 8ths late)
  const swing = BEAT * 0.12;
  kick(t0, 1);
  kick(t0 + BEAT * 1.5 + swing, 0.7);
  kick(t0 + BEAT * 2.75, 0.55);
  snare(t0 + BEAT, 0.9);
  snare(t0 + BEAT * 3, 0.95);
  for (let e = 0; e < 8; e++) hat(t0 + e * (BEAT / 2) + (e % 2 ? swing : 0), 0.55 + rand() * 0.45);
}

// Sparse pentatonic melody (D minor pentatonic), lighter the second time round
const MELODY = [
  [0, 0, 74], [0, 1.5, 72], [0, 2, 69],
  [1, 0.5, 72], [1, 2, 74], [1, 3, 76],
  [2, 0, 79], [2, 1, 76], [2, 2.5, 74],
  [3, 1, 72], [3, 2, 69], [3, 3.5, 67],
  [4, 0, 74], [4, 2, 76],
  [5, 1, 79], [5, 2.5, 81],
  [6, 0, 79], [6, 1.5, 76], [6, 3, 74],
  [7, 1, 72], [7, 2, 74]
];
for (const [bar, beat, note] of MELODY) bell(bar * BAR + beat * BEAT, note, bar < 4 ? 0.9 : 0.75);

// A small room: a few feedback combs on the keys and the melody
function reverb(input, mix) {
  const out = new Float32Array(N);
  const delays = [1557, 1617, 1491, 1422].map((d) => Math.round(d * (SR / 44100)));
  for (const d of delays) {
    const buf = new Float32Array(d);
    let idx = 0;
    // Two passes so the tail that wraps around the loop end is fed in too
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        buf[idx] = input[i] + y * 0.78;
        idx = (idx + 1) % d;
        if (pass === 1) out[i] += y * 0.25;
      }
    }
  }
  for (let i = 0; i < N; i++) out[i] = input[i] * (1 - mix) + out[i] * mix;
  return out;
}

const keysWet = reverb(keys, 0.28);
const leadWet = reverb(lead, 0.35);

// Mix, tape hiss and crackle, then a gentle low-pass (two passes of one-pole)
const mix = new Float32Array(N);
for (let i = 0; i < N; i++) {
  let v = keysWet[i] + bass[i] + drums[i] + leadWet[i];
  v += (rand() * 2 - 1) * 0.004; // hiss
  if (rand() < 0.00012) v += (rand() - 0.5) * 0.25; // crackle
  mix[i] = v;
}
const cutoff = 4200;
const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
for (let pass = 0; pass < 2; pass++) {
  let y = mix[N - 1];
  for (let i = 0; i < N; i++) {
    y += a * (mix[i] - y);
    mix[i] = y;
  }
}

// Normalise to -3 dBFS with a soft clip on top
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix[i]));
const gain = 0.7 / (peak || 1);

const data = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const v = Math.tanh(mix[i] * gain * 1.1);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = path.join(__dirname, "..", "assets", "audio", "chamando-lofi.wav");
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`Wrote ${out} (${LENGTH.toFixed(1)} s, ${((44 + data.length) / 1048576).toFixed(1)} MB)`);
