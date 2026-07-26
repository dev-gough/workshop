'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  heightAt, intensityAt, parMsOf, airScore, type Course,
} from '@/lib/groove';
import {
  spawnBike, stepBike, wheelPositions, PHYSICS_DT, WHEELBASE, WHEEL_R,
  type BikeInput, type BikeState,
} from '@/lib/groove-physics';

/**
 * The ride: side-on, throttle in your hand.
 *
 * The course is a fixed artifact carved out of the song, so unlike a rhythm
 * game there's nothing to stay in sync with — the record is the soundtrack
 * AND the clock. Par is its running time, so the music running out is the
 * sound of missing your grade, which is a better progress bar than a progress
 * bar.
 *
 * Physics runs at a fixed step in @/lib/groove-physics, decoupled from the
 * frame rate, so a run is reproducible and a slow machine rides the same as a
 * fast one.
 */

const VIEW_UNITS = 1500;      // world units across the screen
const BIKE_SCREEN_X = 0.34;   // where the rider sits, as a fraction of width
const CRASH_PAUSE = 1.1;      // seconds face-down before the restart
const STUCK_SECONDS = 4;

export interface RunResult {
  timeMs: number;
  finished: boolean;
  distance: number;
  courseLength: number;
  crashes: number;
  airMs: number;
  flips: number;
  style: number;
  parMs: number;
}

interface Hud {
  seconds: number;
  par: number;
  progress: number;
  songProgress: number;
  speed: number;
  crashes: number;
  style: number;
  banner: string;
}

