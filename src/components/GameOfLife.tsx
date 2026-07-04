'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import PatternSelector from './PatternSelector';
import { parseLif } from '@/lib/lif';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, RotateCcw, Trash2, Zap, SkipForward,
  ZoomIn, ZoomOut, Gauge, Home, Archive,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────

const SHIFT = 33554432;       // 1 << 25  (±33M range, packed keys stay within 2^52)
const RANGE = 67108864;       // 1 << 26

const NEIGHBOR_OFFSETS = [
  -RANGE - 1, -RANGE, -RANGE + 1,
  -1,                   1,
   RANGE - 1,  RANGE,  RANGE + 1,
];

const MIN_ZOOM = 1;
const MAX_ZOOM = 40;
const DEFAULT_ZOOM = 10;

// Chalk-dust smudges: a dying cell leaves a mark that fades over this many
// generations. Capped so a huge soup can't grow the map without bound.
const DUST_FADE = 12;
const DUST_CAP = 200_000;

// ── The chalk box (single-mode — the board is always slate) ─────────────

const BOARD = { r: 14, g: 21, b: 19 };          // #0e1513 slate
const CHALK = { r: 236, g: 231, b: 216 };       // #ece7d8 white chalk
const FRESH = { r: 232, g: 212, b: 138 };       // #e8d48a yellow chalk (births)
const CHALK_HEX = '#ece7d8';
const FRESH_HEX = '#e8d48a';
const BOARD_HEX = '#0e1513';
const GRID_COLOR = 'rgba(236,231,216,0.05)';
const ORIGIN_COLOR = 'rgba(236,231,216,0.13)';

// Pre-mixed dust color for the low-zoom ImageData path (chalk over slate
// at a fixed ~0.1 alpha — per-pixel blending isn't worth it down there).
const DUST_PX = {
  r: Math.round(BOARD.r + (CHALK.r - BOARD.r) * 0.1),
  g: Math.round(BOARD.g + (CHALK.g - BOARD.g) * 0.1),
  b: Math.round(BOARD.b + (CHALK.b - BOARD.b) * 0.1),
};

// One rgba string per dust age so the fillRect path never allocates in-loop.
const DUST_STYLES: string[] = Array.from({ length: DUST_FADE + 1 }, (_, age) =>
  `rgba(236,231,216,${(0.14 * (1 - age / DUST_FADE)).toFixed(3)})`
);

// ── Coordinate helpers ───────────────────────────────────────────────────

function pack(x: number, y: number): number {
  return (y + SHIFT) * RANGE + (x + SHIFT);
}

function unpackX(key: number): number {
  return (key % RANGE) - SHIFT;
}

function unpackY(key: number): number {
  return Math.floor(key / RANGE) - SHIFT;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Bounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
}

function getVisibleBounds(cam: Camera, w: number, h: number): Bounds {
  const halfW = w / (2 * cam.zoom);
  const halfH = h / (2 * cam.zoom);
  return {
    minX: Math.floor(cam.x - halfW) - 1,
    maxX: Math.ceil(cam.x + halfW) + 1,
    minY: Math.floor(cam.y - halfH) - 1,
    maxY: Math.ceil(cam.y + halfH) + 1,
  };
}

function screenToWorldX(sx: number, cam: Camera, canvasW: number): number {
  return (sx - canvasW / 2) / cam.zoom + cam.x;
}

function screenToWorldY(sy: number, cam: Camera, canvasH: number): number {
  return (sy - canvasH / 2) / cam.zoom + cam.y;
}

// ── Simulation Engine ────────────────────────────────────────────────────

class GOLEngine {
  alive: Set<number>;
  generation: number;
  births: Set<number>;        // cells born on the latest step — fresh chalk
  dust: Map<number, number>;  // cell → generation it died — fading smudge

  constructor() {
    this.alive = new Set();
    this.generation = 0;
    this.births = new Set();
    this.dust = new Map();
  }

  get(x: number, y: number): boolean {
    return this.alive.has(pack(x, y));
  }

