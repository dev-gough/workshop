'use client';

// The circuit: the floodlit night feed at the middle of the pit wall.
// Everything here is a view of session state — it never mutates the sim.
//
// Rendering is imperative. The page owns one animation loop; it steps the
// session and calls draw() on this handle, so React never re-renders per frame.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { CAR_RADIUS, type Car, type Session } from '../_lib/engine';
import { readPalette, alpha, type DrsPalette } from '../_lib/palette';

export type ColorBy = 'field' | 'progress' | 'speed';
export type CamMode = 'chase' | 'circuit';

export interface Overlays {
  rays: boolean;
  trail: boolean;
  line: boolean;
  ghosts: boolean;
  grid: boolean;
  colorBy: ColorBy;
}

export const DEFAULT_OVERLAYS: Overlays = {
  rays: true,
  trail: true,
  line: true,
  ghosts: true,
  grid: false,
  colorBy: 'field',
};

export interface CircuitHandle {
  draw(): void;
}

// Kerbs and the start line are painted objects, not room decor — fixed hues,
// like the floodlit palette itself.
const KERB_RED = '#c2453a';
const KERB_WHITE = '#d8d5cc';
const CHECKER_A = '#e6e4dd';
const CHECKER_B = '#17181c';

function hexLerp(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * k)},${Math.round(pa[1] + (pb[1] - pa[1]) * k)},${Math.round(pa[2] + (pb[2] - pa[2]) * k)})`;
}

interface Props {
  session: React.RefObject<Session | null>;
  overlays: Overlays;
  camMode: CamMode;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

const Circuit = forwardRef<CircuitHandle, Props>(function Circuit(
  { session, overlays, camMode, selectedId, onSelect }, ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<DrsPalette | null>(null);
  const overlaysRef = useRef(overlays);
  const camModeRef = useRef(camMode);
  const selectedRef = useRef(selectedId);
  overlaysRef.current = overlays;
  camModeRef.current = camMode;
  selectedRef.current = selectedId;

  // Camera state persists across frames and eases toward its target.
  const camRef = useRef({ x: 0, y: 0, scale: 1, started: false });
  // Kept for click hit-testing.
  const viewRef = useRef({ cx: 0, cy: 0, camX: 0, camY: 0, scale: 1 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = session.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = paletteRef.current ?? readPalette(canvas.parentElement);
    const ov = overlaysRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    if (cw <= 0 || ch <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const track = s.track;
    const b = track.bounds;
    const margin = 40;
    const fitScale = Math.min(
      cw / (b.maxX - b.minX + margin * 2),
      ch / (b.maxY - b.minY + margin * 2),
    );
    const midX = (b.minX + b.maxX) / 2;
    const midY = (b.minY + b.maxY) / 2;

    const champ = s.champion();
    const chase = camModeRef.current === 'chase' && champ;
    const targetScale = chase ? Math.max(fitScale, Math.min(fitScale * 2.6, 2.2)) : fitScale;
    const targetX = chase ? champ.x : midX;
    const targetY = chase ? champ.y : midY;

    const cam = camRef.current;
    if (!cam.started) {
      cam.x = targetX; cam.y = targetY; cam.scale = targetScale; cam.started = true;
    } else {
      cam.x += (targetX - cam.x) * 0.06;
      cam.y += (targetY - cam.y) * 0.06;
      cam.scale += (targetScale - cam.scale) * 0.06;
    }
    viewRef.current = { cx: cw / 2, cy: ch / 2, camX: cam.x, camY: cam.y, scale: cam.scale };

    // ── The night ──
    ctx.fillStyle = pal.night;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    // Racing surface between the walls.
    ctx.fillStyle = pal.tarmac;
    ctx.beginPath();
    for (let i = 0; i < track.outerPts.length; i++) {
      const p = track.outerPts[i];
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    for (let i = track.innerPts.length - 1; i >= 0; i--) {
      const p = track.innerPts[i];
      i === track.innerPts.length - 1 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill('evenodd');

    // A soft sheen down the middle of the ribbon — floodlight, not paint.
    ctx.strokeStyle = alpha(pal.tarmac2, 0.9);
    ctx.lineWidth = track.width * 1.1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < track.centerline.length; i++) {
      const p = track.centerline[i];
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    if (ov.grid) {
      // The wall hash the engine actually queries — truth, not decoration.
      const g = s.grid;
      ctx.strokeStyle = alpha(pal.faint, 0.25);
      ctx.lineWidth = 0.75 / cam.scale;
      ctx.beginPath();
      for (let cx = 0; cx <= g.cols; cx++) {
        ctx.moveTo(g.minX + cx * g.cell, g.minY);
        ctx.lineTo(g.minX + cx * g.cell, g.minY + g.rows * g.cell);
      }
      for (let cy = 0; cy <= g.rows; cy++) {
        ctx.moveTo(g.minX, g.minY + cy * g.cell);
        ctx.lineTo(g.minX + g.cols * g.cell, g.minY + cy * g.cell);
      }
      ctx.stroke();
    }

    // Centerline as lane paint, with direction chevrons past the start line.
    if (ov.line) {
      ctx.strokeStyle = alpha(pal.lane, 0.35);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      for (let i = 0; i < track.centerline.length; i++) {
        const p = track.centerline[i];
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      for (const idx of [10, 20, 30]) {
        const p = track.centerline[idx];
        const q = track.centerline[(idx + 2) % track.centerline.length];
        const h = Math.atan2(q.y - p.y, q.x - p.x);
        ctx.strokeStyle = alpha(pal.lane, 0.6);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(h + 2.5) * 6, p.y + Math.sin(h + 2.5) * 6);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(h - 2.5) * 6, p.y + Math.sin(h - 2.5) * 6);
        ctx.stroke();
      }
    }

    // Kerbs: red/white teeth on the concave wall of every real corner.
    const N = track.centerline.length;
    const KERB_STEP = 3;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'butt';
    for (let i = 0; i < N; i += KERB_STEP) {
      const side = track.kerb[i];
      if (side === 0) continue;
      const pts = side === 1 ? track.innerPts : track.outerPts;
      const a = pts[i];
      const c = pts[(i + KERB_STEP) % N];
      ctx.strokeStyle = (i / KERB_STEP) % 2 === 0 ? KERB_RED : KERB_WHITE;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }

    // Walls.
    ctx.strokeStyle = alpha(pal.litField, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of track.innerWalls) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    for (const [x1, y1, x2, y2] of track.outerWalls) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();

    // Start/finish: a proper checker band, two rows across the whole ribbon.
    {
      const sp = track.startPos;
      const h = track.startHeading;
      const nx = Math.cos(h + Math.PI / 2), ny = Math.sin(h + Math.PI / 2);
      const tx = Math.cos(h), ty = Math.sin(h);
      const cols = 10;
      const sq = (track.width * 2) / cols;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = sp.x + nx * (-track.width + c * sq) + tx * (r * sq - sq);
          const oy = sp.y + ny * (-track.width + c * sq) + ty * (r * sq - sq);
          ctx.fillStyle = (r + c) % 2 === 0 ? CHECKER_A : CHECKER_B;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + nx * sq, oy + ny * sq);
          ctx.lineTo(ox + nx * sq + tx * sq, oy + ny * sq + ty * sq);
          ctx.lineTo(ox + tx * sq, oy + ty * sq);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // The leader's line, warmed by speed.
    if (ov.trail && s.trail.length > 1) {
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 1; i < s.trail.length; i++) {
        const a = s.trail[i - 1];
        const c = s.trail[i];
        const age = i / s.trail.length;
        ctx.strokeStyle = alpha(hexLerp('#5a6b82', '#ff8a3c', c.v), 0.08 + age * 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }

    // ── The field ──
    const p = s.params;
    const maxProgress = Math.max(1, ...s.cars.map(c => c.progress));
    const colorOf = (car: Car): string => {
      if (ov.colorBy === 'progress') return hexLerp('#4b5f78', '#ff8a3c', car.progress / maxProgress);
      if (ov.colorBy === 'speed') return hexLerp('#39404d', '#e8ecf5', car.speed / p.car.topSpeed);
      return pal.litField;
    };

    const isRecordRun = champ ? s.metres(champ.progress) > s.bestEver && s.bestEver > 0 : false;

    const drawCar = (car: Car, fill: string, glow?: string) => {
      const r = CAR_RADIUS;
      const h = car.heading;
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(car.x + Math.cos(h) * r * 1.6, car.y + Math.sin(h) * r * 1.6);
      ctx.lineTo(car.x + Math.cos(h + 2.45) * r, car.y + Math.sin(h + 2.45) * r);
      ctx.lineTo(car.x + Math.cos(h - 2.45) * r, car.y + Math.sin(h - 2.45) * r);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    // Crashed husks first, under the living.
    if (ov.ghosts) {
      ctx.globalAlpha = 0.3;
      for (const car of s.cars) {
        if (!car.alive) drawCar(car, pal.litDead);
      }
      ctx.globalAlpha = 1;
    }

    for (const car of s.cars) {
      if (!car.alive || car === champ) continue;
      ctx.globalAlpha = 0.8;
      drawCar(car, colorOf(car));
    }
    ctx.globalAlpha = 1;

    // Sensor fans: the leader's always (if dialled on), the specimen's too.
    const sel = selectedRef.current === null ? null : s.find(selectedRef.current);
    const fanFor = (car: Car) => {
      const count = p.sensors.count;
      const spreadR = (p.sensors.spread * Math.PI) / 180;
      const range = p.sensors.range;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < count; i++) {
        const angle = count === 1
          ? car.heading
          : car.heading + (-spreadR / 2 + (spreadR / (count - 1)) * i);
        const d = car.sensors[i] * range;
        const close = car.sensors[i] < 0.22;
        ctx.strokeStyle = alpha(pal.litRay, 0.3);
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(car.x + Math.cos(angle) * d, car.y + Math.sin(angle) * d);
        ctx.stroke();
        ctx.fillStyle = close ? alpha(pal.crash, 0.9) : alpha(pal.litRay, 0.55);
        ctx.beginPath();
        ctx.arc(car.x + Math.cos(angle) * d, car.y + Math.sin(angle) * d, close ? 2.2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (ov.rays && champ?.alive) fanFor(champ);
    if (sel && sel.alive && sel !== champ) fanFor(sel);

    // The leader, under floodlight — purple the moment it's driving a record.
    if (champ) {
      drawCar(
        champ,
        champ.alive ? (isRecordRun ? pal.litPurple : pal.litChamp) : pal.litDead,
        champ.alive ? alpha(isRecordRun ? pal.litPurple : pal.litChamp, 0.8) : undefined,
      );
    }

    // The specimen ring.
    if (sel) {
      ctx.strokeStyle = pal.litRay;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, CAR_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Vignette: the infield falls away at the edges of the feed.
    const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.42, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);
  }, [session]);

  useImperativeHandle(ref, () => ({ draw }), [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    paletteRef.current = readPalette(wrap);
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(box.width * dpr));
      canvas.height = Math.max(1, Math.floor(box.height * dpr));
      paletteRef.current = readPalette(wrap);
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // A theme flip changes the room; the floodlit feed mostly holds steady, but
  // the bezel colours it borrows do move.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      paletteRef.current = readPalette(wrapRef.current);
      draw();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [overlays, camMode, selectedId, draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = session.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { cx, cy, camX, camY, scale } = viewRef.current;
    const wx = (e.clientX - rect.left - cx) / scale + camX;
    const wy = (e.clientY - rect.top - cy) / scale + camY;
    const hit = s.carAt(wx, wy, 12 / scale);
    onSelect(hit ? hit.id : null);
  }, [session, onSelect]);

  return (
    <div ref={wrapRef} className="drs-circuit h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block h-full w-full cursor-crosshair"
      />
    </div>
  );
});

export default Circuit;