export function Ride({ course, audioUrl, onFinish, onBail }: {
  course: Course;
  audioUrl: string;
  onFinish: (r: RunResult) => void;
  onBail: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<Hud>({
    seconds: 0, par: course.duration, progress: 0, songProgress: 0,
    speed: 0, crashes: 0, style: 0, banner: '',
  });

  const parMs = parMsOf(course);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const input = useRef<BikeInput>({ throttle: false, brake: false, lean: 0 });
  const keys = useRef({ up: false, down: false, left: false, right: false });

  const run = useRef({
    bike: spawnBike(course, 0),
    checkpoint: 0,
    elapsed: 0,
    crashes: 0,
    crashClock: 0,
    stuckClock: 0,
    style: 0,
    airMs: 0,
    flips: 0,
    lastFlips: 0,
    banner: '',
    bannerUntil: 0,
    camY: heightAt(course, 0),
    done: false,
  });

  const restart = useCallback(() => {
    const r = run.current;
    r.bike = spawnBike(course, r.checkpoint);
    r.crashClock = 0;
    r.stuckClock = 0;
  }, [course]);

  // ── Input ──
  useEffect(() => {
    const sync = () => {
      input.current.throttle = keys.current.up;
      input.current.brake = keys.current.down;
      input.current.lean = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') { keys.current.up = true; e.preventDefault(); }
      else if (k === 's' || e.key === 'ArrowDown') { keys.current.down = true; e.preventDefault(); }
      else if (k === 'a' || e.key === 'ArrowLeft') { keys.current.left = true; e.preventDefault(); }
      else if (k === 'd' || e.key === 'ArrowRight') { keys.current.right = true; e.preventDefault(); }
      else if (k === 'r') { run.current.crashes++; restart(); }
      else if (e.key === 'Escape') onBail();
      sync();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') keys.current.up = false;
      else if (k === 's' || e.key === 'ArrowDown') keys.current.down = false;
      else if (k === 'a' || e.key === 'ArrowLeft') keys.current.left = false;
      else if (k === 'd' || e.key === 'ArrowRight') keys.current.right = false;
      sync();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [restart, onBail]);

  // ── Loop ──
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const r = run.current;
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let hudClock = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = (now: number) => {
      const wall = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (!r.done) {
        r.elapsed += wall;

        if (r.crashClock > 0) {
          r.crashClock -= wall;
          if (r.crashClock <= 0) restart();
        } else {
          // Fixed-step physics, however the frame rate wanders.
          accumulator += wall;
          let steps = 0;
          while (accumulator >= PHYSICS_DT && steps < 40) {
            stepBike(course, r.bike, input.current);
            accumulator -= PHYSICS_DT;
            steps++;

            if (r.bike.flips > r.lastFlips) {
              const gained = r.bike.flips - r.lastFlips;
              r.lastFlips = r.bike.flips;
              r.flips += gained;
              r.style += airScore(0, intensityAt(course, r.bike.x), gained);
              r.banner = gained > 1 ? `${gained}× FLIP` : 'FLIP';
              r.bannerUntil = r.elapsed + 1.1;
            }
            if (!r.bike.rearGrounded && !r.bike.frontGrounded) {
              r.airMs += PHYSICS_DT * 1000;
              r.style += airScore(PHYSICS_DT, intensityAt(course, r.bike.x), 0);
            }
            if (r.bike.crashed || r.bike.x >= course.length) break;
          }

          if (r.bike.x >= course.length) {
            r.done = true;
          } else if (r.bike.crashed) {
            r.crashes++;
            r.crashClock = CRASH_PAUSE;
            r.banner = 'OFF';
            r.bannerUntil = r.elapsed + CRASH_PAUSE;
          } else {
            // Bogged down on a climb is its own kind of crash.
            const speed = Math.hypot(r.bike.vx, r.bike.vy);
            r.stuckClock = speed < 40 ? r.stuckClock + wall : 0;
            if (r.stuckClock > STUCK_SECONDS) {
              r.crashes++;
              r.crashClock = CRASH_PAUSE;
              r.banner = 'BOGGED';
              r.bannerUntil = r.elapsed + CRASH_PAUSE;
            }
          }

          while (
            r.checkpoint < course.length &&
            course.checkpoints.some(c => c > r.checkpoint && c <= r.bike.x)
          ) {
            r.checkpoint = Math.max(...course.checkpoints.filter(c => c <= r.bike.x));
            break;
          }
        }
      }

      // Camera eases vertically so hills don't throw the whole frame about.
      r.camY += (r.bike.y - r.camY) * Math.min(1, wall * 4);
      draw(ctx, canvas, course, r.bike, r.camY, r.elapsed);

      hudClock += wall;
      if (hudClock > 0.06) {
        hudClock = 0;
        const audio = audioRef.current;
        setHud({
          seconds: r.elapsed,
          par: course.duration,
          progress: Math.min(1, r.bike.x / course.length),
          songProgress: Math.min(1, (audio?.currentTime ?? 0) / course.duration),
          speed: Math.hypot(r.bike.vx, r.bike.vy),
          crashes: r.crashes,
          style: r.style,
          banner: r.elapsed < r.bannerUntil ? r.banner : '',
        });
      }

      if (r.done) {
        audioRef.current?.pause();
        finishRef.current({
          timeMs: Math.round(r.elapsed * 1000),
          finished: true,
          distance: Math.round(course.length),
          courseLength: Math.round(course.length),
          crashes: r.crashes,
          airMs: Math.round(r.airMs),
          flips: r.flips,
          style: r.style,
          parMs,
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
  }, [started, course, restart, parMs]);

  const begin = () => {
    const audio = audioRef.current;
    if (audio) { audio.currentTime = 0; void audio.play(); }
    setStarted(true);
  };

  const retire = () => {
    const r = run.current;
    audioRef.current?.pause();
    finishRef.current({
      timeMs: Math.round(r.elapsed * 1000),
      finished: false,
      distance: Math.round(r.bike.x),
      courseLength: Math.round(course.length),
      crashes: r.crashes,
      airMs: Math.round(r.airMs),
      flips: r.flips,
      style: r.style,
      parMs,
    });
  };

  const late = hud.seconds > hud.par;

  return (
    <div className="relative h-full w-full">
      <audio ref={audioRef} src={audioUrl} preload="auto" />
      <canvas ref={canvasRef} className="h-full w-full" />

      {started && (
        <>
          {/* Your time, against the record's. */}
          <div className="pointer-events-none absolute left-4 top-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Time</p>
            <p
              className="gv-readout text-3xl font-semibold tabular-nums"
              style={{ color: late ? '#ff7a5c' : '#f4efe6' }}
            >
              {fmt(hud.seconds)}
            </p>
            <p className="gv-readout text-[11px] text-white/45">par {fmt(hud.par)}</p>
          </div>

          <div className="pointer-events-none absolute right-4 top-4 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Style</p>
            <p className="gv-readout text-2xl font-semibold tabular-nums text-[#e8a33a]">
              {hud.style.toLocaleString()}
            </p>
            <p className="gv-readout text-[11px] text-white/45">
              {Math.round(hud.speed)} · {hud.crashes} off{hud.crashes === 1 ? '' : 's'}
            </p>
          </div>

          {hud.banner && (
            <p
              className="pointer-events-none absolute left-1/2 top-[26%] -translate-x-1/2 text-2xl font-bold uppercase tracking-[0.3em]"
              style={{ color: hud.banner === 'OFF' || hud.banner === 'BOGGED' ? '#ff6b6b' : '#ffd479' }}
            >
              {hud.banner}
            </p>
          )}

          {/* Two markers on one bar: how far you've got, and how far the
              record has. Whoever's ahead is winning. */}
          <div className="pointer-events-none absolute inset-x-4 bottom-4">
            <div className="relative h-2 rounded-full bg-white/12">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[#e8663a]"
                style={{ width: `${hud.progress * 100}%` }}
              />
              <div
                className="absolute -top-1 h-4 w-0.5 bg-white/70"
                style={{ left: `${hud.songProgress * 100}%` }}
                title="the record"
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.18em] text-white/35">
              <span>you</span>
              <span>the record</span>
            </div>
          </div>

          <button
            onClick={retire}
            className="absolute bottom-10 right-4 rounded-md border border-white/20 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:text-white"
          >
            give up
          </button>
        </>
      )}

      {!started && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/60 backdrop-blur-sm">
          <div className="max-w-md text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">
              {(course.length / 1000).toFixed(1)}k · {course.kickers.length} jumps · {course.rocks.length} rocks
            </p>
            <p className="mt-3 text-sm text-white/75">
              <Key>W</Key> throttle <Key>S</Key> brake <Key>A</Key>/<Key>D</Key> lean <Key>R</Key> restart
            </p>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              The whole course was cut from this song, and par is how long the
              record runs. Get to the end before the music does.
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

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="mx-0.5 rounded border border-white/25 px-1.5 py-0.5 text-xs">{children}</kbd>;
}

function fmt(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

// ── Renderer ─────────────────────────────────────────────────────

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  course: Course,
  bike: BikeState,
  camY: number,
  elapsed: number,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  const zoom = W / VIEW_UNITS;

  const camX = bike.x;
  const originX = W * BIKE_SCREEN_X;
  const originY = H * 0.62;
  const sx = (wx: number) => (wx - camX) * zoom + originX;
  const sy = (wy: number) => originY - (wy - camY) * zoom;

  const heat = intensityAt(course, bike.x);

  // Sky, warming with the record.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0b0910');
  sky.addColorStop(0.55, `hsl(${18 + heat * 12} ${24 + heat * 26}% ${7 + heat * 8}%)`);
  sky.addColorStop(1, `hsl(${16 + heat * 14} ${20 + heat * 22}% ${11 + heat * 9}%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Parallax ranges. Genuinely this record too, just read at a quarter and a
  // half of the scale — so the horizon is the same song seen from further
  // off, rather than decorative noise. Pinned to a fixed horizon rather than
  // the camera, which is what stops distant hills bobbing with every whoop.
  // The `skip` offsets read a different stretch of the record for each range,
  // so the horizon isn't a flattened echo of the ground you're on — and so
  // the flat run-in at the start doesn't render as two straight bands.
  const horizon = H * 0.58;
  for (const L of [
    { f: 0.20, amp: 0.62, lift: 54, skip: 0.41, col: '#170f16' },
    { f: 0.46, amp: 0.80, lift: 16, skip: 0.17, col: '#221321' },
  ]) {
    const span = Math.max(1, course.length);
    ctx.fillStyle = L.col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let px = 0; px <= W + 10; px += 10) {
      const wx = camX + (px - originX) / zoom;
      const h = heightAt(course, ((wx * L.f + span * L.skip) % span + span) % span);
      ctx.lineTo(px, horizon - h * zoom * L.amp - L.lift);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  // ── The ground ──
  const leftW = camX - originX / zoom - course.step;
  const rightW = camX + (W - originX) / zoom + course.step;
  const from = Math.max(0, Math.floor(leftW / course.step));
  const to = Math.min(course.heights.length - 1, Math.ceil(rightW / course.step));

  // Anchored to the screen edges, not to the first and last samples: before
  // the start line and past the finish there's still ground to stand on, and
  // a gap there reads as a hole in the world.
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, sy(course.heights[from]));
  for (let i = from; i <= to; i++) ctx.lineTo(sx(i * course.step), sy(course.heights[i]));
  ctx.lineTo(W, sy(course.heights[to]));
  ctx.lineTo(W, H);
  ctx.closePath();
  const earth = ctx.createLinearGradient(0, sy(course.heights[from]) - 40, 0, H);
  earth.addColorStop(0, '#2a1a1c');
  earth.addColorStop(1, '#100a0d');
  ctx.fillStyle = earth;
  ctx.fill();

  // The surface itself, lit by how hard the song is going right there. Run
  // out to the screen edges so the ground before the start line and past the
  // finish is still ground rather than a cliff.
  ctx.lineWidth = Math.max(2, 3.4 * zoom);
  ctx.lineCap = 'round';
  ctx.strokeStyle = `hsl(20 40% 26%)`;
  ctx.beginPath();
  ctx.moveTo(0, sy(course.heights[from]));
  ctx.lineTo(sx(from * course.step), sy(course.heights[from]));
  ctx.moveTo(sx(to * course.step), sy(course.heights[to]));
  ctx.lineTo(W, sy(course.heights[to]));
  ctx.stroke();
  for (let i = from; i < to; i++) {
    const inten = course.intensity[Math.min(course.intensity.length - 1, i)];
    ctx.strokeStyle = `hsl(${20 + inten * 22} ${55 + inten * 35}% ${34 + inten * 26}%)`;
    ctx.beginPath();
    ctx.moveTo(sx(i * course.step), sy(course.heights[i]));
    ctx.lineTo(sx((i + 1) * course.step), sy(course.heights[i + 1]));
    ctx.stroke();
  }

  // Rocks sitting on the line they're already bulging.
  for (const rock of course.rocks) {
    if (rock.x < leftW - 200 || rock.x > rightW + 200) continue;
    const gx = sx(rock.x);
    const gy = sy(heightAt(course, rock.x));
    const rr = rock.r * zoom * 0.62;
    ctx.fillStyle = '#2a1f22';
    ctx.beginPath();
    ctx.moveTo(gx - rr * 1.3, gy + rr * 0.2);
    ctx.lineTo(gx - rr * 0.6, gy - rr * 0.9);
    ctx.lineTo(gx + rr * 0.4, gy - rr * 1.05);
    ctx.lineTo(gx + rr * 1.25, gy + rr * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,102,58,0.5)';
    ctx.lineWidth = Math.max(1, zoom * 1.6);
    ctx.stroke();
  }

  // Checkpoints, and the chequer at the end.
  for (const c of course.checkpoints) {
    if (c < leftW || c > rightW) continue;
    const gx = sx(c);
    const gy = sy(heightAt(course, c));
    ctx.strokeStyle = 'rgba(240,232,216,0.28)';
    ctx.lineWidth = Math.max(1, zoom * 2);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy - 60 * zoom);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,102,58,0.7)';
    ctx.fillRect(gx, gy - 60 * zoom, 22 * zoom, 14 * zoom);
  }
  if (course.length >= leftW && course.length <= rightW + 400) {
    const gx = sx(course.length);
    const gy = sy(heightAt(course, course.length));
    ctx.fillStyle = '#f0e8d8';
    ctx.fillRect(gx - 2 * zoom, gy - 150 * zoom, 4 * zoom, 150 * zoom);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#f0e8d8' : '#191114';
      ctx.fillRect(gx + 2 * zoom, gy - (150 - i * 18) * zoom, 60 * zoom, 18 * zoom);
    }
  }

  // ── The bike and its rider ──
  const { rx, ry, fx, fy } = wheelPositions(bike);
  const wr = WHEEL_R * zoom;
  const cos = Math.cos(bike.angle), sin = Math.sin(bike.angle);
  /** Chassis-local point → screen. */
  const P = (lx: number, ly: number): [number, number] =>
    [sx(bike.x + lx * cos - ly * sin), sy(bike.y + lx * sin + ly * cos)];

  const bars = P(WHEELBASE * 0.44, 20);
  const seat = P(-WHEELBASE * 0.2, 10);
  const peg = P(WHEELBASE * 0.02, -6);
  const shoulder = P(-2, 36);
  const head = P(4, 50);
  const ink = bike.crashed ? '#ff6b6b' : '#f0e8d8';

  // Frame
  ctx.strokeStyle = '#e8663a';
  ctx.lineWidth = Math.max(1.5, 4 * zoom);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(sx(rx), sy(ry));
  ctx.lineTo(...seat);
  ctx.lineTo(...bars);
  ctx.lineTo(sx(fx), sy(fy));
  ctx.stroke();

  for (const [wx, wy] of [[rx, ry], [fx, fy]] as const) {
    ctx.beginPath();
    ctx.arc(sx(wx), sy(wy), wr, 0, Math.PI * 2);
    ctx.fillStyle = '#191114';
    ctx.fill();
    ctx.strokeStyle = '#c9c2b4';
    ctx.lineWidth = Math.max(1, 2.4 * zoom);
    ctx.stroke();
    // A spoke, so the wheels visibly turn.
    const spin = bike.x / WHEEL_R;
    ctx.beginPath();
    ctx.moveTo(sx(wx), sy(wy));
    ctx.lineTo(sx(wx) + Math.cos(spin) * wr * 0.8, sy(wy) + Math.sin(spin) * wr * 0.8);
    ctx.lineWidth = Math.max(0.8, 1.4 * zoom);
    ctx.stroke();
  }

  // Rider: torso off the seat, arms to the bars, a leg on the peg.
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.4, 3.2 * zoom);
  ctx.beginPath();
  ctx.moveTo(...seat); ctx.lineTo(...shoulder);
  ctx.moveTo(...shoulder); ctx.lineTo(...bars);
  ctx.moveTo(...seat); ctx.lineTo(...peg);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(head[0], head[1], Math.max(2.5, 7 * zoom), 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();

  void elapsed;
}