  set(x: number, y: number, val: boolean) {
    const key = pack(x, y);
    if (val) {
      this.alive.add(key);
      this.births.add(key);
      this.dust.delete(key);
    } else if (this.alive.has(key)) {
      this.alive.delete(key);
      this.births.delete(key);
      this.dust.set(key, this.generation); // erasing leaves a smudge too
    }
  }

  toggle(x: number, y: number): boolean {
    const key = pack(x, y);
    if (this.alive.has(key)) {
      this.set(x, y, false);
      return false;
    }
    this.set(x, y, true);
    return true;
  }

  step() {
    const counts = new Map<number, number>();
    for (const key of this.alive) {
      for (let i = 0; i < 8; i++) {
        const nk = key + NEIGHBOR_OFFSETS[i];
        counts.set(nk, (counts.get(nk) || 0) + 1);
      }
    }
    const next = new Set<number>();
    const births = new Set<number>();
    for (const [key, count] of counts) {
      if (count === 3 || (count === 2 && this.alive.has(key))) {
        next.add(key);
        if (!this.alive.has(key)) births.add(key);
      }
    }
    for (const key of this.alive) {
      if (!next.has(key)) this.dust.set(key, this.generation);
    }
    this.alive = next;
    this.births = births;
    this.generation++;
    this.pruneDust();
  }

  private pruneDust() {
    const cutoff = this.generation - DUST_FADE;
    for (const [key, g] of this.dust) {
      if (g < cutoff || this.alive.has(key)) this.dust.delete(key);
    }
    if (this.dust.size > DUST_CAP) {
      // Map iterates in insertion order — drop the oldest overflow.
      let drop = this.dust.size - DUST_CAP;
      for (const key of this.dust.keys()) {
        if (drop-- <= 0) break;
        this.dust.delete(key);
      }
    }
  }

  // Bare stepping for the benchmark — no chalk bookkeeping.
  stepN(n: number) {
    for (let s = 0; s < n; s++) {
      const counts = new Map<number, number>();
      for (const key of this.alive) {
        for (let i = 0; i < 8; i++) {
          const nk = key + NEIGHBOR_OFFSETS[i];
          counts.set(nk, (counts.get(nk) || 0) + 1);
        }
      }
      const next = new Set<number>();
      for (const [key, count] of counts) {
        if (count === 3 || (count === 2 && this.alive.has(key))) {
          next.add(key);
        }
      }
      this.alive = next;
      this.generation++;
    }
  }

  clear() {
    this.alive = new Set();
    this.generation = 0;
    this.births = new Set();
    this.dust = new Map();
  }

