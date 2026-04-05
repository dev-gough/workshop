'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import PatternSelector from './PatternSelector';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, RotateCcw, Trash2, Grid3X3, Zap, SkipForward,
  ZoomIn, ZoomOut, Gauge, Home,
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

  constructor() {
    this.alive = new Set();
    this.generation = 0;
  }

  get(x: number, y: number): boolean {
    return this.alive.has(pack(x, y));
  }

  set(x: number, y: number, val: boolean) {
    const key = pack(x, y);
    if (val) this.alive.add(key);
    else this.alive.delete(key);
  }

  toggle(x: number, y: number): boolean {
    const key = pack(x, y);
    if (this.alive.has(key)) {
      this.alive.delete(key);
      return false;
    }
    this.alive.add(key);
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
    for (const [key, count] of counts) {
      if (count === 3 || (count === 2 && this.alive.has(key))) {
        next.add(key);
      }
    }
    this.alive = next;
    this.generation++;
  }

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
  }

  randomize(cx: number, cy: number, w: number, h: number) {
    this.alive = new Set();
    this.generation = 0;
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
      this.alive.add(pack(c.x + ox, c.y + oy));
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

// ── Parse .lif file ──────────────────────────────────────────────────────

function parseLif(content: string): { x: number; y: number }[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && (!l.startsWith('#') || l.startsWith('#P')));
  let cx = 0, cy = 0;
  const pattern: { x: number; y: number }[] = [];
  for (const line of lines) {
    if (line.startsWith('#P')) {
      const parts = line.split(/\s+/);
      cx = parseInt(parts[1]);
      cy = parseInt(parts[2]);
    } else {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '*') pattern.push({ x: cx + i, y: cy });
      }
      cy++;
    }
  }
  const minX = Math.min(...pattern.map(p => p.x));
  const minY = Math.min(...pattern.map(p => p.y));
  return pattern.map(p => ({ x: p.x - minX, y: p.y - minY }));
}

// ── Drawing ──────────────────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  engine: GOLEngine,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  isDark: boolean,
) {
  const fillColor = isDark ? '#e2e8f0' : '#0f172a';
  const bgColor = isDark ? 'hsl(224,35%,11%)' : 'hsl(0,0%,99%)';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const originColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';

  const zoom = cam.zoom;
  const bounds = getVisibleBounds(cam, canvasW, canvasH);

  // Use ImageData for pixel-level rendering at very low zoom
  if (zoom <= 2) {
    const imageData = ctx.createImageData(canvasW, canvasH);
    const data = imageData.data;

    // Fill background
    const bgR = isDark ? 19 : 252;
    const bgG = isDark ? 22 : 252;
    const bgB = isDark ? 33 : 252;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB; data[i + 3] = 255;
    }

    const fillR = isDark ? 226 : 15;
    const fillG = isDark ? 232 : 23;
    const fillB = isDark ? 240 : 42;
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;

    if (zoom <= 1) {
      for (const key of engine.alive) {
        const wx = unpackX(key);
        const wy = unpackY(key);
        const sx = Math.round((wx - cam.x) * zoom + halfW);
        const sy = Math.round((wy - cam.y) * zoom + halfH);
        if (sx >= 0 && sx < canvasW && sy >= 0 && sy < canvasH) {
          const idx = (sy * canvasW + sx) * 4;
          data[idx] = fillR; data[idx + 1] = fillG; data[idx + 2] = fillB;
        }
      }
    } else {
      // zoom ~2: draw 2x2 blocks
      for (const key of engine.alive) {
        const wx = unpackX(key);
        const wy = unpackY(key);
        const sx = Math.floor((wx - cam.x) * zoom + halfW);
        const sy = Math.floor((wy - cam.y) * zoom + halfH);
        const size = Math.ceil(zoom);
        for (let py = sy; py < sy + size && py < canvasH; py++) {
          if (py < 0) continue;
          for (let px = sx; px < sx + size && px < canvasW; px++) {
            if (px < 0) continue;
            const idx = (py * canvasW + px) * 4;
            data[idx] = fillR; data[idx + 1] = fillG; data[idx + 2] = fillB;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // Standard fillRect path
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Grid lines at higher zoom
  if (zoom >= 8) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;

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

  // Origin crosshair
  {
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;
    const ox = Math.round(-cam.x * zoom + halfW) - 0.5;
    const oy = Math.round(-cam.y * zoom + halfH) - 0.5;
    ctx.strokeStyle = originColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ox >= 0 && ox <= canvasW) { ctx.moveTo(ox, 0); ctx.lineTo(ox, canvasH); }
    if (oy >= 0 && oy <= canvasH) { ctx.moveTo(0, oy); ctx.lineTo(canvasW, oy); }
    ctx.stroke();
  }

  // Draw alive cells
  ctx.fillStyle = fillColor;
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  const gap = zoom >= 6 ? 0.5 : 0;

  for (const key of engine.alive) {
    const wx = unpackX(key);
    const wy = unpackY(key);
    if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) continue;
    const sx = (wx - cam.x) * zoom + halfW;
    const sy = (wy - cam.y) * zoom + halfH;
    ctx.fillRect(sx + gap, sy + gap, zoom - gap * 2, zoom - gap * 2);
  }
}

// ── React Component ──────────────────────────────────────────────────────

const GameOfLife = () => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GOLEngine | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: DEFAULT_ZOOM });
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;

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
    drawFrame(ctx, engine, cameraRef.current, canvas.width, canvas.height, themeRef.current === 'dark');
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

  // Redraw on theme change
  useEffect(() => { redraw(); }, [theme, redraw]);

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

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-2 bg-card rounded-lg border border-border">
        {/* Playback */}
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setRunning(!running)}
            title={running ? 'Pause' : 'Play'}
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleStep}
            disabled={running}
            title="Step forward"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Speed */}
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <Slider
            value={[speed]}
            onValueChange={(v) => setSpeed(v[0])}
            min={1}
            max={60}
            step={1}
            className="w-20"
          />
          <span className="text-[10px] text-muted-foreground w-8 tabular-nums">{speed}/s</span>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Zoom */}
        <div className="flex items-center gap-2">
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
          <span className="text-[10px] text-muted-foreground w-10 tabular-nums">{zoomDisplay.toFixed(1)}x</span>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={handleInit} title="Randomize">
            <RotateCcw className="h-3 w-3" /> Random
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={handleClear} title="Clear">
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => setShowPatterns(true)}>
            <Grid3X3 className="h-3 w-3" /> Patterns
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleHome} title="Reset view to origin">
            <Home className="h-3 w-3" />
          </Button>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Benchmark */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 px-2"
          onClick={runBenchmark}
          disabled={running || benchRunning}
        >
          <Zap className="h-3 w-3" />
          {benchRunning ? 'Running...' : 'Bench'}
        </Button>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto">
          {benchResult && (
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">{benchResult}</span>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Gen</span>
            <span className="font-mono tabular-nums font-medium">{generation.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Pop</span>
            <span className="font-mono tabular-nums font-medium">{population.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden bg-card"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-crosshair block w-full h-full"
        />
      </div>

      {/* Pattern Selector */}
      <PatternSelector
        open={showPatterns}
        onOpenChange={setShowPatterns}
        onSelect={handleSelectPattern}
      />
    </div>
  );
};

export default GameOfLife;
