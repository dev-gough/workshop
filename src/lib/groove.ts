/**
 * The Groove — turning a song into a track.
 *
 * This module is the single source of truth for what a song "is" as a ride.
 * It is deliberately pure: no DOM, no audio APIs, no clock, no Math.random.
 * Given the same features it must produce byte-identical geometry forever,
 * because a score is only meaningful against the exact track it was set on.
 *
 * That's also why GENERATOR_VERSION exists and why it is stamped on every
 * score. Change any constant in this file and you have changed the game;
 * bump the version in the same commit and the old leaderboard stays valid
 * for the track it actually refers to, instead of quietly becoming a
 * ranking of a course nobody can ride any more.
 *
 * Imported by both the ride (to build the road) and /api/groove/scores (to
 * recompute the perfect-play maximum server-side, so the denominator of
 * every percentage is never client-supplied).
 */

export const GENERATOR_VERSION = 1;

// ── Analysis, as produced by _lib/analyse.ts ─────────────────────

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

// ── The track ────────────────────────────────────────────────────

/** One slice of road. Segments are uniform in TIME, not in length. */
export interface Segment {
  /** World length of this slice — this is where the speed sensation lives. */
  len: number;
  /** Elevation, world units. */
  y: number;
  /** Lateral bend applied per segment while projecting. */
  curve: number;
  /** 0..1, the scoring multiplier's source and the road's colour. */
  intensity: number;
}

export interface Note {
  t: number;
  /** Lateral position, -1 (far left) .. 1 (far right). */
  x: number;
  band: 0 | 1 | 2;
  strength: number;
}

export interface Ramp {
  t: number;
  strength: number;
  /** Seconds of hang time a clean launch buys. */
  air: number;
}

export interface Track {
  segments: Segment[];
  notes: Note[];
  ramps: Ramp[];
  /** Perfect play: every note, every ramp, combo never dropped. */
  maxScore: number;
  duration: number;
  /** Segments per second of song — the fixed rate the camera indexes by. */
  segmentRate: number;
}

// ── Tuning ───────────────────────────────────────────────────────
// Every number below is part of the generator's identity. Touching one
// means bumping GENERATOR_VERSION.

const SEGMENT_RATE = 60;        // segments per second of song
// World units are sized against the road's own width (see ROAD_WIDTH in
// ride.tsx): at neutral intensity you cross roughly three road-widths a
// second, which is what a bike at speed actually feels like.
const BASE_SPEED = 4800;        // world units per second at neutral intensity
const SPEED_SWING = 0.85;       // how hard intensity leans on the throttle
const HILL_HEIGHT = 1500;       // world units from trough to crest
const CURVE_STRENGTH = 3.4;

const NOTE_POINTS = 100;
const RAMP_POINTS = 250;
const AIR_POINTS_PER_SEC = 400;
const COMBO_CAP = 50;           // combo multiplier tops out at 1 + 50/25 = 3×

/** Points for one hit, before the combo multiplier. */
export const comboMultiplier = (combo: number) => 1 + Math.min(combo, COMBO_CAP) / 25;

/**
 * The whole point of the design: a note banked during the intro is worth a
 * fraction of the same note banked in the drop. Kept off zero so a quiet
 * passage is still worth riding, and off linear so the loud parts pull away.
 */
export const scoreMultiplier = (intensity: number) => 0.4 + 1.9 * intensity * intensity;

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Deterministic hash → 0..1. Placement needs to look scattered without ever
 * being random: two clients building the same song must lay out the same
 * notes, so Math.random is not available to us here.
 */