  randomize(cx: number, cy: number, w: number, h: number) {
    this.clear();
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(cy - h / 2);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (Math.random() < 0.3) {
          this.alive.add(pack(x0 + dx, y0 + dy));
        }
      }
    }
  }

  loadPattern(cells: { x: number; y: number }[], cx: number, cy: number) {
    this.clear();
    const maxX = cells.reduce((m, c) => Math.max(m, c.x), 0);
    const maxY = cells.reduce((m, c) => Math.max(m, c.y), 0);
    const ox = Math.round(cx - maxX / 2);
    const oy = Math.round(cy - maxY / 2);
    for (const c of cells) {
      const key = pack(c.x + ox, c.y + oy);
      this.alive.add(key);
      this.births.add(key); // freshly chalked — settles to white on first step
    }
    this.generation = 0;
  }

  clone(): GOLEngine {
    const copy = new GOLEngine();
    copy.alive = new Set(this.alive);
    copy.generation = this.generation;
    return copy;
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  engine: GOLEngine,
  cam: Camera,
  canvasW: number,
  canvasH: number,
) {
  const zoom = cam.zoom;
  const bounds = getVisibleBounds(cam, canvasW, canvasH);
  const gen = engine.generation;

  // ImageData for pixel-level rendering at very low zoom
  if (zoom <= 2) {
    const imageData = ctx.createImageData(canvasW, canvasH);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = BOARD.r; data[i + 1] = BOARD.g; data[i + 2] = BOARD.b; data[i + 3] = 255;
    }

    const halfW = canvasW / 2;
    const halfH = canvasH / 2;
    const size = Math.ceil(zoom);

    const stamp = (key: number, r: number, g: number, b: number) => {
      const wx = unpackX(key);
      const wy = unpackY(key);
      if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) return;
      if (zoom <= 1) {
        const sx = Math.round((wx - cam.x) * zoom + halfW);
        const sy = Math.round((wy - cam.y) * zoom + halfH);
        if (sx >= 0 && sx < canvasW && sy >= 0 && sy < canvasH) {
          const idx = (sy * canvasW + sx) * 4;
          data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
        }
      } else {
        const sx = Math.floor((wx - cam.x) * zoom + halfW);
        const sy = Math.floor((wy - cam.y) * zoom + halfH);
        for (let py = sy; py < sy + size && py < canvasH; py++) {
          if (py < 0) continue;
          for (let px = sx; px < sx + size && px < canvasW; px++) {
            if (px < 0) continue;
            const idx = (py * canvasW + px) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
          }
        }
      }
    };

    // Dust first (glider trails read beautifully at survey zoom), then chalk.
    for (const key of engine.dust.keys()) stamp(key, DUST_PX.r, DUST_PX.g, DUST_PX.b);
    for (const key of engine.alive) {
      if (engine.births.has(key)) stamp(key, FRESH.r, FRESH.g, FRESH.b);
      else stamp(key, CHALK.r, CHALK.g, CHALK.b);
    }

    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // Standard fillRect path
  ctx.fillStyle = BOARD_HEX;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const halfW = canvasW / 2;
  const halfH = canvasH / 2;

  // Chalk ruling at higher zoom
  if (zoom >= 8) {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const sx = Math.round((x - cam.x) * zoom + halfW) - 0.5;
      if (sx >= -1 && sx <= canvasW + 1) {
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvasH);
      }
    }
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const sy = Math.round((y - cam.y) * zoom + halfH) - 0.5;
      if (sy >= -1 && sy <= canvasH + 1) {
        ctx.moveTo(0, sy);
        ctx.lineTo(canvasW, sy);
      }
    }
    ctx.stroke();
  }

  // Origin crosshair — the board's ruled axes
  {
    const ox = Math.round(-cam.x * zoom + halfW) - 0.5;
    const oy = Math.round(-cam.y * zoom + halfH) - 0.5;
    ctx.strokeStyle = ORIGIN_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ox >= 0 && ox <= canvasW) { ctx.moveTo(ox, 0); ctx.lineTo(ox, canvasH); }
    if (oy >= 0 && oy <= canvasH) { ctx.moveTo(0, oy); ctx.lineTo(canvasW, oy); }
    ctx.stroke();
  }

  const gap = zoom >= 6 ? 0.5 : 0;

  // Chalk-dust smudges where cells died, fading with age
  for (const [key, diedAt] of engine.dust) {
    const wx = unpackX(key);
    const wy = unpackY(key);
    if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) continue;
    const age = Math.min(Math.max(gen - diedAt, 0), DUST_FADE);
    ctx.fillStyle = DUST_STYLES[age];
    const sx = (wx - cam.x) * zoom + halfW;
    const sy = (wy - cam.y) * zoom + halfH;
    ctx.fillRect(sx + gap, sy + gap, zoom - gap * 2, zoom - gap * 2);
  }

  // Settled cells in white chalk, this generation's births in yellow
  const births = engine.births;
  ctx.fillStyle = CHALK_HEX;
  for (const key of engine.alive) {
    if (births.has(key)) continue;
    const wx = unpackX(key);
    const wy = unpackY(key);
    if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) continue;
    const sx = (wx - cam.x) * zoom + halfW;
    const sy = (wy - cam.y) * zoom + halfH;
    ctx.fillRect(sx + gap, sy + gap, zoom - gap * 2, zoom - gap * 2);
  }
  if (births.size > 0) {
    ctx.fillStyle = FRESH_HEX;
    for (const key of births) {
      const wx = unpackX(key);
      const wy = unpackY(key);
      if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) continue;
      const sx = (wx - cam.x) * zoom + halfW;
      const sy = (wy - cam.y) * zoom + halfH;
      ctx.fillRect(sx + gap, sy + gap, zoom - gap * 2, zoom - gap * 2);
    }
  }
}

