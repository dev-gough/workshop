'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@/lib/groove';
import { eventScore } from '@/lib/groove';

/**
 * The ride.
 *
 * Position along the road is a pure function of song time — the player never
 * touches the throttle. That single rule is what makes two runs on one song
 * comparable: everybody is at the identical metre at the identical moment, and
 * the music can never drift out of sync with the road because the road IS the
 * clock. What varies is how fast the world goes past, which comes from the
 * segment lengths the generator baked in from the song's own intensity.
 *
 * The player steers, and jumps the ramps.
 */

// ── Projection ───────────────────────────────────────────────────
// These are in the same world units the generator lays road in, and the
// ratios between them are what make the picture read: the horizon needs to
// sit ~13 road-widths out, or the road fills the frame and you're looking at
// an orange field instead of a track.
const ROAD_WIDTH = 1500;
const CAMERA_HEIGHT = 850;
const CAMERA_DEPTH = 0.86;      // ≈ 100° field of view
const DRAW_SEGMENTS = 240;      // ≈ 4 seconds of lookahead — enough to react

// ── Feel ─────────────────────────────────────────────────────────
// Terminal lateral speed is ACCEL/DRAG ≈ 1.7 road-halves per second, so a
// full crossing takes about 1.2s. The generator's note-placement reach
// (see groove.ts) is set below this on purpose — every note it lays down
// has to be one the bike can actually get to from the last one.
const STEER_ACCEL = 12;
const STEER_DRAG = 7;
const CENTRIFUGAL = 0.55;
const NOTE_TOLERANCE = 0.2;     // fraction of half-road width
const RAMP_WINDOW = 0.14;       // seconds either side of the ramp

const BAND_HUES = [18, 168, 44] as const;   // kick / body / air

export interface RunResult {
  score: number;
  notesHit: number;
  notesTotal: number;
  rampsHit: number;
  rampsTotal: number;
  bestCombo: number;
  maxScore: number;
}

interface Hud {
  score: number;
  combo: number;
  multiplier: number;
  progress: number;
  intensity: number;
  message: string;
}

