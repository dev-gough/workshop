/**
 * The Groove — turning a song into a course.
 *
 * A side-on dirt-bike course, in the Free Rider / Trials mould: the song
 * carves the ground line and you ride it. Bass is the landscape, the mids
 * and highs are the surface you have to deal with, kicks throw up jumps,
 * and the loud parts of the record are where it gets nasty.
 *
 * The par time is the song's own length. Finish before the record does and
 * you've beaten it — which is the whole goal, and the reason the music
 * cutting out mid-run means something.
 *
 * This module is deliberately pure: no DOM, no audio APIs, no clock, no
 * Math.random. Given the same features it must produce the identical course
 * forever, because a time is only meaningful against the exact ground it was
 * set on. That's what GENERATOR_VERSION is for — it's stamped on every score,
 * and every leaderboard read filters on the current one, so revising the
 * generator retires the old board instead of quietly re-labelling it as a
 * ranking of a course nobody can ride any more.
 */

/**
 * v2 — the course became a 2D side-scroller. v1 was a fixed-speed ride down
 * a pseudo-3D road collecting notes; nothing about that track survives, so
 * nothing scored on it can be compared to anything scored now.
 */
export const GENERATOR_VERSION = 2;

// ── Analysis, as produced by _lib/analyse.ts (unchanged across versions) ──

export interface Onset {
  /** Seconds into the song. */
  t: number;
  /** 0 = low (kick), 1 = mid (snare/body), 2 = high (hats/air). */
  band: 0 | 1 | 2;
  /** 0..1, relative to the song's own dynamics. */
  strength: number;
}

export interface TrackFeatures {
  frameRate: number;
  duration: number;
  /** Per-frame, all normalised 0..1 against the song's own distribution. */
  intensity: number[];
  bass: number[];
  mid: number[];
  treble: number[];
  onsets: Onset[];
  rideability: number;
}

// ── The course ───────────────────────────────────────────────────

export interface Rock {
  x: number;
  /** Drawn radius; the bump itself is already baked into the ground line. */
  r: number;
}

export interface Kicker {
  x: number;
  strength: number;
}

export interface Course {
  /** World units between ground samples. */
  step: number;
  /** Ground height at each sample, world units, y increasing upward. */
  heights: number[];
  /** 0..1 per sample — how hard the song is going here. Colour and style. */
  intensity: number[];
  /** Total course length in world units. */
  length: number;
  /** Song length in seconds, which is also the par time. */
  duration: number;
  /** Somewhere to restart from after a crash. */
  checkpoints: number[];
  rocks: Rock[];
  kickers: Kicker[];
}

// ── Tuning ───────────────────────────────────────────────────────
// Every number below is part of the generator's identity. Touching one
// means bumping GENERATOR_VERSION.

const SAMPLE_STEP = 8;
/**
 * World units of course per second of song — which also sets par, since the
 * course is duration × this and par is the duration.
 *
 * Calibrated with scripts/groove-sim.ts rather than by feel: the bike's flat
 * top speed is around 950, but jumps, climbs and rough ground mean a poor
 * rider averages nearer 300. At 430 that unskilled floor comes in around 0.70
 * (a C), which leaves beating the record as something you have to ride well
 * for. Re-run the sim after touching this.
 */
const PAR_SPEED = 430;

/**
 * Each layer's amplitude is paired with the smoothing length below it: a
 * height swing only matters relative to the distance it happens over. 560
 * units of hill is a gentle roll across 1600 units and an unclimbable wall
 * across 400, and getting that ratio wrong is what turns a course into a
 * series of dead stops. The SMOOTH_* values are 1/length in samples.
 */
const BASE_HEIGHT = 620;      // rolling landscape, trough to crest
const SMOOTH_BASE = 0.005;    // ≈1600 units — worst-case gradient ≈0.39
const MID_HEIGHT = 90;        // whoops and rollers
const SMOOTH_MID = 0.028;     // ≈290 units — ≈0.31
const FINE_HEIGHT = 16;       // surface chatter
const SMOOTH_FINE = 0.11;     // ≈73 units — ≈0.22
/** ≈32°. The steepest the LANDSCAPE may be: past this you can't climb it. */
const MAX_SLOPE = 0.62;
/** ≈52°. Jumps and rocks are allowed to be much sharper than the landscape,
 *  because you meet them at speed and leave the ground; this only exists to
 *  stop stacked features summing into a vertical face. */
const FEATURE_MAX_SLOPE = 1.3;

const CHECKPOINT_SECONDS = 14;

// ── Helpers ──────────────────────────────────────────────────────

/** Sample a per-frame series at a time in seconds, linearly interpolated. */
function sampleAt(series: number[], frameRate: number, t: number): number {
  if (series.length === 0) return 0;
  const f = t * frameRate;
  const i = Math.floor(f);
  if (i < 0) return series[0];
  if (i >= series.length - 1) return series[series.length - 1];
  return series[i] + (series[i + 1] - series[i]) * (f - i);
}

