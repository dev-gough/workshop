'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useTheme } from './ThemeProvider';
import PatternSelector from './PatternSelector';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Zap } from 'lucide-react';

interface GameOfLifeProps {
  width: number;
  height: number;
  cellSize?: number;
}

// ── Simulation Engine (decoupled from React) ──────────────────────────

class GOLEngine {
  rows: number;
  cols: number;
  // Double-buffered flat Uint8Array grids
  current: Uint8Array;
  next: Uint8Array;
  // Track changed cells for dirty-rect rendering
  changed: Uint32Array; // indices of changed cells
  changedCount: number;
  generation: number;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    const size = rows * cols;
    this.current = new Uint8Array(size);
    this.next = new Uint8Array(size);
    this.changed = new Uint32Array(size);
    this.changedCount = 0;
    this.generation = 0;
  }

  index(r: number, c: number): number {
    return r * this.cols + c;
  }

  get(r: number, c: number): number {
    return this.current[r * this.cols + c];
  }

  set(r: number, c: number, val: number) {
    const idx = r * this.cols + c;
    if (this.current[idx] !== val) {
      this.current[idx] = val;
      this.changed[this.changedCount++] = idx;
    }
  }

  toggle(r: number, c: number) {
    const idx = r * this.cols + c;
    this.current[idx] ^= 1;
    this.changed[this.changedCount++] = idx;
  }

  randomize() {
    const size = this.rows * this.cols;
    for (let i = 0; i < size; i++) {
      this.current[i] = Math.random() > 0.7 ? 1 : 0;
    }
    this.generation = 0;
    this.markAllChanged();
  }

  clear() {
    this.current.fill(0);
    this.generation = 0;
    this.markAllChanged();
  }

  markAllChanged() {
    const size = this.rows * this.cols;
    this.changedCount = size;
    for (let i = 0; i < size; i++) {
      this.changed[i] = i;
    }
  }

  // Optimized step: inline neighbor counting, no bounds checks for interior
  step() {
    const { rows, cols, current, next } = this;
    this.changedCount = 0;

    for (let r = 0; r < rows; r++) {
      const rAbove = r > 0 ? (r - 1) * cols : -1;
      const rCur = r * cols;
      const rBelow = r < rows - 1 ? (r + 1) * cols : -1;

      for (let c = 0; c < cols; c++) {
        let neighbors = 0;
        const cL = c - 1;
        const cR = c + 1;
        const hasLeft = c > 0;
        const hasRight = cR < cols;

        // Row above
        if (rAbove >= 0) {
          if (hasLeft)  neighbors += current[rAbove + cL];
          neighbors += current[rAbove + c];
          if (hasRight) neighbors += current[rAbove + cR];
        }
        // Current row
        if (hasLeft)  neighbors += current[rCur + cL];
        if (hasRight) neighbors += current[rCur + cR];
        // Row below
        if (rBelow >= 0) {
          if (hasLeft)  neighbors += current[rBelow + cL];
          neighbors += current[rBelow + c];
          if (hasRight) neighbors += current[rBelow + cR];
        }

        const idx = rCur + c;
        const alive = current[idx];
        // Birth: dead cell with exactly 3 neighbors
        // Survive: alive cell with 2 or 3 neighbors
        const newVal = neighbors === 3 || (neighbors === 2 && alive) ? 1 : 0;
        next[idx] = newVal;

        if (newVal !== alive) {
          this.changed[this.changedCount++] = idx;
        }
      }
    }

    // Swap buffers
    const tmp = this.current;
    this.current = this.next;
    this.next = tmp;
    this.generation++;
  }

  // Run N steps without tracking changes (for benchmarking)
  stepN(n: number) {
    const { rows, cols } = this;
    for (let s = 0; s < n; s++) {
      const current = this.current;
      const next = this.next;
      for (let r = 0; r < rows; r++) {
        const rAbove = r > 0 ? (r - 1) * cols : -1;
        const rCur = r * cols;
        const rBelow = r < rows - 1 ? (r + 1) * cols : -1;
        for (let c = 0; c < cols; c++) {
          let neighbors = 0;
          const cL = c - 1;
          const cR = c + 1;
          const hasLeft = c > 0;
          const hasRight = cR < cols;
          if (rAbove >= 0) {
            if (hasLeft)  neighbors += current[rAbove + cL];
            neighbors += current[rAbove + c];
            if (hasRight) neighbors += current[rAbove + cR];
          }
          if (hasLeft)  neighbors += current[rCur + cL];
          if (hasRight) neighbors += current[rCur + cR];
          if (rBelow >= 0) {
            if (hasLeft)  neighbors += current[rBelow + cL];
            neighbors += current[rBelow + c];
            if (hasRight) neighbors += current[rBelow + cR];
          }
          next[rCur + c] = neighbors === 3 || (neighbors === 2 && current[rCur + c]) ? 1 : 0;
        }
      }
      const tmp = this.current;
      this.current = this.next;
      this.next = tmp;
      this.generation++;
    }
    this.markAllChanged();
  }

  resize(newRows: number, newCols: number) {
    // Preserve pattern in the overlapping region
    const oldCurrent = this.current;
    const oldRows = this.rows;
    const oldCols = this.cols;

    this.rows = newRows;
    this.cols = newCols;
    const size = newRows * newCols;
    this.current = new Uint8Array(size);
    this.next = new Uint8Array(size);
    this.changed = new Uint32Array(size);

    const copyRows = Math.min(oldRows, newRows);
    const copyCols = Math.min(oldCols, newCols);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        this.current[r * newCols + c] = oldCurrent[r * oldCols + c];
      }
    }
    this.markAllChanged();
  }

  loadPattern(pattern: { x: number; y: number }[]) {
    this.clear();
    const offsetX = Math.floor(this.cols / 2) - Math.floor(Math.max(...pattern.map(p => p.x)) / 2);
    const offsetY = Math.floor(this.rows / 2) - Math.floor(Math.max(...pattern.map(p => p.y)) / 2);
    for (const cell of pattern) {
      const c = cell.x + offsetX;
      const r = cell.y + offsetY;
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
        this.current[r * this.cols + c] = 1;
      }
    }
    this.generation = 0;
    this.markAllChanged();
  }
}

