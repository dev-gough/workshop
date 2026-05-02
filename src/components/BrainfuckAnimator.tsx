'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, FastForward, RotateCcw, Maximize, Minimize } from 'lucide-react';
import { BFInterpreter, executionCounts, MEMORY_SIZE } from '@/lib/brainfuck-interpreter';

interface Props {
  gene: string;
  // The target string the GA is evolving toward. Used to render the "scored
  // window" boxes in the output row, color-coded by per-position match.
  target?: string;
  // Optional sparkline data: progress trail of (gen, fitness) pairs.
  fitnessTrail?: { gen: number; fitness: number }[];
  targetFitness?: number;
  // "next gene" indicator — shown if a newer best gene came in mid-animation.
  pendingGene?: string | null;
  pendingLabel?: string;
  height?: number;
  compact?: boolean;
  // When true, render a fullscreen toggle button and bind the `F` key to it.
  // The page should set this only on its primary animator (typically the
  // active-run one) so multiple animators don't fight for the same hotkey.
  fullscreenable?: boolean;
  // Fires after one complete play+pause cycle, just before the interpreter
  // resets. Parent uses this to swap to a newer best gene without a jarring
  // mid-execution reset.
  onCycleEnd?: () => void;
}

// Step-rate per speed level. 1× is intentionally slow enough to follow with
// the eye (4 steps/sec ≈ 250ms per instruction).
const SPEEDS = [
  { label: '1×',   stepsPerSec: 4 },
  { label: '4×',   stepsPerSec: 16 },
  { label: '16×',  stepsPerSec: 64 },
  { label: '64×',  stepsPerSec: 256 },
  { label: '256×', stepsPerSec: 1024 },
];
const DEFAULT_SPEED_IDX = 2; // 16× = 64 steps/sec — comfortable default
const MEM_WINDOW = 32; // visible memory cells
const FLASH_MS = 350;
const POST_RUN_PAUSE_MS = 1200;
const FRAME_BUDGET_MS = 100; // cap elapsed time used for stepping (background-tab guard)

type FlashMap = Map<number, number>; // cell idx → timestamp of write