/** Single-pole smoothing run forwards then backwards, so it adds no lag. */
function smooth(values: number[], alpha: number): number[] {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) out[i] = out[i - 1] + (out[i] - out[i - 1]) * alpha;
  for (let i = out.length - 2; i >= 0; i--) out[i] = out[i + 1] + (out[i] - out[i + 1]) * alpha;
  return out;
}

// ── Generation ───────────────────────────────────────────────────

export function generateCourse(features: TrackFeatures): Course {
  const { frameRate, duration } = features;
  const length = Math.max(PAR_SPEED * 4, duration * PAR_SPEED);
  const count = Math.ceil(length / SAMPLE_STEP) + 1;

  // ── Three layers of ground ──
  // Bass is the landscape you ride over, mids are the rollers in it, treble
  // is the surface texture. Each gets its own smoothing, because a hill and
  // a stone are different sizes of the same idea.
  const rawBase: number[] = new Array(count);
  const rawMid: number[] = new Array(count);
  const rawFine: number[] = new Array(count);
  const intensityRaw: number[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const t = (i * SAMPLE_STEP) / PAR_SPEED;
    const bass = sampleAt(features.bass, frameRate, t);
    const midV = sampleAt(features.mid, frameRate, t);
    const treble = sampleAt(features.treble, frameRate, t);
    const inten = sampleAt(features.intensity, frameRate, t);
    intensityRaw[i] = inten;
    rawBase[i] = (bass - 0.5) * BASE_HEIGHT;
    // The busy parts of the record are the rough parts of the ground: a
    // quiet passage should be somewhere you can recover, not more of the
    // same. This is where "different parts of the song matter" lives now.
    rawMid[i] = (midV - 0.5) * MID_HEIGHT * (0.35 + inten * 1.3);
    rawFine[i] = (treble - 0.5) * FINE_HEIGHT * (0.2 + inten * 1.6);
  }

  const base = smooth(rawBase, SMOOTH_BASE);
  const mid = smooth(rawMid, SMOOTH_MID);
  const fine = smooth(rawFine, SMOOTH_FINE);
  const intensity = smooth(intensityRaw, 0.2);

  const heights: number[] = new Array(count);
  for (let i = 0; i < count; i++) heights[i] = base[i] + mid[i] + fine[i];

  // The LANDSCAPE gets clamped here, before anything is stamped onto it.
  // A sustained gradient steeper than this can't be climbed and stops the
  // ride dead; the features that follow are allowed to be steeper, because
  // a lip you hit at speed and leave the ground on is a different thing
  // entirely from a hill you have to drive up.
  clampSlope(heights, SAMPLE_STEP, MAX_SLOPE);

  /** Gradient of the landscape at a sample, for deciding what can go where. */
  const landscapeSlope = (i: number) => {
    const a = heights[Math.max(0, i - 3)];
    const b = heights[Math.min(count - 1, i + 3)];
    return (b - a) / (6 * SAMPLE_STEP);
  };

  // ── Jumps ──
  // A hard kick throws up a lip with the ground falling away just past it,
  // so there's air to be had. Only on ground that's already fairly level:
  // a ramp built into the side of a hill is just a steeper hill.
  const kickers: Kicker[] = [];
  let lastKick = -Infinity;
  for (const o of features.onsets) {
    if (o.band !== 0 || o.strength < 0.55) continue;
    if (o.t - lastKick < 2.4) continue;
    if (o.t < 2.5 || o.t > duration - 3) continue;

    const x0 = o.t * PAR_SPEED;
    const idx = Math.min(count - 1, Math.round(x0 / SAMPLE_STEP));
    if (Math.abs(landscapeSlope(idx)) > 0.3) continue;
    lastKick = o.t;

    // Asymmetric on purpose. A symmetric bump is not a jump: its crest is
    // flat, so you go light over the top and settle straight back down. A
    // ramp has to END while it's still climbing, so you leave the ground
    // travelling the way the face was pointing. Rise over w (peaking near
    // 44° at full strength), then the lip falls away underneath you.
    const amp = 100 + o.strength * 110;
    const w = 320;
    kickers.push({ x: x0, strength: o.strength });

    const from = Math.max(0, Math.floor((x0 - w * 1.2) / SAMPLE_STEP));
    const to = Math.min(count - 1, Math.ceil((x0 + w * 3.2) / SAMPLE_STEP));
    for (let i = from; i <= to; i++) {
      const dx = i * SAMPLE_STEP - x0;
      if (dx <= 0) {
        const k = Math.max(0, Math.min(1, (dx + w) / w));
        heights[i] += amp * k * k * (3 - 2 * k);
      } else {
        heights[i] += amp * Math.exp(-((dx / (w * 0.22)) ** 2));
      }
      // A shallow trough beyond it, so there's somewhere to come down.
      heights[i] -= amp * 0.35 * Math.exp(-(((dx - w * 1.6) / (w * 1.1)) ** 2));
    }
  }

  // ── Rocks ──
  // Sharp, narrow, and only where the record is already loud — something to
  // get over cleanly rather than a kerb that stops you dead.
  const rocks: Rock[] = [];
  let lastRock = -Infinity;
  for (const o of features.onsets) {
    if (o.band !== 1 || o.strength < 0.62) continue;
    if (o.t - lastRock < 1.9) continue;
    if (o.t < 4 || o.t > duration - 3) continue;
    const x0 = o.t * PAR_SPEED;
    const idx = Math.min(count - 1, Math.round(x0 / SAMPLE_STEP));
    if (intensity[idx] < 0.45) continue;
    if (Math.abs(landscapeSlope(idx)) > 0.32) continue;
    // Never in a kicker's run-up or landing.
    if (kickers.some(k => Math.abs(k.x - x0) < 520)) continue;
    lastRock = o.t;

    const r = 26 + o.strength * 26;
    rocks.push({ x: x0, r });

    const w = r * 1.2;
    const from = Math.max(0, Math.floor((x0 - w * 2.5) / SAMPLE_STEP));
    const to = Math.min(count - 1, Math.ceil((x0 + w * 2.5) / SAMPLE_STEP));
    for (let i = from; i <= to; i++) {
      const dx = i * SAMPLE_STEP - x0;
      heights[i] += r * 1.4 * Math.exp(-((dx / w) ** 2));
    }
  }

  // A genuinely flat run-in, so you start on your wheels with room to get
  // going. Levelled to whatever the course is doing at the end of it, rather
  // than ramped down from zero — a ramp here is a ramp you meet at walking
  // pace, which is the one place on the course you can't afford one.
  const runIn = Math.round(560 / SAMPLE_STEP);
  for (let i = 0; i <= runIn && i < count; i++) heights[i] = heights[Math.min(count - 1, runIn)];

  // A last, much looser clamp: the features above are meant to be steep, but
  // a kicker landing on top of a rock on top of a roller shouldn't be able to
  // sum into something vertical.
  clampSlope(heights, SAMPLE_STEP, FEATURE_MAX_SLOPE);

  const checkpoints: number[] = [];
  for (let t = CHECKPOINT_SECONDS; t < duration - 4; t += CHECKPOINT_SECONDS) {
    checkpoints.push(t * PAR_SPEED);
  }

  return { step: SAMPLE_STEP, heights, intensity, length, duration, checkpoints, rocks, kickers };
}

