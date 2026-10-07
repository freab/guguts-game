// Builds the game's audio from the source recordings in assets-src/audio
// (gitignored; all CC0, BigSoundBank — see public/audio/LICENSE.md):
//
//   npm run audio
//
// - public/audio/birds.webm: the liveliest ~90 s of "Evening Birds" (#1859),
//   made to loop seamlessly (its tail crossfaded into its head), Opus stereo.
// - public/audio/footsteps.webm + footsteps.json: single footsteps cut from
//   "Steps in the Grass, Slow / Quick" (#1253 / #1254) — found by their
//   loudness peaks, the cleanest and most consistent kept, each levelled and
//   faded — packed into one Opus file with an index of where each step is.
// - public/audio/bleats.webm + bleats.json: the goat's answers to a call —
//   single bleats cut from "Bleating Goat #1 / #2" (#0279 / #0280) and
//   "Dwarf goat bleating" (#0880), levelled and faded, packed the same way.
// - public/audio/drink.webm + drink.json: Gugut drinking a bottle he finds —
//   the cork, the gulps and the breath after, cut from "Drink from the gourd
//   #1" (#3247).
//
// Prints each output's RMS level: the ambience's goes into TRACKS in
// app/audio/audioEngine.ts (loudness matching).
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "assets-src", "audio");
const out = path.join(root, "public", "audio");
mkdirSync(out, { recursive: true });

const RATE = 48000;

function ffmpeg(args, input) {
  return execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    input,
    maxBuffer: 1 << 30,
  });
}

/** A file decoded to mono 48 kHz float samples. */
function decodeMono(file) {
  const buf = ffmpeg(["-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"]);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
function rms(a, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
function peak(a, from = 0, to = a.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(a[i]));
  return p;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/* ------------------------------------------------------------------ birds */

function buildBirds() {
  const file = path.join(src, "evening-birds-1859.mp3");
  const mono = decodeMono(file);
  const seconds = Math.floor(mono.length / RATE);
  const LOOP = 90; // seconds in the loop
  const FADE = 4; // crossfade at the seam
  const BLOCK = 10;

  // Loudness per second, then pick the window whose quietest 10 s block is
  // loudest: steady birdsong, no lull in the loop.
  const perSecond = Array.from({ length: seconds }, (_, s) => rms(mono, s * RATE, (s + 1) * RATE));
  let best = 0;
  let bestScore = -Infinity;
  for (let start = 0; start + LOOP + FADE <= seconds; start++) {
    let worst = Infinity;
    for (let b = start; b + BLOCK <= start + LOOP; b += BLOCK) {
      let e = 0;
      for (let s = b; s < b + BLOCK; s++) e += perSecond[s] ** 2;
      worst = Math.min(worst, Math.sqrt(e / BLOCK));
    }
    if (worst > bestScore) {
      bestScore = worst;
      best = start;
    }
  }
  console.log(`birds: loop ${best}s–${best + LOOP}s of ${seconds}s`);

  // o(t) = seg(t) for t >= FADE; for t < FADE, the head fading in over the
  // tail (seg(LOOP + t)) fading out (equal-power), so the end runs straight
  // into the start. Done on the decoded stereo samples.
  const buf = ffmpeg(["-i", file, "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"]);
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const at = best * RATE * 2;
  const n = LOOP * RATE;
  const fade = FADE * RATE;
  const loop = new Float32Array(n * 2);
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < 2; c++) {
      const v = all[at + f * 2 + c];
      if (f >= fade) loop[f * 2 + c] = v;
      else {
        const x = f / fade;
        loop[f * 2 + c] = v * Math.sin((x * Math.PI) / 2) + all[at + (n + f) * 2 + c] * Math.cos((x * Math.PI) / 2);
      }
    }
  }
  const target = path.join(out, "birds.webm");
  ffmpeg(
    ["-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", "-", "-c:a", "libopus", "-b:a", "64k", target],
    Buffer.from(loop.buffer)
  );
  const check = decodeMono(target);
  console.log(`birds.webm: ${(check.length / RATE).toFixed(1)} s, RMS ${db(rms(check)).toFixed(1)} dBFS (mono sum)`);
}