// ── Parse .lif file ───────────────────────────────────────────────────

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

// ── React Component ───────────────────────────────────────────────────

const GameOfLife = ({ width, height, cellSize = 10 }: GameOfLifeProps) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GOLEngine | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const draggedRef = useRef<Set<number>>(new Set());

  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [speed, setSpeed] = useState(10);
  const [scale, setScale] = useState(1);
  const [showPatterns, setShowPatterns] = useState(false);
  const [benchResult, setBenchResult] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);

  const { rows, cols, scaledCellSize } = useMemo(() => {
    const s = cellSize * scale;
    return { scaledCellSize: s, rows: Math.floor(height / s), cols: Math.floor(width / s) };
  }, [cellSize, scale, width, height]);

  // Initialize or resize engine
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new GOLEngine(rows, cols);
      engineRef.current.randomize();
    } else {
      engineRef.current.resize(rows, cols);
    }
    setGeneration(engineRef.current.generation);
    drawFull();
  }, [rows, cols]);

  // Redraw on theme change
  useEffect(() => { drawFull(); }, [theme]);

  // ── Drawing ──

  const getFillColor = () => theme === 'dark' ? '#e2e8f0' : '#0f172a';
  const getBgColor = () => theme === 'dark' ? 'hsl(224,35%,11%)' : 'hsl(0,0%,99%)';

  function drawFull() {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cs = cellSize * scale;
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = getFillColor();
    for (let r = 0; r < engine.rows; r++) {
      const rOff = r * engine.cols;
      for (let c = 0; c < engine.cols; c++) {
        if (engine.current[rOff + c]) {
          ctx.fillRect(c * cs, r * cs, cs, cs);
        }
      }
    }
  }

  function drawDirty() {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cs = cellSize * scale;
    const fill = getFillColor();
    const bg = getBgColor();

    for (let i = 0; i < engine.changedCount; i++) {
      const idx = engine.changed[i];
      const r = (idx / engine.cols) | 0;
      const c = idx % engine.cols;
      if (engine.current[idx]) {
        ctx.fillStyle = fill;
      } else {
        ctx.fillStyle = bg;
      }
      ctx.fillRect(c * cs, r * cs, cs, cs);
    }
  }

  // ── Simulation loop using requestAnimationFrame ──

  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    lastFrameRef.current = performance.now();

    const loop = (time: number) => {
      const elapsed = time - lastFrameRef.current;
      const interval = 1000 / speed;

      if (elapsed >= interval) {
        // Calculate how many steps to take (catch up if behind)
        const steps = Math.min(Math.floor(elapsed / interval), 5);
        for (let i = 0; i < steps; i++) {
          engine.step();
        }
        drawDirty();
        setGeneration(engine.generation);
        lastFrameRef.current = time - (elapsed % interval);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); };
  }, [running, speed, scale, theme]);

  // ── Controls ──

  const handleInit = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.randomize();
    setGeneration(0);
    drawFull();
  };

  const handleClear = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.clear();
    setGeneration(0);
    drawFull();
  };

  const handleScaleChange = (newScale: number) => {
    if (running) return;
    setScale(newScale);
    // Engine will resize via the useEffect on [rows, cols]
  };

  const handleSelectPattern = (content: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.loadPattern(parseLif(content));
    setGeneration(0);
    setShowPatterns(false);
    drawFull();
  };

  // ── Benchmark ──

  const runBenchmark = () => {
    if (running || benchRunning) return;
    setBenchRunning(true);
    setBenchResult(null);

    // Use a separate engine instance so we don't modify the displayed grid
    const benchEngine = new GOLEngine(rows, cols);
    benchEngine.randomize();

    // Run in a setTimeout to let React render the "running" state
    setTimeout(() => {
      const iterations = 1000;
      const start = performance.now();
      benchEngine.stepN(iterations);
      const elapsed = performance.now() - start;
      const gps = Math.round(iterations / (elapsed / 1000));
      setBenchResult(`${gps.toLocaleString()} gen/s (${iterations} gens in ${elapsed.toFixed(1)}ms on ${rows}x${cols} grid)`);
      setBenchRunning(false);
    }, 50);
  };

  // ── Mouse interaction (refs, no React state updates per move) ──

  const getCellPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cs = cellSize * scale;
    const c = Math.floor(x / cs);
    const r = Math.floor(y / cs);
    if (r >= 0 && r < rows && c >= 0 && c < cols) return { r, c };
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCellPos(e);
    const engine = engineRef.current;
    if (!pos || !engine) return;
    isDraggingRef.current = true;
    draggedRef.current = new Set([pos.r * cols + pos.c]);
    engine.toggle(pos.r, pos.c);
    drawDirty();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const pos = getCellPos(e);
    const engine = engineRef.current;
    if (!pos || !engine) return;
    const key = pos.r * cols + pos.c;
    if (!draggedRef.current.has(key)) {
      draggedRef.current.add(key);
      engine.toggle(pos.r, pos.c);
      drawDirty();
    }
  };

  const handleMouseUp = () => { isDraggingRef.current = false; };

  // ── Render ──

  return (
    <>
      <div className="flex flex-col items-center">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="border border-border cursor-pointer rounded-md"
        />
      </div>
      <div className="mt-4 w-full flex items-center">
        <div className="flex-1" />
        <div className="flex gap-3 items-center flex-wrap justify-center">
          <div className="flex flex-col items-center gap-1">
            <label className="text-xs text-muted-foreground">Speed: {speed}/s</label>
            <Slider
              value={[speed]}
              onValueChange={(v) => setSpeed(v[0])}
              min={1}
              max={60}
              step={1}
              className="w-24"
            />
          </div>
          <div className="flex flex-col items-center gap-1">
            <label className="text-xs text-muted-foreground">Scale: {scale.toFixed(1)}x</label>
            <Slider
              value={[scale]}
              onValueChange={(v) => handleScaleChange(v[0])}
              min={0.5}
              max={3}
              step={0.1}
              className="w-24"
            />
          </div>
          <Button onClick={() => setRunning(!running)}>
            {running ? 'Pause' : 'Play'}
          </Button>
          <Button variant="secondary" onClick={handleInit}>
            Reset
          </Button>
          <Button variant="destructive" onClick={handleClear}>
            Clear
          </Button>
          <Button variant="outline" onClick={() => setShowPatterns(true)}>
            Patterns
          </Button>
          <Button
            variant="outline"
            onClick={runBenchmark}
            disabled={running || benchRunning}
            className="gap-1"
          >
            <Zap className="h-4 w-4" />
            {benchRunning ? 'Running...' : 'Benchmark'}
          </Button>
        </div>
        <div className="flex-1 flex flex-col items-end gap-1">
          <Badge variant="outline">Generation: {generation}</Badge>
          {benchResult && (
            <Badge variant="secondary" className="text-xs font-mono">
              {benchResult}
            </Badge>
          )}
        </div>
      </div>
      <PatternSelector
        open={showPatterns}
        onOpenChange={setShowPatterns}
        onSelect={handleSelectPattern}
      />
    </>
  );
};

export default GameOfLife;