export function Ride({ track, audioUrl, onFinish, onBail }: {
  track: Track;
  audioUrl: string;
  onFinish: (result: RunResult) => void;
  onBail: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<Hud>({
    score: 0, combo: 0, multiplier: 1, progress: 0, intensity: 0, message: '',
  });

  // Everything the loop mutates lives in refs: at 60fps a React state write
  // per frame would spend more time reconciling than drawing.
  const state = useRef({
    playerX: 0,
    playerVX: 0,
    steer: 0,
    airUntil: -1,
    airFrom: -1,
    score: 0,
    combo: 0,
    bestCombo: 0,
    notesHit: 0,
    rampsHit: 0,
    noteIdx: 0,
    rampIdx: 0,
    /** Ramps already resolved by a jump press, so crossing them isn't a miss. */
    rampCleared: -1,
    lastTime: 0,
    message: '',
    messageUntil: 0,
    hitFlash: 0,
  });

  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  // ── Input ──
  const jump = useCallback(() => {
    const s = state.current;
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime;
    if (t < s.airUntil) return;                       // already in the air

    const ramp = track.ramps[s.rampIdx];
    if (ramp && Math.abs(ramp.t - t) <= RAMP_WINDOW) {
      // Clean launch.
      const seg = track.segments[Math.min(track.segments.length - 1, Math.floor(ramp.t * track.segmentRate))];
      s.combo++;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      s.score += eventScore('ramp', seg?.intensity ?? 0, s.combo, ramp.air);
      s.rampsHit++;
      s.airFrom = t;
      s.airUntil = t + ramp.air;
      s.rampCleared = s.rampIdx;
      s.message = ramp.air > 0.8 ? 'HUGE AIR' : 'CLEAN';
      s.messageUntil = t + 0.9;
      s.hitFlash = 1;
    } else {
      // A hop with nothing under it. Costs you the height, not the combo.
      s.airFrom = t;
      s.airUntil = t + 0.32;
    }
  }, [track]);

  useEffect(() => {
    const s = state.current;
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') s.steer = -1;
      else if (k === 'd' || e.key === 'ArrowRight') s.steer = 1;
      else if (k === ' ' || k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); jump(); }
      else if (e.key === 'Escape') onBail();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k === 'a' || e.key === 'ArrowLeft') && s.steer === -1) s.steer = 0;
      if ((k === 'd' || e.key === 'ArrowRight') && s.steer === 1) s.steer = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [jump, onBail]);

  // ── The loop ──
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = state.current;
    let raf = 0;
    let hudClock = 0;
    let finished = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = () => {
      const t = audio.currentTime;
      const dt = Math.min(0.05, Math.max(0, t - s.lastTime));
      s.lastTime = t;

      const segIdxFloat = t * track.segmentRate;
      const baseIndex = Math.floor(segIdxFloat);
      const cur = track.segments[Math.min(track.segments.length - 1, Math.max(0, baseIndex))];

      // ── Steering ──
      if (dt > 0) {
        s.playerVX += s.steer * STEER_ACCEL * dt;
        s.playerVX -= s.playerVX * Math.min(1, STEER_DRAG * dt);
        // The bend throws you toward the outside of the corner. This is the
        // only thing making a fast passage harder than a slow one, since the
        // player has no say over the speed.
        s.playerVX -= (cur?.curve ?? 0) * CENTRIFUGAL * dt;
        s.playerX += s.playerVX * dt;
        if (s.playerX < -1.25) { s.playerX = -1.25; s.playerVX = 0; }
        if (s.playerX > 1.25) { s.playerX = 1.25; s.playerVX = 0; }
      }

      const airborne = t < s.airUntil;

      // ── Events, resolved in the time domain ──
      // Not against the rendered geometry: what you see is a projection, but
      // what you're scored on is when the note actually arrived.
      while (s.noteIdx < track.notes.length && track.notes[s.noteIdx].t <= t) {
        const note = track.notes[s.noteIdx];
        const seg = track.segments[Math.min(track.segments.length - 1, Math.floor(note.t * track.segmentRate))];
        if (Math.abs(s.playerX - note.x) <= NOTE_TOLERANCE) {
          s.combo++;
          s.bestCombo = Math.max(s.bestCombo, s.combo);
          s.score += eventScore('note', seg?.intensity ?? 0, s.combo);
          s.notesHit++;
          s.hitFlash = Math.min(1, s.hitFlash + 0.45);
        } else {
          s.combo = 0;
        }
        s.noteIdx++;
      }

      while (s.rampIdx < track.ramps.length && track.ramps[s.rampIdx].t + RAMP_WINDOW < t) {
        // Rolled over a ramp without launching.
        if (s.rampCleared !== s.rampIdx) {
          s.combo = 0;
          s.message = 'MISSED THE LIP';
          s.messageUntil = t + 0.7;
        }
        s.rampIdx++;
      }

      s.hitFlash = Math.max(0, s.hitFlash - dt * 3);
      if (t > s.messageUntil) s.message = '';

      draw(ctx, canvas, track, t, s.playerX, airborne ? airHeight(t, s.airFrom, s.airUntil) : 0, s.hitFlash);

      // HUD at 10Hz — it's text, nobody can read it faster than that.
      hudClock += dt;
      if (hudClock > 0.1) {
        hudClock = 0;
        setHud({
          score: s.score,
          combo: s.combo,
          multiplier: 1 + Math.min(s.combo, 50) / 25,
          progress: Math.min(1, t / track.duration),
          intensity: cur?.intensity ?? 0,
          message: s.message,
        });
      }

      if (!finished && (audio.ended || t >= track.duration - 0.05)) {
        finished = true;
        finishRef.current({
          score: s.score,
          notesHit: s.notesHit, notesTotal: track.notes.length,
          rampsHit: s.rampsHit, rampsTotal: track.ramps.length,
          bestCombo: s.bestCombo,
          maxScore: track.maxScore,
        });
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [started, track]);

  const begin = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play();
    setStarted(true);
  };

  return (
    <div className="relative h-full w-full">
      <audio ref={audioRef} src={audioUrl} preload="auto" />
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* ── HUD ── */}
      {started && (
        <>
          <div className="pointer-events-none absolute left-4 top-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Score</p>
            <p className="gv-readout text-3xl font-semibold text-white tabular-nums">
              {hud.score.toLocaleString()}
            </p>
          </div>

          <div className="pointer-events-none absolute right-4 top-4 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Combo</p>
            <p
              className="gv-readout text-3xl font-semibold tabular-nums"
              style={{ color: hud.combo > 0 ? '#e8663a' : 'rgba(255,255,255,0.35)' }}
            >
              {hud.combo}
              <span className="ml-1.5 text-base text-white/60">×{hud.multiplier.toFixed(2)}</span>
            </p>
          </div>

          {hud.message && (
            <p
              className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 text-lg font-bold uppercase tracking-[0.28em]"
              style={{ color: hud.message.includes('MISS') ? '#ff6b6b' : '#ffd479' }}
            >
              {hud.message}
            </p>
          )}

          {/* Progress along the record, with the current intensity showing
              through as the colour — the multiplier made visible. */}
          <div className="pointer-events-none absolute inset-x-4 bottom-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${hud.progress * 100}%`,
                  background: `hsl(${18 + hud.intensity * 26} 85% ${44 + hud.intensity * 22}%)`,
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Drop the needle ── */}
      {!started && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/55 backdrop-blur-sm">
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/50">Ready</p>
            <p className="mt-2 text-sm text-white/75">
              <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-xs">A</kbd>
              {' / '}
              <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-xs">D</kbd>
              {' steer  ·  '}
              <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-xs">Space</kbd>
              {' jump the ramps'}
            </p>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-white/45">
              You don&apos;t control the speed — the song does. Notes are worth more
              the harder the track is going.
            </p>
          </div>
          <button
            onClick={begin}
            className="gv-readout rounded-full bg-[#e8663a] px-7 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-105"
          >
            Drop the needle
          </button>
          <button onClick={onBail} className="text-xs text-white/45 underline-offset-4 hover:underline">
            back to the crate
          </button>
        </div>
      )}
    </div>
  );
}