// ── Small pieces of chrome ───────────────────────────────────────────────

function Readout({ label, value, width }: { label: string; value: string; width?: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <span className={`gol-readout text-sm leading-none text-foreground ${width ?? ''}`}>
        {value}
      </span>
    </div>
  );
}

function TrayDivider() {
  return <div className="h-6 w-px self-center bg-border/70" />;
}

// ── React Component ──────────────────────────────────────────────────────

const GameOfLife = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GOLEngine | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: DEFAULT_ZOOM });
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // Interaction state (not React state to avoid re-renders)
  const interactionRef = useRef<{
    mode: 'draw' | 'pan' | null;
    drawMode: boolean | null; // true = set alive, false = set dead
    startMouseX: number;
    startMouseY: number;
    startCamX: number;
    startCamY: number;
    lastCellKey: number;
  }>({ mode: null, drawMode: null, startMouseX: 0, startMouseY: 0, startCamX: 0, startCamY: 0, lastCellKey: -1 });

  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [population, setPopulation] = useState(0);
  const [speed, setSpeed] = useState(10);
  const [zoomDisplay, setZoomDisplay] = useState(DEFAULT_ZOOM);
  const [showPatterns, setShowPatterns] = useState(false);
  const [benchResult, setBenchResult] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);

  // Ensure engine exists
  if (!engineRef.current) {
    engineRef.current = new GOLEngine();
  }

  // ── Imperative redraw ──

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFrame(ctx, engine, cameraRef.current, canvas.width, canvas.height);
  }, []);

  // ── Resize observer ──

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      canvasSizeRef.current = { w, h };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        redraw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // ── Wheel zoom (cursor-centered) ──

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // World coord under cursor before zoom
      const wx = screenToWorldX(mx, cam, canvas.width);
      const wy = screenToWorldY(my, cam, canvas.height);

      // Apply zoom
      const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
      cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));

      // Adjust camera so world coord stays under cursor
      cam.x = wx - (mx - canvas.width / 2) / cam.zoom;
      cam.y = wy - (my - canvas.height / 2) / cam.zoom;

      setZoomDisplay(Math.round(cam.zoom * 10) / 10);
      redraw();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [redraw]);

  // ── Prevent context menu on canvas ──

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => e.preventDefault();
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  // ── Clear drag/interaction on window-level mouseup ──
  // A drag released outside the canvas never fires the canvas mouseup, leaving
  // the interaction mode set so drawing resumes when the pointer re-enters.
  // Listening on the window guarantees the mode is always cleared on release.

  useEffect(() => {
    const handler = () => { interactionRef.current.mode = null; };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, []);

  // ── Simulation loop ──

  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    lastFrameRef.current = performance.now();

    const loop = (time: number) => {
      const elapsed = time - lastFrameRef.current;
      const interval = 1000 / speed;

      if (elapsed >= interval) {
        const steps = Math.min(Math.floor(elapsed / interval), 5);
        for (let i = 0; i < steps; i++) engine.step();
        lastFrameRef.current = time - (elapsed % interval);
        setGeneration(engine.generation);
        setPopulation(engine.alive.size);
      }

      redraw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [running, speed, redraw]);

  // ── Controls ──

  const handleInit = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const cam = cameraRef.current;
    const { w, h } = canvasSizeRef.current;
    const viewW = Math.ceil(w / cam.zoom);
    const viewH = Math.ceil(h / cam.zoom);
    engine.randomize(Math.round(cam.x), Math.round(cam.y), viewW, viewH);
    setGeneration(0);
    setPopulation(engine.alive.size);
    redraw();
  }, [redraw]);

  const handleClear = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.clear();
    setGeneration(0);
    setPopulation(0);
    redraw();
  }, [redraw]);

  const handleStep = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || running) return;
    engine.step();
    setGeneration(engine.generation);
    setPopulation(engine.alive.size);
    redraw();
  }, [running, redraw]);

  const handleHome = useCallback(() => {
    cameraRef.current = { x: 0, y: 0, zoom: DEFAULT_ZOOM };
    setZoomDisplay(DEFAULT_ZOOM);
    redraw();
  }, [redraw]);

  const handleZoomSlider = useCallback((val: number) => {
    const cam = cameraRef.current;
    cam.zoom = val;
    setZoomDisplay(Math.round(val * 10) / 10);
    redraw();
  }, [redraw]);

  const handleSelectPattern = useCallback((content: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const cam = cameraRef.current;
    engine.loadPattern(parseLif(content), Math.round(cam.x), Math.round(cam.y));
    setGeneration(0);
    setPopulation(engine.alive.size);
    setShowPatterns(false);
    redraw();
  }, [redraw]);

  // ── Benchmark ──

  const runBenchmark = useCallback(() => {
    if (running || benchRunning) return;
    setBenchRunning(true);
    setBenchResult(null);

    const engine = engineRef.current;
    if (!engine) return;

    let benchEngine: GOLEngine;
    if (engine.alive.size > 0) {
      benchEngine = engine.clone();
    } else {
      benchEngine = new GOLEngine();
      benchEngine.randomize(0, 0, 200, 200);
    }

    setTimeout(() => {
      const iterations = 1000;
      const start = performance.now();
      benchEngine.stepN(iterations);
      const elapsed = performance.now() - start;
      const gps = Math.round(iterations / (elapsed / 1000));
      setBenchResult(`${gps.toLocaleString()} gen/s (${iterations} in ${elapsed.toFixed(1)}ms)`);
      setBenchRunning(false);
    }, 50);
  }, [running, benchRunning]);

  // ── Mouse interaction ──

  const getWorldCell = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = cameraRef.current;
    return {
      x: Math.floor(screenToWorldX(mx, cam, canvas.width)),
      y: Math.floor(screenToWorldY(my, cam, canvas.height)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const inter = interactionRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (e.button === 1 || e.button === 2) {
      // Middle or right click: pan
      inter.mode = 'pan';
      inter.startMouseX = e.clientX - rect.left;
      inter.startMouseY = e.clientY - rect.top;
      inter.startCamX = cameraRef.current.x;
      inter.startCamY = cameraRef.current.y;
      return;
    }

    // Left click: draw
    const engine = engineRef.current;
    if (!engine) return;
    const cell = getWorldCell(e);
    if (!cell) return;

    inter.mode = 'draw';
    const key = pack(cell.x, cell.y);
    const isAlive = engine.toggle(cell.x, cell.y);
    inter.drawMode = isAlive; // subsequent drags set cells to this state
    inter.lastCellKey = key;
    setPopulation(engine.alive.size);
    redraw();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const inter = interactionRef.current;
    if (!inter.mode) return;

    if (inter.mode === 'pan') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cam = cameraRef.current;
      cam.x = inter.startCamX - (mx - inter.startMouseX) / cam.zoom;
      cam.y = inter.startCamY - (my - inter.startMouseY) / cam.zoom;
      redraw();
      return;
    }

    if (inter.mode === 'draw') {
      const engine = engineRef.current;
      if (!engine) return;
      const cell = getWorldCell(e);
      if (!cell) return;
      const key = pack(cell.x, cell.y);
      if (key === inter.lastCellKey) return;
      inter.lastCellKey = key;
      engine.set(cell.x, cell.y, inter.drawMode!);
      setPopulation(engine.alive.size);
      redraw();
    }
  };

  const handleMouseUp = () => {
    interactionRef.current.mode = null;
  };

  // ── Render ──

  const slateClean = population === 0 && generation === 0;

  return (
    <div className="absolute inset-0">
      {/* The slate */}
      <div ref={wrapperRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="block h-full w-full cursor-crosshair"
        />
      </div>

      {/* Vignette — the room's light falls off toward the board's edges */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 130% 100% at 50% 38%, transparent 55%, hsl(165 40% 2% / 0.4) 100%)',
        }}
      />

      {/* A clean slate — invitation, disappears at the first mark */}
      {slateClean && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <p
            className="text-2xl italic text-foreground/90"
            style={{ fontFamily: 'var(--font-display), serif' }}
          >
            A clean slate
          </p>
          <p className="text-xs text-muted-foreground">
            Drag to chalk cells, or load a pattern from the archive.
          </p>
        </div>
      )}

      {/* Readouts — top right */}
      {/* On phones the title plate owns the top edge — readouts drop below it */}
      <div className="absolute right-3 top-32 z-20 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <div className="gol-panel flex items-center gap-4 px-4 py-2">
          <Readout label="Gen" value={generation.toLocaleString()} />
          <div className="h-7 w-px bg-border/70" />
          <Readout label="Pop" value={population.toLocaleString()} />
          <div className="hidden h-7 w-px bg-border/70 sm:block" />
          <div className="hidden sm:block">
            <Readout label="Zoom" value={`${zoomDisplay.toFixed(1)}×`} />
          </div>
        </div>
        {benchResult && (
          <div className="gol-panel px-3 py-1.5">
            <span className="gol-readout text-[10px] text-muted-foreground">{benchResult}</span>
          </div>
        )}
      </div>

      {/* How to hold the chalk — bottom left */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-10 hidden lg:block">
        <p className="text-[11px] tracking-wide text-muted-foreground/80">
          left-drag draws · right-drag pans · scroll zooms
        </p>
      </div>

      {/* The chalk tray — bottom center */}
      <div className="gol-panel gol-tray absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3 py-2 sm:bottom-4">
        {/* Playback */}
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            className="h-8 w-8 rounded-full p-0"
            onClick={() => setRunning(!running)}
            title={running ? 'Pause' : 'Play'}
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleStep}
            disabled={running}
            title="Step one generation"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
        </div>

        <TrayDivider />

        {/* Speed */}
        <div className="flex items-center gap-2" title="Generations per second">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <Slider
            value={[speed]}
            onValueChange={(v) => setSpeed(v[0])}
            min={1}
            max={60}
            step={1}
            className="w-20"
          />
          <span className="gol-readout w-8 text-[10px] text-muted-foreground">{speed}/s</span>
        </div>

        <TrayDivider />

        {/* Zoom */}
        <div className="hidden items-center gap-2 sm:flex">
          <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
          <Slider
            value={[zoomDisplay]}
            onValueChange={(v) => handleZoomSlider(v[0])}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.5}
            className="w-20"
          />
          <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        <div className="hidden sm:block">
          <TrayDivider />
        </div>

        {/* Board actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={handleInit} title="Scatter a random soup across the view">
            <RotateCcw className="h-3 w-3" /> Soup
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={handleClear} title="Wipe the board">
            <Trash2 className="h-3 w-3" /> Wipe
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleHome} title="Return to the origin">
            <Home className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={runBenchmark}
            disabled={running || benchRunning}
            title="Benchmark the engine (1000 generations)"
          >
            <Zap className={`h-3 w-3 ${benchRunning ? 'animate-pulse' : ''}`} />
          </Button>
        </div>

        <TrayDivider />

        {/* The archive */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-primary/40 px-2.5 text-xs text-primary hover:border-primary/70 hover:text-primary"
          onClick={() => setShowPatterns(true)}
        >
          <Archive className="h-3.5 w-3.5" /> Archive
        </Button>
      </div>

      {/* Pattern archive drawer */}
      <PatternSelector
        open={showPatterns}
        onOpenChange={setShowPatterns}
        onSelect={handleSelectPattern}
      />
    </div>
  );
};

export default GameOfLife;