/* -------------------------------------------------------------- footsteps */

/**
 * Single steps from a recording of many: the envelope's peaks, at least
 * `gap` seconds apart, well above the floor; each step runs from just before
 * its rise to just before the next (at most `maxLen`).
 */
function findSteps(a, { gap, maxLen }) {
  const HOP = RATE / 200; // 5 ms
  const env = [];
  for (let i = 0; i + HOP * 2 <= a.length; i += HOP) env.push(rms(a, i, i + HOP * 2));
  const smooth = env.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) (s += env[k]), n++;
    return s / n;
  });
  const floor = median(smooth);
  const minGap = Math.round(gap * 200);
  const peaks = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    const v = smooth[i];
    if (db(v) < db(floor) + 10 || v < smooth[i - 1] || v < smooth[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGap) {
      if (v > smooth[last]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks.map((p, k) => {
    // Back up to where the step starts rising (20 dB under its peak, ≤ 80 ms).
    let o = p;
    while (o > 0 && p - o < 16 && db(smooth[o]) > db(smooth[p]) - 20) o--;
    const start = Math.max(0, o * HOP - RATE * 0.01);
    const next = k + 1 < peaks.length ? peaks[k + 1] * HOP - RATE * 0.06 : a.length;
    const end = Math.min(a.length, next, start + maxLen * RATE);
    return { start: Math.round(start), end: Math.round(end), peak: db(smooth[p]) };
  });
}

/** Keep `count` clean, consistent steps, spread over the recording. */
function pickSteps(steps, count, minLen) {
  const level = median(steps.map((s) => s.peak));
  const good = steps.filter((s) => Math.abs(s.peak - level) < 4 && s.end - s.start >= minLen * RATE);
  if (good.length <= count) return good;
  return Array.from({ length: count }, (_, i) => good[Math.floor(((i + 0.5) * good.length) / count)]);
}

/** Level a step to a common loudness (peak-limited) and fade its ends. */
function levelStep(a, { start, end }) {
  const step = a.slice(start, end);
  const gain = Math.min(10 ** (-20 / 20) / Math.max(rms(step), 1e-6), 10 ** (-3 / 20) / Math.max(peak(step), 1e-6));
  const fadeIn = Math.round(RATE * 0.004);
  const fadeOut = Math.round(RATE * 0.05);
  for (let i = 0; i < step.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > step.length - fadeOut) g *= (step.length - i) / fadeOut;
    step[i] *= g;
  }
  return step;
}

function buildFootsteps() {
  const sets = {
    walk: { file: "steps-grass-slow-1253.wav", gap: 0.35, maxLen: 0.5, minLen: 0.18 },
    run: { file: "steps-grass-quick-1254.wav", gap: 0.2, maxLen: 0.32, minLen: 0.12 },
  };
  const GAP = Math.round(RATE * 0.15); // silence between steps in the sprite
  const LEAD = Math.round(RATE * 0.1);
  const parts = [new Float32Array(LEAD)];
  let cursor = LEAD;
  const index = {};
  for (const [name, o] of Object.entries(sets)) {
    const a = decodeMono(path.join(src, o.file));
    const found = findSteps(a, o);
    const picked = pickSteps(found, 8, o.minLen);
    console.log(`${name}: ${found.length} steps found, ${picked.length} kept`);
    index[name] = picked.map((s) => {
      const step = levelStep(a, s);
      const entry = [+(cursor / RATE).toFixed(4), +(step.length / RATE).toFixed(4)];
      parts.push(step, new Float32Array(GAP));
      cursor += step.length + GAP;
      return entry;
    });
  }
  const pcm = new Float32Array(cursor);
  let at = 0;
  for (const p of parts) (pcm.set(p, at), (at += p.length));
  const target = path.join(out, "footsteps.webm");
  ffmpeg(
    ["-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "-", "-c:a", "libopus", "-b:a", "96k", target],
    Buffer.from(pcm.buffer)
  );
  writeFileSync(path.join(out, "footsteps.json"), JSON.stringify(index) + "\n");
  console.log(`footsteps.webm: ${(pcm.length / RATE).toFixed(2)} s, ${index.walk.length} walk + ${index.run.length} run steps`);
}

/* ----------------------------------------------------------------- bleats */

/**
 * The bleats, by hand: [file, start s, end s] around each one (with a little
 * air either side), found with ffmpeg's silencedetect at -35 dB.
 */
const BLEATS = [
  ["bleating-goat-1-0279.mp3", 0, 1.0],
  ["bleating-goat-2-0280.mp3", 0, 0.86],
  ["dwarf-goat-bleating-0880.mp3", 0.27, 1.02],
  ["dwarf-goat-bleating-0880.mp3", 1.62, 2.35],
  ["dwarf-goat-bleating-0880.mp3", 3.14, 3.94],
  ["dwarf-goat-bleating-0880.mp3", 4.92, 5.6],
  ["dwarf-goat-bleating-0880.mp3", 6.55, 7.3],
  ["dwarf-goat-bleating-0880.mp3", 8.11, 8.69],
  ["dwarf-goat-bleating-0880.mp3", 10.3, 11.2],
];

function buildBleats() {
  const GAP = Math.round(RATE * 0.15);
  const LEAD = Math.round(RATE * 0.1);
  const decoded = new Map();
  const parts = [new Float32Array(LEAD)];
  let cursor = LEAD;
  const index = BLEATS.map(([file, from, to]) => {
    if (!decoded.has(file)) decoded.set(file, decodeMono(path.join(src, file)));
    const a = decoded.get(file);
    const bleat = levelStep(a, { start: Math.round(from * RATE), end: Math.min(a.length, Math.round(to * RATE)) });
    const entry = [+(cursor / RATE).toFixed(4), +(bleat.length / RATE).toFixed(4)];
    parts.push(bleat, new Float32Array(GAP));
    cursor += bleat.length + GAP;
    return entry;
  });
  const pcm = new Float32Array(cursor);
  let at = 0;
  for (const part of parts) (pcm.set(part, at), (at += part.length));
  ffmpeg(
    ["-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "-", "-c:a", "libopus", "-b:a", "96k", path.join(out, "bleats.webm")],
    Buffer.from(pcm.buffer)
  );
  writeFileSync(path.join(out, "bleats.json"), JSON.stringify(index) + "\n");
  console.log(`bleats.webm: ${(pcm.length / RATE).toFixed(2)} s, ${index.length} bleats`);
}

/* ------------------------------------------------------------------ drink */

/**
 * Gugut drinking from a bottle he finds, from "Drink from the gourd #1"
 * (#3247): the cork coming out, the gulps, the breath after — [start, end] s
 * in the recording, found from its loudness (ffmpeg silencedetect at -38 dB).
 */
const DRINK = {
  open: [0.25, 1.6],
  gulps: [2.4, 5.05],
  breath: [7.7, 8.5],
};

function buildDrink() {
  const a = decodeMono(path.join(src, "drink-from-the-gourd-3247.mp3"));
  const GAP = Math.round(RATE * 0.15);
  const LEAD = Math.round(RATE * 0.1);
  const parts = [new Float32Array(LEAD)];
  let cursor = LEAD;
  const index = {};
  for (const [name, [from, to]] of Object.entries(DRINK)) {
    const clip = levelStep(a, { start: Math.round(from * RATE), end: Math.round(to * RATE) });
    index[name] = [+(cursor / RATE).toFixed(4), +(clip.length / RATE).toFixed(4)];
    parts.push(clip, new Float32Array(GAP));
    cursor += clip.length + GAP;
  }
  const pcm = new Float32Array(cursor);
  let at = 0;
  for (const part of parts) (pcm.set(part, at), (at += part.length));
  ffmpeg(
    ["-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "-", "-c:a", "libopus", "-b:a", "96k", path.join(out, "drink.webm")],
    Buffer.from(pcm.buffer)
  );
  writeFileSync(path.join(out, "drink.json"), JSON.stringify(index) + "\n");
  console.log(`drink.webm: ${(pcm.length / RATE).toFixed(2)} s (open, gulps, breath)`);
}

buildBirds();
buildFootsteps();
buildBleats();
buildDrink();