export default function BrainfuckAnimator({
  gene,
  target,
  fitnessTrail,
  targetFitness,
  pendingGene,
  pendingLabel,
  height = 360,
  compact = false,
  fullscreenable = false,
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
  const stepAccumRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number | null>(null);
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_SPEED_IDX);
  const [playing, setPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  // Reset frame timing whenever play state changes so resuming from pause
  // doesn't blast through accumulated step debt.
  useEffect(() => {
    lastFrameTimeRef.current = null;
    stepAccumRef.current = 0;
  }, [playing, speedIdx]);

  // rAF loop — time-based stepping so 1× actually means 4 steps/sec.
  useEffect(() => {
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const canvas = canvasRef.current;
      const interp = interpreterRef.current;
      if (canvas && interp) {
        const now = performance.now();
        const last = lastFrameTimeRef.current ?? now;
        const elapsed = Math.min(FRAME_BUDGET_MS, now - last);
        lastFrameTimeRef.current = now;

        if (playing && !interp.done && !interp.truncated) {
          stepAccumRef.current += (SPEEDS[speedIdx].stepsPerSec * elapsed) / 1000;
          let stepsToTake = Math.floor(stepAccumRef.current);
          if (stepsToTake > 0) stepAccumRef.current -= stepsToTake;
          while (stepsToTake-- > 0) {
            const moreToGo = interp.step();
            if (interp.lastWritten >= 0) {
              flashesRef.current.set(interp.lastWritten, now);
            }
            if (!moreToGo) {
              haltedAtRef.current = now;
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

        // Smooth view-scroll toward data ptr — but snap on huge jumps
        // (the data pointer is a 65535-cell ring buffer, and `<` from cell 0
        // wraps to 65534, which would otherwise make the view fly across the
        // whole tape every frame).
        const targetPtr = interp.dataPtr;
        const cur = viewCenterRef.current;
        if (Math.abs(targetPtr - cur) > 1000) {
          viewCenterRef.current = targetPtr;
        } else {
          viewCenterRef.current = cur + (targetPtr - cur) * 0.18;
        }

        draw(canvas, interp, countsRef.current, flashesRef.current, viewCenterRef.current, {
          target,
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
  }, [speedIdx, playing, fitnessTrail, targetFitness, pendingGene, pendingLabel, gene, target, compact]);

  // Fullscreen plumbing — pattern borrowed from the polar-clock project.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!fullscreenable) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  }, [fullscreenable]);

  // Primary-animator hotkeys: F (fullscreen), Space (play/pause), R (reset).
  // Only bound when `fullscreenable` so multiple animators on the page don't
  // fight for the same keys. Native Esc exits fullscreen for free.
  useEffect(() => {
    if (!fullscreenable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === ' ') {
        // Spacebar would otherwise scroll the page.
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        interpreterRef.current?.reset();
        flashesRef.current.clear();
        haltedAtRef.current = null;
        setTick((t) => t + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenable, toggleFullscreen]);

  // Arrow keys: when paused, ←/→ steps backward/forward by one instruction.
  useEffect(() => {
    if (playing) return; // only listen while paused
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Don't hijack typing in inputs/textareas.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const interp = interpreterRef.current;
      if (!interp) return;
      e.preventDefault();
      if (e.key === 'ArrowRight') {
        const moreToGo = interp.step();
        if (interp.lastWritten >= 0) flashesRef.current.set(interp.lastWritten, performance.now());
        if (!moreToGo) haltedAtRef.current = performance.now();
      } else {
        // Stepping back un-halts and clears the post-run pause timer.
        if (interp.stepBack()) {
          haltedAtRef.current = null;
        }
      }
      setTick((t) => t + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [playing]);

  // DPR + resize handling — canvas always fills its container, so toggling
  // fullscreen (which swaps the container's inline height) re-fits cleanly.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const sync = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const reset = () => {
    interpreterRef.current?.reset();
    flashesRef.current.clear();
    haltedAtRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl bg-background/40 border border-border/40 overflow-hidden"
      style={{ height: isFullscreen ? '100vh' : `${height}px` }}
    >
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
          title={`${SPEEDS[speedIdx].stepsPerSec} steps/s`}
        >
          <FastForward className="h-3 w-3" />
          {SPEEDS[speedIdx].label}
        </button>
        {fullscreenable && (
          <button
            onClick={toggleFullscreen}
            className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface DrawOpts {
  target?: string;
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

  // Scale BF-machine rows up as the canvas grows. In normal/inline use the
  // existing ratio (chart fills whatever is left). In fullscreen-ish heights
  // (≥ 600px), pin the chart to the bottom 1/3 and let the BF rows take the
  // top 2/3 — the Turing machine is the focal point, not the chart.
  const baseRowsTotal = 224; // sum of base row heights + gutters at scale 1
  let scale: number;
  if (h >= 600) {
    scale = Math.min(4, (h * 2) / 3 / baseRowsTotal);
  } else {
    scale = Math.min(2.5, Math.max(1, h / 360));
  }

  const padX = Math.round(16 * scale);
  const padY = Math.round((opts.compact ? 8 : 12) * scale);

  // Layout regions (top to bottom)
  const instrRowH = Math.round((opts.compact ? 26 : 34) * scale);
  const heatRowH = Math.round(4 * scale);
  const memRowH = Math.round((opts.compact ? 38 : 56) * scale);
  const dataPtrH = Math.round(14 * scale);
  const outputRowH = Math.round((opts.compact ? 38 : 50) * scale);
  const statsRowH = Math.round(16 * scale);

  let y = padY;

  drawInstructionStream(ctx, interp, counts, padX, y, w - padX * 2, instrRowH);
  y += instrRowH + Math.round(2 * scale);
  drawHeatmapBar(ctx, interp, counts, padX, y, w - padX * 2, heatRowH);
  y += heatRowH + Math.round((opts.compact ? 8 : 14) * scale);

  drawMemoryTape(ctx, interp, flashes, viewCenter, padX, y, w - padX * 2, memRowH, scale);
  y += memRowH;
  drawDataPointer(ctx, interp, viewCenter, padX, y, w - padX * 2, dataPtrH, scale);
  y += dataPtrH + Math.round((opts.compact ? 6 : 10) * scale);

  drawOutput(ctx, interp, padX, y, w - padX * 2, outputRowH, opts.target, opts.compact, scale);
  y += outputRowH + Math.round(4 * scale);

  drawStats(ctx, interp, padX, y, w - padX * 2, statsRowH, scale);
  y += statsRowH + Math.round((opts.compact ? 4 : 8) * scale);

  // Use whatever vertical space is left between stats and the absolutely-
  // positioned controls (bottom-right of the canvas, ~36px tall) for a
  // low-opacity fitness chart. In fullscreen-ish heights this is pinned to
  // the bottom ~1/3 by the scale formula above; in inline mode it just
  // fills whatever's left.
  const reserveBottom = Math.round((opts.compact ? 6 : 10) * scale);
  const chartH = h - y - reserveBottom;
  if (
    chartH > 36 &&
    opts.fitnessTrail &&
    opts.fitnessTrail.length > 1 &&
    opts.targetFitness
  ) {
    drawSparkline(ctx, opts.fitnessTrail, opts.targetFitness, padX, y, w - padX * 2, chartH, scale);
  }

  if (opts.pendingLabel) {
    drawPendingPill(ctx, opts.pendingLabel, w, h, scale);
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
  scale: number,
) {
  const cellW = w / MEM_WINDOW;
  const start = Math.floor(viewCenter - MEM_WINDOW / 2);
  const fontSize = Math.max(9 * scale, Math.min(13 * scale, cellW * 0.5));
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
      ctx.font = `${9 * scale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillText(idx.toString(), cx, y + h - 3 * scale);
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    }
  }
}

function drawDataPointer(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  viewCenter: number,
  x: number, y: number, w: number, h: number,
  scale: number,
) {
  const cellW = w / MEM_WINDOW;
  const start = viewCenter - MEM_WINDOW / 2;
  const k = interp.dataPtr - start;
  const cx = x + (k + 0.5) * cellW;
  if (cx < x - cellW || cx > x + w + cellW) return;

  // Triangle pointer
  ctx.fillStyle = COLORS.dataPtr;
  const tw = 5 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y + h - 2 * scale);
  ctx.lineTo(cx + tw, y + h - 2 * scale);
  ctx.lineTo(cx, y + 2 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawOutput(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  x: number, y: number, w: number, h: number,
  target: string | undefined,
  compact: boolean | undefined,
  scale: number,
) {
  // Background panel
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const labelFont = `${10 * scale}px ui-sans-serif, system-ui, sans-serif`;

  // Header label
  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = labelFont;
  ctx.fillText('OUTPUT', x + 6 * scale, y + 4 * scale);

  // Status badge top-right (truncated/halt). The "-1" sentinel that bumpCalc
  // appends to output is purely a marker for the GA's fitness function — strip
  // it from display so the badge can carry that info instead.
  let displayOutput = interp.output;
  if (interp.truncated && displayOutput.endsWith('-1')) {
    displayOutput = displayOutput.slice(0, -2);
  }
  if (interp.truncated) {
    ctx.fillStyle = '#fb923c';
    ctx.textAlign = 'right';
    ctx.font = labelFont;
    ctx.fillText('truncated', x + w - 6 * scale, y + 4 * scale);
  } else if (interp.done) {
    ctx.fillStyle = '#86efac';
    ctx.textAlign = 'right';
    ctx.font = labelFont;
    ctx.fillText('halt', x + w - 6 * scale, y + 4 * scale);
  }

  const N = target ? target.length : 0;
  const labelW = Math.round(56 * scale); // leave room for the OUTPUT label + tiny gap
  const statusW = Math.round(60 * scale);
  const contentX = x + labelW;
  const contentW = w - labelW - statusW;
  const contentY = y + 4;
  const contentH = h - 8;

  // ── First-N "scored window" boxes ──
  // The GA's fitness function only rewards interp.output[0..N), so those are
  // the chars that actually matter. Always render them as fixed boxes with
  // per-position match coloring.
  if (N > 0 && target) {
    const gap = Math.max(2, Math.round(2 * scale));
    const boxW = Math.max(11, Math.min((compact ? 22 : 28) * scale, Math.floor((contentW * 0.55) / N)));
    const boxH = Math.min(boxW, contentH - 4 * scale);
    const boxesY = contentY + (contentH - boxH) / 2;

    const fontSize = Math.max(10, Math.floor(boxH * 0.65));
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < N; i++) {
      const bx = contentX + i * (boxW + gap);
      if (bx + boxW > x + w - statusW) break; // ran out of space
      const targetCp = target.charCodeAt(i);
      const haveOutput = i < displayOutput.length;
      const producedCp = haveOutput ? displayOutput.charCodeAt(i) : -1;
      const dist = haveOutput ? Math.min(255, Math.abs(producedCp - targetCp)) : -1;
      const accent = haveOutput ? matchAccent(dist) : MATCH_EMPTY;

      // Box bg + border
      ctx.fillStyle = accent.bg;
      ctx.fillRect(bx, boxesY, boxW, boxH);
      ctx.strokeStyle = accent.border;
      ctx.lineWidth = haveOutput ? 1 : 0.6;
      if (!haveOutput) ctx.setLineDash([2, 2]);
      ctx.strokeRect(bx + 0.5, boxesY + 0.5, boxW - 1, boxH - 1);
      ctx.setLineDash([]);

      // Glyph: produced char if output reaches here, else target char as ghost
      const cp = haveOutput ? producedCp : targetCp;
      const glyph = renderableGlyph(cp);
      ctx.fillStyle = haveOutput ? accent.text : 'rgba(255,255,255,0.20)';
      ctx.fillText(glyph, bx + boxW / 2, boxesY + boxH / 2 + 1);
    }

    // Tiny "target: hi" label under/over the boxes (subtle reference)
    if (boxH < contentH - 12 * scale) {
      ctx.font = `${9 * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      const tgt = target.length > 24 ? target.slice(0, 24) + '…' : target;
      ctx.fillText(`scored: ${JSON.stringify(tgt)}`, contentX, boxesY + boxH + 2 * scale);
    }

    // ── Overflow: any output past position N, rendered as faint mono text ──
    const overflowStart = contentX + N * (boxW + gap) + 6 * scale;
    const overflowMaxW = (x + w - statusW) - overflowStart - 4 * scale;
    if (overflowMaxW > 30 && displayOutput.length > N) {
      let rest = '';
      for (const ch of displayOutput.slice(N)) rest += renderableGlyph(ch.charCodeAt(0));
      ctx.font = `${Math.max(10 * scale, boxH * 0.55)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      // Truncate overflow from the END (keep the start visible after the boxes).
      while (ctx.measureText(rest).width > overflowMaxW && rest.length > 1) {
        rest = rest.slice(0, -1);
      }
      if (rest.length < displayOutput.length - N) rest = rest.slice(0, -1) + '…';
      ctx.fillText(rest, overflowStart, boxesY + boxH / 2);
    }
    return;
  }

  // ── Fallback when no target is provided (e.g. detail card with raw output) ──
  ctx.font = `${Math.max(11 * scale, h * 0.4)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  let display = '';
  for (const ch of displayOutput) display += renderableGlyph(ch.charCodeAt(0));
  ctx.fillStyle = display.length === 0 ? COLORS.dim : COLORS.output;
  while (ctx.measureText(display).width > w - 70 * scale && display.length > 1) {
    display = display.slice(0, -1);
  }
  ctx.fillText(display || '—', x + 6 * scale, y + h / 2 + 2);
}

const MATCH_EMPTY = {
  bg: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.18)',
  text: 'rgba(255,255,255,0.20)',
};

function matchAccent(dist: number): { bg: string; border: string; text: string } {
  if (dist === 0)  return { bg: 'rgba(134,239,172,0.22)', border: 'rgba(134,239,172,0.85)', text: '#bbf7d0' }; // green
  if (dist < 4)    return { bg: 'rgba(190,242,100,0.18)', border: 'rgba(190,242,100,0.70)', text: '#d9f99d' }; // lime
  if (dist < 16)   return { bg: 'rgba(250,204,21,0.16)',  border: 'rgba(250,204,21,0.65)',  text: '#fde68a' }; // amber
  if (dist < 64)   return { bg: 'rgba(251,146,60,0.16)',  border: 'rgba(251,146,60,0.65)',  text: '#fed7aa' }; // orange
  return             { bg: 'rgba(248,113,113,0.16)',     border: 'rgba(248,113,113,0.65)', text: '#fecaca' }; // red
}

function renderableGlyph(cp: number): string {
  if (cp < 0x20 || cp === 0x7f) return '·';
  if (cp > 0xff) return '◌';
  return String.fromCharCode(cp);
}

function drawStats(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  x: number, y: number, w: number, h: number,
  scale: number,
) {
  ctx.font = `${10 * scale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
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
  x: number, y: number, w: number, h: number,
  scale: number,
) {
  ctx.save();

  // Axes range
  const minGen = trail[0].gen;
  const maxGen = Math.max(trail[trail.length - 1].gen, minGen + 1);
  const minF = 0;
  const maxF = Math.max(targetFitness, ...trail.map((t) => t.fitness));
  const span = maxF - minF || 1;

  const padTop = 14 * scale;
  const padBottom = 4 * scale;
  const px = (g: number) => x + ((g - minGen) / (maxGen - minGen)) * w;
  const py = (f: number) => y + h - padBottom - ((f - minF) / span) * (h - padTop - padBottom);

  // Header label — pinned top-left, low opacity. Stays out of the chart.
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = `${9 * scale}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FITNESS', x, y);
  const last = trail[trail.length - 1];
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(34,211,238,0.55)';
  ctx.fillText(`${last.fitness} / ${targetFitness}`, x + w, y);

  // Target line — dashed, faint green
  ctx.strokeStyle = 'rgba(134,239,172,0.22)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  const ty = py(targetFitness);
  ctx.moveTo(x, ty);
  ctx.lineTo(x + w, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under trendline — very faint, integrates with bg
  ctx.fillStyle = 'rgba(34,211,238,0.06)';
  ctx.beginPath();
  ctx.moveTo(px(trail[0].gen), y + h - padBottom);
  for (const p of trail) ctx.lineTo(px(p.gen), py(p.fitness));
  ctx.lineTo(px(trail[trail.length - 1].gen), y + h - padBottom);
  ctx.closePath();
  ctx.fill();

  // Trendline — pops against the faint bg
  ctx.strokeStyle = 'rgba(34,211,238,0.55)';
  ctx.lineWidth = 1.4 * scale;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    if (i === 0) ctx.moveTo(px(p.gen), py(p.fitness));
    else ctx.lineTo(px(p.gen), py(p.fitness));
  }
  ctx.stroke();

  // Latest point — small but visible dot at the tip
  ctx.fillStyle = 'rgba(34,211,238,0.85)';
  ctx.beginPath();
  ctx.arc(px(last.gen), py(last.fitness), 2.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPendingPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  canvasW: number,
  canvasH: number,
  scale: number,
) {
  // In normal/inline mode, render at natural size. In fullscreen the rest of
  // the UI scales up but the pill is informational, not focal, so we halve
  // its growth so it doesn't dominate the corner.
  const s = canvasH >= 600 ? scale * 0.5 : 1;
  ctx.save();
  ctx.font = `${10 * s}px ui-sans-serif, system-ui, sans-serif`;
  const text = `↻ ${label}`;
  const tw = ctx.measureText(text).width;
  const px = 8 * s;
  const py = canvasH - 28 * s;
  const padX = 7 * s;
  const padY = 10 * s;
  ctx.fillStyle = 'rgba(232,121,249,0.15)';
  ctx.strokeStyle = 'rgba(232,121,249,0.55)';
  ctx.lineWidth = 0.8 * s;
  ctx.fillRect(px, py, tw + padX * 2, 20 * s);
  ctx.strokeRect(px + 0.5, py + 0.5, tw + padX * 2 - 1, 20 * s - 1);
  ctx.fillStyle = '#f0abfc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + padX, py + padY);
  ctx.restore();
  void canvasW;
}
