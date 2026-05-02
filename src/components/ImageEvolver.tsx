'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, RotateCcw, Upload, Gauge, Image as ImageIcon,
  Triangle,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ── Types ────────────────────────────────────────────────────────────────

interface Polygon {
  vertices: [number, number][];
  r: number; g: number; b: number; a: number;
}

interface Candidate {
  polygons: Polygon[];
  fitness: number;
}

// ── Preset images (drawn procedurally) ───────────────────────────────────

function createPresetCanvas(name: string): HTMLCanvasElement {
  const size = 100;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;

  if (name === 'sunset') {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#1a0533');
    grad.addColorStop(0.3, '#6b1839');
    grad.addColorStop(0.5, '#e85d26');
    grad.addColorStop(0.7, '#f7b733');
    grad.addColorStop(0.85, '#1a6b8a');
    grad.addColorStop(1, '#0a2342');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#f7c948';
    ctx.beginPath(); ctx.arc(50, 48, 14, 0, Math.PI * 2); ctx.fill();
  } else if (name === 'mondrian') {
    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#d40000'; ctx.fillRect(2, 2, 40, 55);
    ctx.fillStyle = '#0033a0'; ctx.fillRect(60, 65, 38, 33);
    ctx.fillStyle = '#ffdd00'; ctx.fillRect(60, 2, 15, 25);
    ctx.fillStyle = '#222'; ctx.fillRect(0, 57, size, 4);
    ctx.fillRect(44, 0, 4, size); ctx.fillRect(57, 0, 4, 62);
    ctx.fillRect(0, 28, 44, 3);
  } else if (name === 'face') {
    ctx.fillStyle = '#4a90d9'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.arc(50, 50, 35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(38, 42, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(62, 42, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(50, 55, 15, 0.2, Math.PI - 0.2); ctx.stroke();
  } else if (name === 'landscape') {
    const sky = ctx.createLinearGradient(0, 0, 0, 60);
    sky.addColorStop(0, '#87ceeb'); sky.addColorStop(1, '#e0f0ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, size, 60);
    ctx.fillStyle = '#4a8c3f'; ctx.fillRect(0, 60, size, 40);
    ctx.fillStyle = '#3b6e35';
    ctx.beginPath(); ctx.moveTo(10, 60); ctx.lineTo(35, 25); ctx.lineTo(60, 60); ctx.fill();
    ctx.fillStyle = '#4a7a42';
    ctx.beginPath(); ctx.moveTo(45, 60); ctx.lineTo(75, 20); ctx.lineTo(95, 60); ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.beginPath(); ctx.moveTo(65, 20); ctx.lineTo(75, 10); ctx.lineTo(85, 20); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(20, 15, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(28, 13, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 14, 5, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

const PRESETS = [
  { name: 'sunset', label: 'Sunset' },
  { name: 'mondrian', label: 'Mondrian' },
  { name: 'face', label: 'Smiley' },
  { name: 'landscape', label: 'Landscape' },
];

// ── Engine ────────────────────────────────────────────────────────────────

const WORK_SIZE = 100;

function randomPolygon(): Polygon {
  const cx = Math.random(), cy = Math.random();
  const verts: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    verts.push([cx + (Math.random() - 0.5) * 0.3, cy + (Math.random() - 0.5) * 0.3]);
  }
  return {
    vertices: verts,
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
    a: Math.random() * 0.5 + 0.1,
  };
}

function cloneCandidate(c: Candidate): Candidate {
  return {
    fitness: c.fitness,
    polygons: c.polygons.map(p => ({
      vertices: p.vertices.map(v => [v[0], v[1]] as [number, number]),
      r: p.r, g: p.g, b: p.b, a: p.a,
    })),
  };
}

function renderCandidate(ctx: CanvasRenderingContext2D, c: Candidate, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const p of c.polygons) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath();
    ctx.moveTo(p.vertices[0][0] * w, p.vertices[0][1] * h);
    for (let i = 1; i < p.vertices.length; i++) {
      ctx.lineTo(p.vertices[i][0] * w, p.vertices[i][1] * h);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function computeFitness(
  ctx: CanvasRenderingContext2D,
  candidate: Candidate,
  targetData: Uint8ClampedArray,
  w: number, h: number,
): number {
  renderCandidate(ctx, candidate, w, h);
  const candidateData = ctx.getImageData(0, 0, w, h).data;
  let diff = 0;
  for (let i = 0; i < candidateData.length; i += 4) {
    const dr = candidateData[i] - targetData[i];
    const dg = candidateData[i + 1] - targetData[i + 1];
    const db = candidateData[i + 2] - targetData[i + 2];
    diff += dr * dr + dg * dg + db * db;
  }
  // Normalize: 0 = perfect, 1 = worst
  const maxDiff = w * h * 3 * 255 * 255;
  return diff / maxDiff;
}

function gaussRand(): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

class ImageEvolverEngine {
  population: Candidate[];
  best: Candidate;
  generation: number;
  targetData: Uint8ClampedArray;
  offscreen: CanvasRenderingContext2D;
  popSize: number;
  mutationRate: number;
  maxPolygons: number;

  constructor(targetData: Uint8ClampedArray, popSize: number, mutationRate: number, maxPolygons: number) {
    this.targetData = targetData;
    this.popSize = popSize;
    this.mutationRate = mutationRate;
    this.maxPolygons = maxPolygons;
    this.generation = 0;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = WORK_SIZE; offCanvas.height = WORK_SIZE;
    this.offscreen = offCanvas.getContext('2d', { willReadFrequently: true })!;

    this.population = [];
    for (let i = 0; i < popSize; i++) {
      const c: Candidate = { polygons: [], fitness: 1 };
      const nPolys = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < nPolys; j++) c.polygons.push(randomPolygon());
      c.fitness = computeFitness(this.offscreen, c, this.targetData, WORK_SIZE, WORK_SIZE);
      this.population.push(c);
    }
    this.population.sort((a, b) => a.fitness - b.fitness);
    this.best = cloneCandidate(this.population[0]);
  }

  tournamentSelect(k: number = 3): Candidate {
    let best: Candidate | null = null;
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      if (!best || this.population[idx].fitness < best.fitness) {
        best = this.population[idx];
      }
    }
    return best!;
  }

  crossover(a: Candidate, b: Candidate): Candidate {
    const aPolys = a.polygons;
    const bPolys = b.polygons;
    const maxLen = Math.max(aPolys.length, bPolys.length);
    const child: Polygon[] = [];
    for (let i = 0; i < maxLen; i++) {
      if (i < aPolys.length && i < bPolys.length) {
        child.push(Math.random() < 0.5 ? { ...aPolys[i], vertices: aPolys[i].vertices.map(v => [...v] as [number, number]) } : { ...bPolys[i], vertices: bPolys[i].vertices.map(v => [...v] as [number, number]) });
      } else if (i < aPolys.length) {
        if (Math.random() < 0.5) child.push({ ...aPolys[i], vertices: aPolys[i].vertices.map(v => [...v] as [number, number]) });
      } else {
        if (Math.random() < 0.5) child.push({ ...bPolys[i], vertices: bPolys[i].vertices.map(v => [...v] as [number, number]) });
      }
    }
    if (child.length === 0) child.push(randomPolygon());
    return { polygons: child, fitness: 1 };
  }

  mutate(c: Candidate) {
    const rate = this.mutationRate;

    for (const p of c.polygons) {
      for (const v of p.vertices) {
        if (Math.random() < rate) v[0] = clamp(v[0] + gaussRand() * 0.05, 0, 1);
        if (Math.random() < rate) v[1] = clamp(v[1] + gaussRand() * 0.05, 0, 1);
      }
      if (Math.random() < rate) p.r = clamp(Math.round(p.r + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.g = clamp(Math.round(p.g + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.b = clamp(Math.round(p.b + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.a = clamp(p.a + gaussRand() * 0.1, 0.05, 0.95);
    }

    // Add polygon
    if (Math.random() < rate * 0.5 && c.polygons.length < this.maxPolygons) {
      c.polygons.push(randomPolygon());
    }
    // Remove polygon
    if (Math.random() < rate * 0.3 && c.polygons.length > 1) {
      c.polygons.splice(Math.floor(Math.random() * c.polygons.length), 1);
    }
    // Reorder
    if (Math.random() < rate * 0.2 && c.polygons.length > 1) {
      const i = Math.floor(Math.random() * c.polygons.length);
      const j = Math.floor(Math.random() * c.polygons.length);
      [c.polygons[i], c.polygons[j]] = [c.polygons[j], c.polygons[i]];
    }
  }

  step() {
    const eliteCount = Math.max(2, Math.floor(this.popSize * 0.1));
    this.population.sort((a, b) => a.fitness - b.fitness);

    const next: Candidate[] = [];
    // Elites
    for (let i = 0; i < eliteCount; i++) {
      next.push(cloneCandidate(this.population[i]));
    }
    // Fill rest
    while (next.length < this.popSize) {
      const a = this.tournamentSelect();
      const b = this.tournamentSelect();
      const child = this.crossover(a, b);
      this.mutate(child);
      child.fitness = computeFitness(this.offscreen, child, this.targetData, WORK_SIZE, WORK_SIZE);
      next.push(child);
    }

    this.population = next;
    this.population.sort((a, b) => a.fitness - b.fitness);
    if (this.population[0].fitness < this.best.fitness) {
      this.best = cloneCandidate(this.population[0]);
    }
    this.generation++;
  }
}

// ── React Component ──────────────────────────────────────────────────────

const ImageEvolver = () => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ImageEvolverEngine | null>(null);
  const targetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [fitness, setFitness] = useState(0);
  const [polyCount, setPolyCount] = useState(0);
  const [speed, setSpeed] = useState(10);
  const [popSize, setPopSize] = useState(50);
  const [mutationRate, setMutationRate] = useState(0.08);
  const [maxPolygons, setMaxPolygons] = useState(75);
  const [targetLoaded, setTargetLoaded] = useState(false);
  const [presetName, setPresetName] = useState('sunset');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load target image and initialize engine
  const initWithTarget = useCallback((targetCanvas: HTMLCanvasElement) => {
    targetCanvasRef.current = targetCanvas;
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
    const targetData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;
    engineRef.current = new ImageEvolverEngine(targetData, popSize, mutationRate, maxPolygons);
    setGeneration(0);
    setFitness(0);
    setPolyCount(0);
    setTargetLoaded(true);
  }, [popSize, mutationRate, maxPolygons]);

  // Load preset on mount
  useEffect(() => {
    const c = createPresetCanvas(presetName);
    initWithTarget(c);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPreset = useCallback((name: string) => {
    setRunning(false);
    setPresetName(name);
    const c = createPresetCanvas(name);
    initWithTarget(c);
  }, [initWithTarget]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRunning(false);
    const img = new window.Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = WORK_SIZE; c.height = WORK_SIZE;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, WORK_SIZE, WORK_SIZE);
      setPresetName('');
      initWithTarget(c);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }, [initWithTarget]);

  const handleReset = useCallback(() => {
    setRunning(false);
    if (targetCanvasRef.current) {
      const ctx = targetCanvasRef.current.getContext('2d', { willReadFrequently: true })!;
      const targetData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;
      engineRef.current = new ImageEvolverEngine(targetData, popSize, mutationRate, maxPolygons);
      setGeneration(0);
      setFitness(0);
      setPolyCount(0);
    }
  }, [popSize, mutationRate, maxPolygons]);

  // Update engine params on the fly
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.mutationRate = mutationRate;
    engine.maxPolygons = maxPolygons;
  }, [mutationRate, maxPolygons]);

  // ── Drawing ──

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const target = targetCanvasRef.current;
    if (!canvas || !engine || !target) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = canvasSizeRef.current;
    if (w === 0 || h === 0) return;

    const isDark = themeRef.current === 'dark';
    const bgColor = isDark ? 'hsl(224,35%,11%)' : 'hsl(0,0%,96%)';
    const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Layout: target on left, best on right, centered with gap
    const gap = 16;
    const labelH = 24;
    const availW = w - gap;
    const availH = h - labelH;
    const imgSize = Math.min(availW / 2, availH);
    const startX = (w - imgSize * 2 - gap) / 2;
    const startY = labelH + (availH - imgSize) / 2;

    // Labels
    ctx.fillStyle = textColor;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Target', startX + imgSize / 2, startY - 6);
    ctx.fillText('Best', startX + imgSize + gap + imgSize / 2, startY - 6);

    // Target image
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(target, startX, startY, imgSize, imgSize);

    // Best candidate
    const offCanvas = document.createElement('canvas');
    offCanvas.width = WORK_SIZE; offCanvas.height = WORK_SIZE;
    const offCtx = offCanvas.getContext('2d')!;
    renderCandidate(offCtx, engine.best, WORK_SIZE, WORK_SIZE);
    ctx.drawImage(offCanvas, startX + imgSize + gap, startY, imgSize, imgSize);

    // Borders
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, startY, imgSize, imgSize);
    ctx.strokeRect(startX + imgSize + gap, startY, imgSize, imgSize);
  }, []);

  // ── Resize ──

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

  // ── Simulation loop (time-based: speed = generations per second) ──

  useEffect(() => {
    if (!running || !targetLoaded) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    let lastTime = performance.now();
    let accumulator = 0;

    const loop = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      accumulator += dt;

      const interval = 1000 / speed;
      const maxSteps = Math.min(Math.floor(accumulator / interval), 5);
      if (maxSteps > 0) {
        for (let i = 0; i < maxSteps; i++) engine.step();
        accumulator -= maxSteps * interval;
        setGeneration(engine.generation);
        setFitness(Math.round((1 - engine.best.fitness) * 10000) / 100);
        setPolyCount(engine.best.polygons.length);
      }
      redraw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [running, speed, targetLoaded, redraw]);

  // Redraw on theme change
  useEffect(() => { redraw(); }, [theme, redraw]);

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
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Speed */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              <Slider value={[speed]} onValueChange={(v) => setSpeed(v[0])} min={1} max={60} step={1} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-10 tabular-nums">{speed}g/s</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Generations per second &mdash; how fast the algorithm evolves</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        {/* Mutation */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Mut</span>
              <Slider value={[mutationRate]} onValueChange={(v) => setMutationRate(v[0])} min={0.01} max={0.3} step={0.01} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-8 tabular-nums">{(mutationRate * 100).toFixed(0)}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Mutation rate &mdash; probability each gene changes per generation</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        {/* Max polygons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Triangle className="h-3 w-3 text-muted-foreground" />
              <Slider value={[maxPolygons]} onValueChange={(v) => setMaxPolygons(v[0])} min={10} max={200} step={5} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-6 tabular-nums">{maxPolygons}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Max polygons &mdash; upper limit on triangles per candidate</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3 w-3" /> Upload
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Presets */}
        <div className="flex items-center gap-1">
          {PRESETS.map(p => (
            <Button
              key={p.name}
              variant={presetName === p.name ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => loadPreset(p.name)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Gen</span>
            <span className="font-mono tabular-nums font-medium">{generation.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Fit</span>
            <span className="font-mono tabular-nums font-medium">{fitness.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Triangle className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono tabular-nums font-medium">{polyCount}</span>
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
          className="block w-full h-full"
        />
      </div>
    </div>
  );
};

export default ImageEvolver;
