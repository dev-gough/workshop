'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, FastForward, RotateCcw } from 'lucide-react';
import { BFInterpreter, executionCounts, MEMORY_SIZE } from '@/lib/brainfuck-interpreter';

interface Props {
  gene: string;
  // Optional sparkline data: progress trail of (gen, fitness) pairs.
  fitnessTrail?: { gen: number; fitness: number }[];
  targetFitness?: number;
  // "next gene" indicator — shown if a newer best gene came in mid-animation.
  pendingGene?: string | null;
  pendingLabel?: string;
  height?: number;
  compact?: boolean;
  // Fires after one complete play+pause cycle, just before the interpreter
  // resets. Parent uses this to swap to a newer best gene without a jarring
  // mid-execution reset.
  onCycleEnd?: () => void;
}

const SPEEDS = [1, 4, 16, 64, 256];
const MEM_WINDOW = 32; // visible memory cells
const FLASH_MS = 350;
const POST_RUN_PAUSE_MS = 1200;

type FlashMap = Map<number, number>; // cell idx → timestamp of write

export default function BrainfuckAnimator({
  gene,
  fitnessTrail,
  targetFitness,
  pendingGene,
  pendingLabel,
  height = 360,
  compact = false,
  onCycleEnd,
}: Props) {
  const onCycleEndRef = useRef(onCycleEnd);
  onCycleEndRef.current = onCycleEnd;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const interpreterRef = useRef<BFInterpreter | null>(null);
  const countsRef = useRef<Int32Array | null>(null);
  const flashesRef = useRef<FlashMap>(new Map());
  const viewCenterRef = useRef<number>(0); // smooth-tracked data ptr for scrolling
  const haltedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const [speedIdx, setSpeedIdx] = useState(2); // default 16×
  const [playing, setPlaying] = useState(true);
  const [, setTick] = useState(0); // force re-render on gene-swap so UI labels update

  // (Re)initialize interpreter when gene changes (debounced — caller passes finalized gene).
  useEffect(() => {
    if (!gene) {
      interpreterRef.current = null;
      countsRef.current = null;
      return;
    }
    interpreterRef.current = new BFInterpreter(gene);
    countsRef.current = executionCounts(gene);
    flashesRef.current.clear();
    viewCenterRef.current = 0;
    haltedAtRef.current = null;
    setTick((t) => t + 1);
  }, [gene]);

  // rAF loop
  useEffect(() => {
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const canvas = canvasRef.current;
      const interp = interpreterRef.current;
      if (canvas && interp) {
        const speed = SPEEDS[speedIdx];

        // Advance N steps per frame. Skip stepping if paused or halted.
        if (playing && !interp.done && !interp.truncated) {
          for (let i = 0; i < speed; i++) {
            const moreToGo = interp.step();
            if (interp.lastWritten >= 0) {
              flashesRef.current.set(interp.lastWritten, performance.now());
            }
            if (!moreToGo) {
              haltedAtRef.current = performance.now();
              break;
            }
          }
        }

        // After a pause post-completion, reset and replay (or swap to pendingGene).
        if (
          playing &&
          haltedAtRef.current != null &&
          performance.now() - haltedAtRef.current > POST_RUN_PAUSE_MS
        ) {
          onCycleEndRef.current?.();
          interp.reset();
          flashesRef.current.clear();
          haltedAtRef.current = null;
        }

        // Smooth view-scroll toward data ptr
        const target = interp.dataPtr;
        const cur = viewCenterRef.current;
        viewCenterRef.current = cur + (target - cur) * 0.18;

        draw(canvas, interp, countsRef.current, flashesRef.current, viewCenterRef.current, {
          fitnessTrail,
          targetFitness,
          pendingLabel: pendingGene && pendingGene !== gene ? pendingLabel ?? 'next' : null,
          compact,
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [speedIdx, playing, fitnessTrail, targetFitness, pendingGene, pendingLabel, gene, compact]);

  // DPR + resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const sync = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => ro.disconnect();
  }, [height]);

  const reset = () => {
    interpreterRef.current?.reset();
    flashesRef.current.clear();
    haltedAtRef.current = null;
  };

  return (
    <div ref={containerRef} className="relative w-full rounded-xl bg-background/40 border border-border/40 overflow-hidden">
      <canvas ref={canvasRef} className="block" />
      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur rounded-md px-1 py-0.5 border border-border/40">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={reset}
          className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="h-7 px-2 text-[11px] font-mono tabular-nums text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          aria-label="Speed"
        >
          <FastForward className="h-3 w-3" />
          {SPEEDS[speedIdx]}×
        </button>
      </div>
    </div>
  );
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface DrawOpts {
  fitnessTrail?: { gen: number; fitness: number }[];
  targetFitness?: number;
  pendingLabel?: string | null;
  compact?: boolean;
}

const COLORS = {
  bg: '#09090b',
  panel: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.10)',
  text: 'rgba(255,255,255,0.85)',
  dim: 'rgba(255,255,255,0.45)',
  faint: 'rgba(255,255,255,0.20)',
  ip: '#e879f9',          // fuchsia-400 — instruction pointer
  ipBg: 'rgba(232,121,249,0.20)',
  dataPtr: '#22d3ee',     // cyan-400 — data pointer
  flash: '#f0abfc',       // fuchsia-300 — fresh write
  output: '#86efac',      // green-300
  heatmap: '#e879f9',
  spark: '#22d3ee',
} as const;

function draw(
  canvas: HTMLCanvasElement,
  interp: BFInterpreter,
  counts: Int32Array | null,
  flashes: FlashMap,
  viewCenter: number,
  opts: DrawOpts,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  const padX = 16;
  const padY = opts.compact ? 8 : 12;

  // Layout regions (top to bottom)
  const instrRowH = opts.compact ? 26 : 34;
  const heatRowH = 4;
  const memRowH = opts.compact ? 38 : 56;
  const dataPtrH = 14;
  const outputRowH = opts.compact ? 28 : 36;
  const statsRowH = 16;

  let y = padY;

  drawInstructionStream(ctx, interp, counts, padX, y, w - padX * 2, instrRowH);
  y += instrRowH + 2;
  drawHeatmapBar(ctx, interp, counts, padX, y, w - padX * 2, heatRowH);
  y += heatRowH + (opts.compact ? 8 : 14);

  drawMemoryTape(ctx, interp, flashes, viewCenter, padX, y, w - padX * 2, memRowH);
  y += memRowH;
  drawDataPointer(ctx, interp, viewCenter, padX, y, w - padX * 2, dataPtrH);
  y += dataPtrH + (opts.compact ? 6 : 10);

  drawOutput(ctx, interp, padX, y, w - padX * 2, outputRowH, opts.targetFitness);
  y += outputRowH + 4;

  drawStats(ctx, interp, padX, y, w - padX * 2, statsRowH);

  // Overlay the sparkline LAST so it sits above the rest at low opacity.
  if (opts.fitnessTrail && opts.fitnessTrail.length > 1 && opts.targetFitness) {
    drawSparkline(ctx, opts.fitnessTrail, opts.targetFitness, w, h);
  }

  if (opts.pendingLabel) {
    drawPendingPill(ctx, opts.pendingLabel, w, h);
  }
}

function drawInstructionStream(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  counts: Int32Array | null,
  x: number, y: number, w: number, h: number,
) {
  const src = interp.source;
  if (!src) return;

  // Determine cell width to fit all instructions in w
  const cellW = Math.max(8, Math.min(22, w / src.length));
  const fontSize = Math.min(h - 8, Math.max(9, cellW - 4));
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const startX = x + (w - cellW * src.length) / 2;
  const cy = y + h / 2;

  for (let i = 0; i < src.length; i++) {
    const cx = startX + i * cellW + cellW / 2;
    const isIP = i === interp.ip && !interp.done && !interp.truncated;

    if (isIP) {
      ctx.fillStyle = COLORS.ipBg;
      ctx.fillRect(startX + i * cellW, y, cellW, h);
      ctx.strokeStyle = COLORS.ip;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(startX + i * cellW + 0.5, y + 0.5, cellW - 1, h - 1);
    }

    ctx.fillStyle = isIP ? COLORS.ip : counts && counts[i] === 0 ? COLORS.faint : COLORS.text;
    ctx.fillText(src[i], cx, cy);
  }
}

function drawHeatmapBar(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  counts: Int32Array | null,
  x: number, y: number, w: number, h: number,
) {
  if (!counts) return;
  const src = interp.source;
  if (!src) return;
  const cellW = Math.max(8, Math.min(22, w / src.length));
  const startX = x + (w - cellW * src.length) / 2;

  // Faint backing bar so the row is visible even when counts are 0
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(startX, y, cellW * src.length, h);

  let max = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
  if (max === 0) return;
  const logMax = Math.log(max + 1);

  for (let i = 0; i < src.length; i++) {
    const c = counts[i];
    if (c === 0) continue;
    const t = Math.log(c + 1) / logMax;          // 0..1
    const alpha = 0.18 + 0.72 * t;               // pop the hot ones
    ctx.fillStyle = `rgba(232,121,249,${alpha.toFixed(3)})`;
    ctx.fillRect(startX + i * cellW + 0.5, y, cellW - 1, h);
  }
}

function drawMemoryTape(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  flashes: FlashMap,
  viewCenter: number,
  x: number, y: number, w: number, h: number,
) {
  const cellW = w / MEM_WINDOW;
  const start = Math.floor(viewCenter - MEM_WINDOW / 2);
  const fontSize = Math.max(9, Math.min(13, cellW * 0.5));
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const now = performance.now();

  // Sub-pixel scroll for smoothness
  const offset = (viewCenter - (start + MEM_WINDOW / 2)) * cellW;

  for (let k = -1; k <= MEM_WINDOW; k++) {
    const idx = start + k;
    if (idx < 0 || idx >= MEMORY_SIZE) continue;
    const cx = x + (k + 0.5) * cellW - offset;
    const value = interp.memory[idx];
    const flashedAt = flashes.get(idx);
    const flashIntensity = flashedAt ? Math.max(0, 1 - (now - flashedAt) / FLASH_MS) : 0;
    if (flashIntensity <= 0 && flashedAt) flashes.delete(idx);

    // Cell box
    ctx.fillStyle = idx === interp.dataPtr
      ? `rgba(34,211,238,${0.10 + 0.06 * flashIntensity})`
      : COLORS.panel;
    ctx.fillRect(cx - cellW / 2 + 1, y + 4, cellW - 2, h - 8);

    if (flashIntensity > 0) {
      ctx.strokeStyle = `rgba(240,171,252,${flashIntensity})`;
      ctx.lineWidth = 1 + flashIntensity * 1.5;
      ctx.strokeRect(cx - cellW / 2 + 1.5, y + 4.5, cellW - 3, h - 9);
    } else {
      ctx.strokeStyle = idx === interp.dataPtr ? COLORS.dataPtr : COLORS.border;
      ctx.lineWidth = idx === interp.dataPtr ? 1.2 : 0.5;
      ctx.strokeRect(cx - cellW / 2 + 1.5, y + 4.5, cellW - 3, h - 9);
    }

    // Value
    const display = ((value + 256) % 256).toString();
    ctx.fillStyle = value === 0 ? COLORS.dim : COLORS.text;
    ctx.fillText(display, cx, y + h / 2);

    // Index (subtle, every 4th)
    if (idx % 4 === 0 && cellW > 18) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.font = `9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillText(idx.toString(), cx, y + h - 3);
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    }
  }
}

function drawDataPointer(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  viewCenter: number,
  x: number, y: number, w: number, h: number,
) {
  const cellW = w / MEM_WINDOW;
  const start = viewCenter - MEM_WINDOW / 2;
  const k = interp.dataPtr - start;
  const cx = x + (k + 0.5) * cellW;
  if (cx < x - cellW || cx > x + w + cellW) return;

  // Triangle pointer
  ctx.fillStyle = COLORS.dataPtr;
  ctx.beginPath();
  ctx.moveTo(cx - 5, y + h - 2);
  ctx.lineTo(cx + 5, y + h - 2);
  ctx.lineTo(cx, y + 2);
  ctx.closePath();
  ctx.fill();
}

function drawOutput(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  x: number, y: number, w: number, h: number,
  targetFitness: number | undefined,
) {
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('OUTPUT', x + 6, y + 4);

  ctx.font = `${Math.max(11, h * 0.4)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  let display = '';
  for (const ch of interp.output) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) display += '·';
    else if (cp > 0xff) display += '◌';
    else display += ch;
  }
  ctx.fillStyle = display.length === 0 ? COLORS.dim : COLORS.output;
  // Truncate from the left if too long
  while (ctx.measureText(display).width > w - 70 && display.length > 1) {
    display = '…' + display.slice(2);
  }
  ctx.fillText(display || '—', x + 6, y + h / 2 + 2);

  if (interp.truncated) {
    ctx.fillStyle = '#fb923c';
    ctx.textAlign = 'right';
    ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('truncated', x + w - 6, y + 4);
  } else if (interp.done) {
    ctx.fillStyle = '#86efac';
    ctx.textAlign = 'right';
    ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('halt', x + w - 6, y + 4);
  }
  void targetFitness;
}

function drawStats(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  x: number, y: number, w: number, h: number,
) {
  ctx.font = `10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.dim;
  ctx.fillText(
    `ip ${interp.ip} · ptr ${interp.dataPtr} · calcs ${interp.calcs.toLocaleString()} / ${interp.calcCap.toLocaleString()}`,
    x, y + h / 2,
  );
  void w;
}

function drawSparkline(
  ctx: CanvasRenderingContext2D,
  trail: { gen: number; fitness: number }[],
  targetFitness: number,
  canvasW: number,
  canvasH: number,
) {
  // Position: top-right corner, ~30% of width, ~24% of height
  const w = Math.min(220, canvasW * 0.3);
  const h = Math.min(80, canvasH * 0.24);
  const x = canvasW - w - 10;
  const y = 6;

  ctx.save();

  // Faint background card
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Axes range
  const minGen = trail[0].gen;
  const maxGen = Math.max(trail[trail.length - 1].gen, minGen + 1);
  const minF = 0;
  const maxF = Math.max(targetFitness, ...trail.map((t) => t.fitness));
  const span = maxF - minF || 1;

  const px = (g: number) => x + 4 + ((g - minGen) / (maxGen - minGen)) * (w - 8);
  const py = (f: number) => y + h - 4 - ((f - minF) / span) * (h - 18);

  // Target line at 12% opacity
  ctx.strokeStyle = 'rgba(134,239,172,0.30)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x + 4, py(targetFitness));
  ctx.lineTo(x + w - 4, py(targetFitness));
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under trendline (very faint)
  ctx.fillStyle = 'rgba(34,211,238,0.10)';
  ctx.beginPath();
  ctx.moveTo(px(trail[0].gen), py(0));
  for (const p of trail) ctx.lineTo(px(p.gen), py(p.fitness));
  ctx.lineTo(px(trail[trail.length - 1].gen), py(0));
  ctx.closePath();
  ctx.fill();

  // The trendline itself — opacity high so it pops
  ctx.strokeStyle = 'rgba(34,211,238,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    if (i === 0) ctx.moveTo(px(p.gen), py(p.fitness));
    else ctx.lineTo(px(p.gen), py(p.fitness));
  }
  ctx.stroke();

  // Latest point
  const last = trail[trail.length - 1];
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(px(last.gen), py(last.fitness), 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `9px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FITNESS', x + 4, y + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${last.fitness}/${targetFitness}`, x + w - 4, y + 3);

  ctx.restore();
}

function drawPendingPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  canvasW: number,
  canvasH: number,
) {
  ctx.save();
  ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
  const text = `↻ ${label}`;
  const tw = ctx.measureText(text).width;
  const x = 8;
  const y = canvasH - 28;
  ctx.fillStyle = 'rgba(232,121,249,0.15)';
  ctx.strokeStyle = 'rgba(232,121,249,0.55)';
  ctx.lineWidth = 0.8;
  ctx.fillRect(x, y, tw + 14, 20);
  ctx.strokeRect(x + 0.5, y + 0.5, tw + 13, 19);
  ctx.fillStyle = '#f0abfc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 10);
  ctx.restore();
}