function hash01(a: number, b: number): number {
  let h = Math.imul(Math.round(a * 1000) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ Math.round(b * 7919), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Sample a per-frame series at a time in seconds, linearly interpolated. */
function sampleAt(series: number[], frameRate: number, t: number): number {
  if (series.length === 0) return 0;
  const f = t * frameRate;
  const i = Math.floor(f);
  if (i < 0) return series[0];
  if (i >= series.length - 1) return series[series.length - 1];
  return series[i] + (series[i + 1] - series[i]) * (f - i);
}

/** In-place single-pole smoothing, run forwards then backwards so it adds no lag. */
function smooth(values: number[], alpha: number): number[] {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) out[i] = out[i - 1] + (out[i] - out[i - 1]) * alpha;
  for (let i = out.length - 2; i >= 0; i--) out[i] = out[i + 1] + (out[i] - out[i + 1]) * alpha;
  return out;
}

// ── Generation ───────────────────────────────────────────────────

export function generateTrack(features: TrackFeatures): Track {
  const { frameRate, duration } = features;
  const segmentCount = Math.max(2, Math.ceil(duration * SEGMENT_RATE));

  // ── Road shape ──
  // Bass drives elevation and mid/treble balance drives the bend, both
  // heavily smoothed: raw frame-to-frame audio is far too jittery to steer
  // a vehicle along, and a track that shakes is a track nobody can read.
  const rawY: number[] = new Array(segmentCount);
  const rawCurve: number[] = new Array(segmentCount);
  const intensity: number[] = new Array(segmentCount);

  for (let i = 0; i < segmentCount; i++) {
    const t = i / SEGMENT_RATE;
    const bass = sampleAt(features.bass, frameRate, t);
    const mid = sampleAt(features.mid, frameRate, t);
    const treble = sampleAt(features.treble, frameRate, t);
    intensity[i] = sampleAt(features.intensity, frameRate, t);
    rawY[i] = (bass - 0.5) * HILL_HEIGHT;
    // Brightness pulls right, body pulls left. Musically this means a track
    // leans one way through a bright passage and back through a heavy one,
    // which reads as the song steering rather than as noise.
    rawCurve[i] = (treble - mid) * CURVE_STRENGTH;
  }

  const y = smooth(rawY, 0.06);
  const curve = smooth(rawCurve, 0.03);
  const smoothIntensity = smooth(intensity, 0.25);

  const segments: Segment[] = new Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    // Speed: intensity opens the throttle. Because position along the road
    // is the integral of this, and this is a pure function of song time,
    // every rider is at the identical point at the identical moment — which
    // is what makes two scores on one song comparable at all.
    const speed = BASE_SPEED * (1 - SPEED_SWING / 2 + SPEED_SWING * smoothIntensity[i]);
    segments[i] = {
      len: speed / SEGMENT_RATE,
      y: y[i],
      curve: curve[i],
      intensity: smoothIntensity[i],
    };
  }

  // ── Events ──
  const notes: Note[] = [];
  const ramps: Ramp[] = [];

  // Kicks become ramps, but only the ones with room around them: a jump you
  // land 80ms before the next launch isn't a jump, it's a stumble.
  // Ramps are meant to be moments, not a metronome. A kick drum gives you
  // one every half second; at that rate the ride stops being a ride and
  // becomes a jump-mashing exercise, so only the strong, well-spaced ones
  // get a lip.
  const RAMP_SPACING = 2.8;
  let lastRamp = -Infinity;
  for (const o of features.onsets) {
    if (o.band !== 0 || o.strength < 0.6) continue;
    if (o.t - lastRamp < RAMP_SPACING) continue;
    if (o.t < 2 || o.t > duration - 1.5) continue;
    lastRamp = o.t;
    ramps.push({ t: o.t, strength: o.strength, air: 0.45 + o.strength * 0.5 });
  }

  // Everything else becomes a note to steer through. Lane comes from a hash
  // of the onset so a repeated motif lands in a repeated place — the track
  // should feel written, not sprinkled.
  const NOTE_SPACING = 0.14;
  let lastNote = -Infinity;
  let lastX = 0;
  for (const o of features.onsets) {
    if (o.band === 0) continue;
    if (o.strength < 0.3) continue;
    if (o.t - lastNote < NOTE_SPACING) continue;
    if (o.t < 1.5 || o.t > duration - 1) continue;

    // Ramps own their moment; a note in the launch window is unhittable.
    if (ramps.some(r => Math.abs(r.t - o.t) < 0.35)) continue;

    let x = hash01(o.t, o.band) * 2 - 1;
    // Playability constraint: you can only cross so much road per second, so
    // clamp each note's offset to something reachable from the last one.
    // Without this a fast hi-hat run scatters notes nobody could ever collect.
    const dt = o.t - lastNote;
    if (Number.isFinite(dt)) {
      const reach = Math.min(2, dt * 1.5);
      x = Math.max(lastX - reach, Math.min(lastX + reach, x));
    }
    x = Math.max(-0.92, Math.min(0.92, x));

    notes.push({ t: o.t, x, band: o.band, strength: o.strength });
    lastNote = o.t;
    lastX = x;
  }

  return {
    segments,
    notes,
    ramps,
    maxScore: perfectScore(notes, ramps, segments),
    duration,
    segmentRate: SEGMENT_RATE,
  };
}

/**
 * What a flawless run is worth: every note collected, every ramp launched
 * clean, the combo never broken. This is the denominator behind every
 * percentage and grade, so it's computed from the track itself rather than
 * reported by whoever was playing.
 */
export function perfectScore(notes: Note[], ramps: Ramp[], segments: Segment[]): number {
  const events = [
    ...notes.map(n => ({ t: n.t, kind: 'note' as const, air: 0 })),
    ...ramps.map(r => ({ t: r.t, kind: 'ramp' as const, air: r.air })),
  ].sort((a, b) => a.t - b.t);

  let total = 0;
  let combo = 0;
  for (const e of events) {
    const seg = segments[Math.min(segments.length - 1, Math.floor(e.t * SEGMENT_RATE))];
    const mult = scoreMultiplier(seg?.intensity ?? 0) * comboMultiplier(combo);
    total += Math.round(((e.kind === 'note' ? NOTE_POINTS : RAMP_POINTS) + e.air * AIR_POINTS_PER_SEC) * mult);
    combo++;
  }
  // A track with nothing on it would divide by zero downstream.
  return Math.max(1, total);
}

/** Points for one landed event, given where in the song it happened. */
export function eventScore(
  kind: 'note' | 'ramp',
  intensity: number,
  combo: number,
  airSeconds = 0,
): number {
  const base = (kind === 'note' ? NOTE_POINTS : RAMP_POINTS) + airSeconds * AIR_POINTS_PER_SEC;
  return Math.round(base * scoreMultiplier(intensity) * comboMultiplier(combo));
}

// ── Grades ───────────────────────────────────────────────────────

export const GRADES = [
  { min: 0.95, grade: 'S' }, { min: 0.90, grade: 'A' }, { min: 0.80, grade: 'B' },
  { min: 0.70, grade: 'C' }, { min: 0.60, grade: 'D' }, { min: 0, grade: 'F' },
] as const;

export function gradeFor(pct: number): string {
  return GRADES.find(g => pct >= g.min)!.grade;
}