/**
 * Limit |dh/dx| by walking the array forwards then backwards, pulling any
 * sample too far from its neighbour back into reach. Both passes are needed:
 * one alone only ever flattens cliffs facing one direction.
 */
function clampSlope(heights: number[], step: number, maxSlope: number): void {
  const maxRise = maxSlope * step;
  for (let i = 1; i < heights.length; i++) {
    const d = heights[i] - heights[i - 1];
    if (d > maxRise) heights[i] = heights[i - 1] + maxRise;
    else if (d < -maxRise) heights[i] = heights[i - 1] - maxRise;
  }
  for (let i = heights.length - 2; i >= 0; i--) {
    const d = heights[i] - heights[i + 1];
    if (d > maxRise) heights[i] = heights[i + 1] + maxRise;
    else if (d < -maxRise) heights[i] = heights[i + 1] - maxRise;
  }
}

// ── Reading the ground ───────────────────────────────────────────

export function heightAt(course: Course, x: number): number {
  const f = x / course.step;
  const i = Math.floor(f);
  if (i < 0) return course.heights[0];
  if (i >= course.heights.length - 1) return course.heights[course.heights.length - 1];
  return course.heights[i] + (course.heights[i + 1] - course.heights[i]) * (f - i);
}

export function slopeAt(course: Course, x: number): number {
  return (heightAt(course, x + course.step) - heightAt(course, x - course.step)) / (2 * course.step);
}

export function intensityAt(course: Course, x: number): number {
  const i = Math.max(0, Math.min(course.intensity.length - 1, Math.round(x / course.step)));
  return course.intensity[i];
}

// ── Scoring ──────────────────────────────────────────────────────

/** Par is the record's own running time. */
export const parMsOf = (course: Course) => Math.round(course.duration * 1000);

/**
 * Style, and the one place the original scoring idea survives: air is worth
 * more over the loud parts of the record. Hanging it out through the chorus
 * should count for more than the same jump in the intro.
 */
export function airScore(seconds: number, intensity: number, flips: number): number {
  const heat = 0.5 + 1.8 * intensity * intensity;
  return Math.round((seconds * 220 + flips * 500) * heat);
}

export const GRADES = [
  { min: 1.15, grade: 'S' },   // home with a sixth of the record still to run
  { min: 1.00, grade: 'A' },   // beat the record
  { min: 0.85, grade: 'B' },
  { min: 0.70, grade: 'C' },
  { min: 0.55, grade: 'D' },
  { min: 0, grade: 'F' },
] as const;

/** `ratio` is par ÷ your time — above 1 means you beat the song. */
export function gradeFor(ratio: number): string {
  return GRADES.find(g => ratio >= g.min)!.grade;
}

/** A run that never reached the end is an F however far it got. */
export function ratioFor(parMs: number, timeMs: number, finished: boolean): number {
  if (!finished || timeMs <= 0) return 0;
  return parMs / timeMs;
}