/** A simple parabola between launch and landing. */
function airHeight(t: number, from: number, until: number): number {
  const span = until - from;
  if (span <= 0) return 0;
  const u = (t - from) / span;
  return Math.max(0, 4 * u * (1 - u));
}

// ── Renderer ─────────────────────────────────────────────────────

interface Projected { x: number; y: number; w: number; scale: number }

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  track: Track,
  time: number,
  playerX: number,
  air: number,
  hitFlash: number,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;

  const segIdxFloat = time * track.segmentRate;
  const baseIndex = Math.max(0, Math.floor(segIdxFloat));
  const frac = segIdxFloat - baseIndex;
  const segs = track.segments;
  const base = segs[Math.min(segs.length - 1, baseIndex)];

  const cameraX = playerX * ROAD_WIDTH;
  const cameraY = (base?.y ?? 0) + CAMERA_HEIGHT + air * 260;

  // Sky: the room's night, warmed by whatever the song is doing.
  const intensity = base?.intensity ?? 0;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#08070a');
  sky.addColorStop(0.62, `hsl(${16 + intensity * 20} ${28 + intensity * 30}% ${5 + intensity * 9}%)`);
  sky.addColorStop(1, '#0d0a0c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ── Project the road ahead ──
  // Start at the END of the segment the camera is sitting inside: its near
  // edge is behind the lens, and projecting a point at z ≈ 0 blows the scale
  // up to infinity. The sliver we skip is below the bottom of the frame.
  const firstIdx = baseIndex + 1;
  const points: Projected[] = [];
  const drawn: number[] = [];
  let x = 0, dx = 0;
  let z = Math.max(1, (base?.len ?? 0) * (1 - frac));

  for (let n = 0; n <= DRAW_SEGMENTS; n++) {
    const idx = firstIdx + n;
    if (idx >= segs.length) break;
    const seg = segs[idx];
    const scale = CAMERA_DEPTH / z;
    points.push({
      x: W / 2 + (scale * (x - cameraX) * W) / 2,
      y: H / 2 - (scale * (seg.y - cameraY) * H) / 2,
      w: (scale * ROAD_WIDTH * W) / 2,
      scale,
    });
    drawn.push(idx);
    x += dx;
    dx += seg.curve;
    z += seg.len;
  }

  // ── Road ──
  // Walked NEAR to FAR, keeping the highest point drawn so far: a segment
  // that doesn't reach above it is hidden behind a crest we've already laid
  // down. That test is also what makes near-to-far ordering safe to draw in
  // — nothing drawn later can overlap anything drawn earlier.
  let maxY = H;
  for (let n = 0; n < points.length - 1; n++) {
    const p1 = points[n], p2 = points[n + 1];
    if (p2.y >= maxY) continue;
    const idx = drawn[n];
    const seg = segs[idx];
    const fog = Math.min(1, Math.max(0, 1 - n / DRAW_SEGMENTS));
    const lit = 0.28 + fog * 0.72;

    const band = (idx >> 2) & 1;

    // Ground either side. Kept darker than the tarmac — the road has to be
    // the brightest thing on the ground or you can't tell where it is.
    ctx.fillStyle = `hsl(${16 + seg.intensity * 14} ${10 + seg.intensity * 12}% ${(3 + seg.intensity * 3) * lit}%)`;
    quad(ctx, p1.x, p1.y, p1.w * 1.7, p2.x, p2.y, p2.w * 1.7);

    // Tarmac, banded so motion is legible even on a straight.
    ctx.fillStyle = `hsl(26 7% ${(band ? 17 : 13.5) * lit + 3}%)`;
    quad(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w);

    // Rumble strips, and a centreline to give the eye something to track.
    if (band) {
      ctx.fillStyle = `hsla(${16 + seg.intensity * 32}, 84%, ${(40 + seg.intensity * 24) * lit}%, 0.92)`;
      quad(ctx, p1.x - p1.w, p1.y, p1.w * 0.085, p2.x - p2.w, p2.y, p2.w * 0.085);
      quad(ctx, p1.x + p1.w, p1.y, p1.w * 0.085, p2.x + p2.w, p2.y, p2.w * 0.085);
      ctx.fillStyle = `rgba(240,232,216,${0.16 * lit + 0.04})`;
      quad(ctx, p1.x, p1.y, p1.w * 0.012, p2.x, p2.y, p2.w * 0.012);
    }
    maxY = p2.y;
  }

  // ── Sprites, far to near ──
  const firstTime = firstIdx / track.segmentRate;
  const lastTime = (firstIdx + points.length) / track.segmentRate;

  const atTime = (t: number): Projected | null => {
    const n = Math.round(t * track.segmentRate) - firstIdx;
    return n >= 0 && n < points.length ? points[n] : null;
  };

  // Ramps first — they're bigger and further from the camera on average.
  for (let i = track.ramps.length - 1; i >= 0; i--) {
    const r = track.ramps[i];
    if (r.t < firstTime || r.t > lastTime) continue;
    const p = atTime(r.t);
    if (!p || p.w < 1) continue;
    // A lip you ride up, not a wall you hit: shallow, spanning most of the
    // road, with the leading edge lit so the timing is readable at distance.
    const h = p.w * 0.13 * (0.7 + r.strength * 0.6);
    // Shaded base to lit lip, so it reads as a wedge you ride up rather than
    // a flat slab standing in the road.
    const face = ctx.createLinearGradient(0, p.y, 0, p.y - h);
    face.addColorStop(0, `hsla(${BAND_HUES[0]}, 70%, 28%, 0.95)`);
    face.addColorStop(1, `hsla(${BAND_HUES[0]}, 90%, 58%, 0.95)`);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.moveTo(p.x - p.w * 0.86, p.y);
    ctx.lineTo(p.x + p.w * 0.86, p.y);
    ctx.lineTo(p.x + p.w * 0.72, p.y - h);
    ctx.lineTo(p.x - p.w * 0.72, p.y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,238,206,0.95)';
    ctx.fillRect(p.x - p.w * 0.72, p.y - h - Math.max(1, p.w * 0.018), p.w * 1.44, Math.max(1.2, p.w * 0.026));
  }

  for (let i = track.notes.length - 1; i >= 0; i--) {
    const note = track.notes[i];
    if (note.t < firstTime || note.t > lastTime) continue;
    const p = atTime(note.t);
    if (!p || p.w < 0.6) continue;
    const cx = p.x + note.x * p.w;
    const size = Math.max(1.2, p.w * 0.075 * (0.75 + note.strength * 0.5));
    const hue = BAND_HUES[note.band];
    ctx.fillStyle = `hsla(${hue}, 90%, 62%, 0.95)`;
    ctx.beginPath();
    ctx.arc(cx, p.y - size * 1.4, size, 0, Math.PI * 2);
    ctx.fill();
    // A short stem so the note reads as standing ON the road, not floating.
    ctx.strokeStyle = `hsla(${hue}, 90%, 62%, 0.35)`;
    ctx.lineWidth = Math.max(0.5, size * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx, p.y);
    ctx.lineTo(cx, p.y - size * 0.6);
    ctx.stroke();
  }

  // ── The rider ──
  const ground = H * 0.86;
  const py = ground - air * H * 0.18;
  const pw = W * 0.052;
  const lean = Math.max(-1, Math.min(1, (points[6]?.x ?? W / 2) - W / 2)) / (W / 2);

  // Shadow stays on the road, shrinking as you climb away from it.
  ctx.fillStyle = `rgba(0,0,0,${0.4 * (1 - air)})`;
  ctx.beginPath();
  ctx.ellipse(W / 2, ground + pw * 0.36, pw * 0.55 * (1 - air * 0.35), pw * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(W / 2, py);
  ctx.rotate(lean * -0.2 - air * 0.12);
  ctx.fillStyle = '#f0ece4';
  ctx.beginPath();
  ctx.roundRect(-pw * 0.3, -pw * 0.62, pw * 0.6, pw * 0.72, pw * 0.14);
  ctx.fill();
  ctx.fillStyle = '#e8663a';
  ctx.beginPath();
  ctx.roundRect(-pw * 0.42, -pw * 0.1, pw * 0.84, pw * 0.26, pw * 0.1);
  ctx.fill();
  ctx.fillStyle = '#1a1618';
  ctx.beginPath();
  ctx.ellipse(-pw * 0.34, pw * 0.2, pw * 0.16, pw * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(pw * 0.34, pw * 0.2, pw * 0.16, pw * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // A warm flash on the wheels when something lands.
  if (hitFlash > 0.01) {
    ctx.fillStyle = `rgba(255, 196, 120, ${hitFlash * 0.16})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** One road slice: a trapezium between two projected road centres. */
function quad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1 - w1, y1);
  ctx.lineTo(x2 - w2, y2);
  ctx.lineTo(x2 + w2, y2);
  ctx.lineTo(x1 + w1, y1);
  ctx.closePath();
  ctx.fill();
}
