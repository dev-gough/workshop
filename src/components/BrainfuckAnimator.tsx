'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, FastForward, RotateCcw, Maximize, Minimize } from 'lucide-react';
import { BFInterpreter, executionCounts, MEMORY_SIZE } from '@/lib/brainfuck-interpreter';

// ── The tape transport ────────────────────────────────────────────────────────
// The program is drawn as a strip of punched paper tape: BF's 8 instructions
// are a 3-bit punch code (plus the sprocket feed row and the printed glyph
// along the tape's lower edge, the way real teletype tape was chadless-
// printed). The read head is a magenta lens that tracks the instruction
// pointer; execution heat renders as wear on the paper. Memory is a counter
// bank, output is a teletype strip, and the fitness trail is a strip-chart
// recorder. When a better gene arrives the old tape tears off leftward, the
// new strip feeds in from the sprockets, and a generation stamp thumps down.
//
// The transport window is a self-lit instrument: it stays dark in both
// bf-theme modes (canvas colors are fixed, not token-driven).

interface Props {
  gene: string;
  // The target string the GA is evolving toward. Used to render the "scored
  // window" columns on the teletype strip, color-coded by per-position match.
  target?: string;
  // Optional strip-chart data: progress trail of (gen, fitness) pairs.
  fitnessTrail?: { gen: number; fitness: number }[];
  targetFitness?: number;
  // "next gene" indicator — shown if a newer best gene came in mid-animation.
  pendingGene?: string | null;
  pendingLabel?: string;
  // Text pressed into the NEW BEST stamp when `gene` swaps mid-run (e.g.
  // "gen 12,304"). Read at swap time; when absent the swap still animates
  // the tape feed but skips the stamp (used for initial seeds).
  stampLabel?: string | null;
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

// Splice choreography (all from splice start, ms)
const SPLICE_FEED_MS = 650;    // old tape exits left / new tape feeds in from right
const STAMP_AT_MS = 420;       // stamp starts its thump while the tape settles
const STAMP_THUMP_MS = 160;    // scale 1.7 → 1
const STAMP_HOLD_MS = 2200;    // fully inked
const STAMP_FADE_MS = 500;

type FlashMap = Map<number, number>; // cell idx → timestamp of write

interface Splice {
  start: number;          // performance.now() at swap
  prevSource: string;     // old tape, drawn exiting left ('' on first feed)
  stamp: string | null;   // second stamp line, null = no stamp
}

export default function BrainfuckAnimator({
  gene,
  target,
  fitnessTrail,
  targetFitness,
  pendingGene,
  pendingLabel,
  stampLabel,
  height = 360,
  compact = false,
  fullscreenable = false,
  onCycleEnd,
}: Props) {
  const onCycleEndRef = useRef(onCycleEnd);
  onCycleEndRef.current = onCycleEnd;
  const stampLabelRef = useRef(stampLabel);
  stampLabelRef.current = stampLabel;
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
  const prevGeneRef = useRef<string>('');
  const spliceRef = useRef<Splice | null>(null);
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_SPEED_IDX);
  const [playing, setPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [, setTick] = useState(0); // force re-render on gene-swap so UI labels update

  // (Re)initialize interpreter when gene changes (debounced — caller passes finalized gene).
  useEffect(() => {
    if (!gene) {
      interpreterRef.current = null;
      countsRef.current = null;
      prevGeneRef.current = '';
      spliceRef.current = null;
      return;
    }
    const prev = prevGeneRef.current;
    prevGeneRef.current = gene;
    interpreterRef.current = new BFInterpreter(gene);
    countsRef.current = executionCounts(gene);
    flashesRef.current.clear();
    viewCenterRef.current = 0;
    haltedAtRef.current = null;
    // Splice: a swap from an existing tape gets the full tear-off + stamp;
    // the very first tape just feeds in quietly.
    spliceRef.current = {
      start: performance.now(),
      prevSource: prev,
      stamp: prev && prev !== gene ? (stampLabelRef.current ?? null) : null,
    };
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
          splice: spliceRef.current,
        });
        // Drop the splice record once its whole choreography is over.
        const sp = spliceRef.current;
        if (sp && now - sp.start > STAMP_HOLD_MS + STAMP_FADE_MS) {
          spliceRef.current = null;
        }
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
      className="relative w-full rounded-lg overflow-hidden"
      // The transport window: fixed dark instrument regardless of theme mode.
      style={{
        height: isFullscreen ? '100vh' : `${height}px`,
        background: C.win,
        border: `1px solid ${C.winEdge}`,
        boxShadow: 'inset 0 1px 0 rgba(234,223,196,0.05), inset 0 -14px 24px rgba(0,0,0,0.35)',
      }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md px-1 py-0.5 backdrop-blur"
        style={{ background: 'rgba(18,13,8,0.82)', border: `1px solid ${C.winEdge}` }}
      >
        <button
          onClick={() => setPlaying((p) => !p)}
          className="h-7 w-7 flex items-center justify-center transition-colors"
          style={{ color: C.controlDim }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.controlHot)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.controlDim)}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={reset}
          className="h-7 w-7 flex items-center justify-center transition-colors"
          style={{ color: C.controlDim }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.controlHot)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.controlDim)}
          aria-label="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="h-7 px-2 text-[11px] font-mono tabular-nums transition-colors flex items-center gap-1"
          style={{ color: C.controlDim }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.controlHot)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.controlDim)}
          aria-label="Speed"
          title={`${SPEEDS[speedIdx].stepsPerSec} steps/s`}
        >
          <FastForward className="h-3 w-3" />
          {SPEEDS[speedIdx].label}
        </button>
        {fullscreenable && (
          <button
            onClick={toggleFullscreen}
            className="h-7 w-7 flex items-center justify-center transition-colors"
            style={{ color: C.controlDim }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.controlHot)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.controlDim)}
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
  splice?: Splice | null;
}

// Fixed instrument palette — bakelite window, manila tape, stamp-pad ink.
const C = {
  win: '#151009',                       // transport window
  winEdge: 'rgba(234,223,196,0.14)',
  panel: 'rgba(234,223,196,0.05)',
  panelEdge: 'rgba(234,223,196,0.12)',
  text: 'rgba(234,223,196,0.88)',       // lamp-lit manila text
  dim: 'rgba(234,223,196,0.45)',
  faint: 'rgba(234,223,196,0.18)',
  paper: '#e4d6b2',                     // the tape itself
  paperShade: '#c9b98f',
  hole: '#181209',                      // punched through to the window
  dimple: 'rgba(58,44,30,0.13)',        // unpunched position
  ink: '#40301e',                       // printed glyphs on the tape
  inkDead: 'rgba(64,48,30,0.30)',       // never-executed instructions
  head: '#ef79d3',                      // read head — stamp-pad magenta
  headBg: 'rgba(239,121,211,0.16)',
  ptr: '#93d8a4',                       // data pointer / active counter — green ink
  ptrBg: 'rgba(147,216,164,0.10)',
  flash: '#eebc62',                     // fresh write — hot punch amber
  ok: '#93d8a4',
  warn: '#eebc62',
  fault: '#e57f6b',
  chart: 'rgba(239,121,211,0.70)',      // strip-chart pen — magenta ink
  chartFill: 'rgba(239,121,211,0.07)',
  controlDim: 'rgba(234,223,196,0.55)',
  controlHot: 'rgba(234,223,196,0.95)',
} as const;

// 3-bit punch code, one column per instruction. ',' (read input — a no-op
// in this dialect) sits at 000, the blank frame, exactly like NUL on real
// tape; the motion pairs >< +- and the brackets [] differ by one bit.
const PUNCH_CODE: Record<string, number> = {
  ',': 0, '>': 1, '<': 2, '+': 3, '-': 4, '.': 5, '[': 6, ']': 7,
};

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t: number): number { return t * t * t; }

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

  // The window is self-lit — paint it, don't clear to transparent.
  ctx.fillStyle = C.win;
  ctx.fillRect(0, 0, w, h);

  // Scale machine rows up as the canvas grows. In normal/inline use the
  // existing ratio (chart fills whatever is left). In fullscreen-ish heights
  // (≥ 600px), pin the chart to the bottom 1/3 and let the machine take the
  // top 2/3 — the tape transport is the focal point, not the chart.
  const baseRowsTotal = 232; // sum of base row heights + gutters at scale 1
  let scale: number;
  if (h >= 600) {
    scale = Math.min(4, (h * 2) / 3 / baseRowsTotal);
  } else {
    scale = Math.min(2.5, Math.max(1, h / 360));
  }

  const padX = Math.round(16 * scale);
  const padY = Math.round((opts.compact ? 8 : 12) * scale);

  // Layout regions (top to bottom)
  const tapeRowH = Math.round((opts.compact ? 36 : 48) * scale);
  const memRowH = Math.round((opts.compact ? 38 : 56) * scale);
  const dataPtrH = Math.round(14 * scale);
  const outputRowH = Math.round((opts.compact ? 38 : 50) * scale);
  const statsRowH = Math.round(16 * scale);

  let y = padY;

  drawTapeTransport(ctx, interp, counts, padX, y, w - padX * 2, tapeRowH, scale, opts.splice ?? null);
  y += tapeRowH + Math.round((opts.compact ? 8 : 14) * scale);

  drawCounterBank(ctx, interp, flashes, viewCenter, padX, y, w - padX * 2, memRowH, scale);
  y += memRowH;
  drawDataPointer(ctx, interp, viewCenter, padX, y, w - padX * 2, dataPtrH, scale);
  y += dataPtrH + Math.round((opts.compact ? 6 : 10) * scale);

  drawTeletype(ctx, interp, padX, y, w - padX * 2, outputRowH, opts.target, opts.compact, scale);
  y += outputRowH + Math.round(4 * scale);

  drawStats(ctx, interp, padX, y, w - padX * 2, statsRowH, scale);
  y += statsRowH + Math.round((opts.compact ? 4 : 8) * scale);

  // Use whatever vertical space is left between stats and the absolutely-
  // positioned controls (bottom-right of the canvas, ~36px tall) for the
  // strip-chart recorder. In fullscreen-ish heights this is pinned to the
  // bottom ~1/3 by the scale formula above; inline it fills whatever's left.
  const reserveBottom = Math.round((opts.compact ? 6 : 10) * scale);
  const chartH = h - y - reserveBottom;
  if (
    chartH > 36 &&
    opts.fitnessTrail &&
    opts.fitnessTrail.length > 1 &&
    opts.targetFitness
  ) {
    drawStripChart(ctx, opts.fitnessTrail, opts.targetFitness, padX, y, w - padX * 2, chartH, scale);
  }

  if (opts.pendingLabel) {
    drawPendingTag(ctx, opts.pendingLabel, w, h, scale);
  }

  // Splice overlays: stamp thump + a brief magenta flash on the window frame.
  const sp = opts.splice;
  if (sp) {
    const t = performance.now() - sp.start;
    if (sp.prevSource && t < 700) {
      const a = 0.55 * (1 - t / 700);
      ctx.strokeStyle = `rgba(239,121,211,${a.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    }
    if (sp.stamp && t >= STAMP_AT_MS) {
      drawStamp(ctx, sp.stamp, t - STAMP_AT_MS, w, padY + tapeRowH, scale);
    }
  }
}

// ── The punched tape ──

function tapeGeometry(w: number, len: number) {
  const cellW = Math.max(8, Math.min(22, w / len));
  return { cellW, tapeW: cellW * len };
}

/** One strip of tape with punch holes, sprocket row and printed glyphs. */
function drawTapeStrip(
  ctx: CanvasRenderingContext2D,
  src: string,
  counts: Int32Array | null,
  ipIndex: number | null,       // read-head column, null = no head
  x: number, y: number, w: number, h: number,
  scale: number,
  alpha: number,
) {
  if (!src) return;
  const { cellW, tapeW } = tapeGeometry(w, src.length);
  const startX = x + (w - tapeW) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Paper — a very slight vertical shading so it reads as a physical strip.
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, C.paperShade);
  grad.addColorStop(0.12, C.paper);
  grad.addColorStop(0.88, C.paper);
  grad.addColorStop(1, C.paperShade);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(startX, y, tapeW, h, 2 * scale);
  ctx.fill();

  // Row geometry inside the strip: 3 data rows, sprocket row, print strip.
  const printH = Math.max(10, 12 * scale);
  const punchAreaH = h - printH;
  const rowGap = punchAreaH / 4;                 // 3 data rows + sprocket share it
  const dataR = Math.min(rowGap * 0.34, cellW * 0.28);
  const sprocketR = Math.max(1.1, dataR * 0.42);

  // Execution wear — hot columns darken like handled paper.
  let maxCount = 0;
  if (counts) for (let i = 0; i < counts.length; i++) if (counts[i] > maxCount) maxCount = counts[i];
  const logMax = maxCount > 0 ? Math.log(maxCount + 1) : 1;

  const glyphFont = `${Math.max(8, printH - 3)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';

  for (let i = 0; i < src.length; i++) {
    const cx = startX + (i + 0.5) * cellW;
    const code = PUNCH_CODE[src[i]] ?? 0;
    const executed = counts ? counts[i] > 0 : true;

    // Wear tint under the punches.
    if (counts && counts[i] > 0 && maxCount > 0) {
      const heat = Math.log(counts[i] + 1) / logMax;
      ctx.fillStyle = `rgba(146,86,26,${(0.05 + 0.22 * heat).toFixed(3)})`;
      ctx.fillRect(startX + i * cellW, y, cellW, punchAreaH);
    }

    // Punch rows, top → bottom = bit2, bit1, bit0.
    for (let bit = 0; bit < 3; bit++) {
      const cy = y + rowGap * (bit + 0.75);
      const punched = (code >> (2 - bit)) & 1;
      ctx.beginPath();
      ctx.arc(cx, cy, punched ? dataR : dataR * 0.45, 0, Math.PI * 2);
      if (punched) {
        ctx.fillStyle = C.hole;
        ctx.fill();
      } else {
        ctx.fillStyle = C.dimple;
        ctx.fill();
      }
    }

    // Sprocket feed hole — every frame, small, slightly below the data rows.
    ctx.beginPath();
    ctx.arc(cx, y + rowGap * 3.55, sprocketR, 0, Math.PI * 2);
    ctx.fillStyle = C.hole;
    ctx.fill();

    // Printed glyph along the tape's lower edge (chadless-printer style).
    ctx.font = glyphFont;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = executed ? C.ink : C.inkDead;
    ctx.fillText(src[i], cx, y + punchAreaH + printH / 2);
  }

  // Read head — a magenta lens clamped over the current column.
  if (ipIndex != null && ipIndex >= 0 && ipIndex < src.length) {
    const hx = startX + ipIndex * cellW;
    const pad = 2.5 * scale;
    ctx.fillStyle = C.headBg;
    ctx.fillRect(hx, y - pad, cellW, h + pad * 2);
    ctx.strokeStyle = C.head;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(hx + 0.5, y - pad + 0.5, cellW - 1, h + pad * 2 - 1);
    // Clamp jaws top + bottom.
    ctx.fillStyle = C.head;
    const jawW = Math.min(cellW, 8 * scale);
    ctx.fillRect(hx + (cellW - jawW) / 2, y - pad - 2 * scale, jawW, 2 * scale);
    ctx.fillRect(hx + (cellW - jawW) / 2, y + h + pad, jawW, 2 * scale);
  }

  ctx.restore();
}

function drawTapeTransport(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  counts: Int32Array | null,
  x: number, y: number, w: number, h: number,
  scale: number,
  splice: Splice | null,
) {
  const showHead = !interp.done && !interp.truncated;

  // Guide rollers — two thin rails above and below the tape path, so the
  // strip visibly runs *through* something.
  ctx.fillStyle = C.faint;
  ctx.fillRect(x, y - 4 * scale, w, 1);
  ctx.fillRect(x, y + h + 4 * scale, w, 1);

  const now = performance.now();
  const t = splice ? Math.min(1, (now - splice.start) / SPLICE_FEED_MS) : 1;

  if (splice && t < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 2, y - 8 * scale, w + 4, h + 16 * scale);
    ctx.clip();
    // Old tape tears off leftward, dimming as it goes.
    if (splice.prevSource) {
      const exitDx = -easeInCubic(t) * (w + 80);
      drawTapeStrip(ctx, splice.prevSource, null, null, x + exitDx, y, w, h, scale, 0.7 * (1 - t));
    }
    // New tape feeds in from the right sprockets and settles.
    const feedDx = (1 - easeOutCubic(t)) * (w * 0.95);
    drawTapeStrip(ctx, interp.source, counts, showHead ? interp.ip : null, x + feedDx, y, w, h, scale, 1);
    ctx.restore();
  } else {
    drawTapeStrip(ctx, interp.source, counts, showHead ? interp.ip : null, x, y, w, h, scale, 1);
  }
}

// ── NEW BEST stamp ──

function drawStamp(
  ctx: CanvasRenderingContext2D,
  label: string,
  t: number,                 // ms since stamp start
  canvasW: number,
  tapeBottomY: number,
  scale: number,
) {
  const total = STAMP_HOLD_MS + STAMP_FADE_MS - STAMP_AT_MS;
  if (t > total) return;

  // Thump: oversized and translucent, slams to rest.
  const thump = Math.min(1, t / STAMP_THUMP_MS);
  const s = 1.7 - 0.7 * easeOutCubic(thump);
  let alpha = 0.95 * easeOutCubic(thump);
  const fadeStart = total - STAMP_FADE_MS;
  if (t > fadeStart) alpha *= 1 - (t - fadeStart) / STAMP_FADE_MS;
  if (alpha <= 0) return;

  ctx.save();
  const cx = canvasW / 2;
  const cy = tapeBottomY + 34 * scale;
  ctx.translate(cx, cy);
  ctx.rotate(-0.055);
  ctx.scale(s * scale, s * scale);
  ctx.globalAlpha = alpha;

  const line1 = 'NEW BEST';
  const line2 = label.toUpperCase();
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const w1 = ctx.measureText(spaceOut(line1)).width;
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const w2 = ctx.measureText(spaceOut(line2)).width;
  const boxW = Math.max(w1, w2) + 28;
  const boxH = 40;

  // Ink pad behind the impression so it stays legible over the tape.
  ctx.fillStyle = 'rgba(21,16,9,0.55)';
  ctx.beginPath();
  ctx.roundRect(-boxW / 2 - 3, -boxH / 2 - 3, boxW + 6, boxH + 6, 4);
  ctx.fill();

  // Double-ruled stamp frame.
  ctx.strokeStyle = C.head;
  ctx.lineWidth = 2;
  ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.lineWidth = 0.75;
  ctx.strokeRect(-boxW / 2 + 3, -boxH / 2 + 3, boxW - 6, boxH - 6);

  ctx.fillStyle = C.head;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText(spaceOut(line1), 0, -7);
  ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText(spaceOut(line2), 0, 9);

  ctx.restore();
}

function spaceOut(s: string): string {
  return s.split('').join('  ');
}

// ── Counter bank (memory) ──

function drawCounterBank(
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

    // Counter window
    ctx.fillStyle = idx === interp.dataPtr
      ? `rgba(147,216,164,${(0.10 + 0.06 * flashIntensity).toFixed(3)})`
      : C.panel;
    ctx.fillRect(cx - cellW / 2 + 1, y + 4, cellW - 2, h - 8);

    if (flashIntensity > 0) {
      ctx.strokeStyle = `rgba(238,188,98,${flashIntensity.toFixed(3)})`;
      ctx.lineWidth = 1 + flashIntensity * 1.5;
      ctx.strokeRect(cx - cellW / 2 + 1.5, y + 4.5, cellW - 3, h - 9);
    } else {
      ctx.strokeStyle = idx === interp.dataPtr ? C.ptr : C.panelEdge;
      ctx.lineWidth = idx === interp.dataPtr ? 1.2 : 0.5;
      ctx.strokeRect(cx - cellW / 2 + 1.5, y + 4.5, cellW - 3, h - 9);
    }

    // Value
    const display = ((value + 256) % 256).toString();
    ctx.fillStyle = value === 0 ? C.dim : C.text;
    ctx.fillText(display, cx, y + h / 2);

    // Index (subtle, every 4th)
    if (idx % 4 === 0 && cellW > 18) {
      ctx.fillStyle = C.faint;
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
  ctx.fillStyle = C.ptr;
  const tw = 5 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y + h - 2 * scale);
  ctx.lineTo(cx + tw, y + h - 2 * scale);
  ctx.lineTo(cx, y + 2 * scale);
  ctx.closePath();
  ctx.fill();
}

// ── Teletype output strip ──

function drawTeletype(
  ctx: CanvasRenderingContext2D,
  interp: BFInterpreter,
  x: number, y: number, w: number, h: number,
  target: string | undefined,
  compact: boolean | undefined,
  scale: number,
) {
  // Paper strip — a lighter band, like the printer's roll under the lamp.
  ctx.fillStyle = 'rgba(228,214,178,0.07)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.panelEdge;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const labelFont = `${10 * scale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

  // Header label
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = labelFont;
  ctx.fillText('PRINTER', x + 6 * scale, y + 4 * scale);

  // Status mark top-right (truncated/halt). The "-1" sentinel that bumpCalc
  // appends to output is purely a marker for the GA's fitness function — strip
  // it from display so the mark can carry that info instead.
  let displayOutput = interp.output;
  if (interp.truncated && displayOutput.endsWith('-1')) {
    displayOutput = displayOutput.slice(0, -2);
  }
  if (interp.truncated) {
    ctx.fillStyle = C.warn;
    ctx.textAlign = 'right';
    ctx.font = labelFont;
    ctx.fillText('TRUNCATED', x + w - 6 * scale, y + 4 * scale);
  } else if (interp.done) {
    ctx.fillStyle = C.ok;
    ctx.textAlign = 'right';
    ctx.font = labelFont;
    ctx.fillText('HALT', x + w - 6 * scale, y + 4 * scale);
  }

  const N = target ? target.length : 0;
  const labelW = Math.round(62 * scale); // leave room for the PRINTER label + tiny gap
  const statusW = Math.round(72 * scale);
  const contentX = x + labelW;
  const contentW = w - labelW - statusW;
  const contentY = y + 4;
  const contentH = h - 8;

  // ── First-N "scored window" boxes ──
  // The GA's fitness function only rewards interp.output[0..N), so those are
  // the chars that actually matter. Always render them as typed frames with
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
      ctx.fillStyle = haveOutput ? accent.text : C.faint;
      ctx.fillText(glyph, bx + boxW / 2, boxesY + boxH / 2 + 1);
    }

    // Tiny "scored: hi" pencil note under the frames (subtle reference)
    if (boxH < contentH - 12 * scale) {
      ctx.font = `${9 * scale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(234,223,196,0.30)';
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
      ctx.fillStyle = 'rgba(234,223,196,0.35)';
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
  ctx.fillStyle = display.length === 0 ? C.dim : C.ok;
  while (ctx.measureText(display).width > w - 70 * scale && display.length > 1) {
    display = display.slice(0, -1);
  }
  ctx.fillText(display || '—', x + 6 * scale, y + h / 2 + 2);
}

const MATCH_EMPTY = {
  bg: 'rgba(234,223,196,0.03)',
  border: 'rgba(234,223,196,0.18)',
  text: 'rgba(234,223,196,0.20)',
};

// Per-position match quality — green ink through red ink by ASCII distance.
function matchAccent(dist: number): { bg: string; border: string; text: string } {
  if (dist === 0)  return { bg: 'rgba(147,216,164,0.20)', border: 'rgba(147,216,164,0.85)', text: '#c4ecce' };
  if (dist < 4)    return { bg: 'rgba(196,214,120,0.16)', border: 'rgba(196,214,120,0.70)', text: '#e0eaae' };
  if (dist < 16)   return { bg: 'rgba(238,188,98,0.16)',  border: 'rgba(238,188,98,0.65)',  text: '#f4d9a4' };
  if (dist < 64)   return { bg: 'rgba(233,143,86,0.16)',  border: 'rgba(233,143,86,0.65)',  text: '#f3c9ad' };
  return             { bg: 'rgba(229,127,107,0.16)',     border: 'rgba(229,127,107,0.65)', text: '#f2c4ba' };
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
  ctx.fillStyle = C.dim;
  ctx.fillText(
    `ip ${interp.ip} · ptr ${interp.dataPtr} · calcs ${interp.calcs.toLocaleString()} / ${interp.calcCap.toLocaleString()}`,
    x, y + h / 2,
  );
  void w;
}

// ── Strip-chart recorder (fitness) ──

function drawStripChart(
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

  // Chart-paper ruling — faint horizontal lines, like recorder paper.
  ctx.strokeStyle = 'rgba(234,223,196,0.06)';
  ctx.lineWidth = 0.5;
  const rules = 4;
  for (let i = 0; i <= rules; i++) {
    const ry = y + padTop + ((h - padTop - padBottom) / rules) * i;
    ctx.beginPath();
    ctx.moveTo(x, ry);
    ctx.lineTo(x + w, ry);
    ctx.stroke();
  }

  // Header label — pinned top-left, low opacity. Stays out of the chart.
  ctx.fillStyle = 'rgba(234,223,196,0.30)';
  ctx.font = `${9 * scale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FITNESS RECORDER', x, y);
  const last = trail[trail.length - 1];
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(239,121,211,0.65)';
  ctx.fillText(`${last.fitness} / ${targetFitness}`, x + w, y);

  // Target line — dashed, faint green ink
  ctx.strokeStyle = 'rgba(147,216,164,0.28)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  const ty = py(targetFitness);
  ctx.moveTo(x, ty);
  ctx.lineTo(x + w, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under the pen trace — very faint, integrates with bg
  ctx.fillStyle = C.chartFill;
  ctx.beginPath();
  ctx.moveTo(px(trail[0].gen), y + h - padBottom);
  for (const p of trail) ctx.lineTo(px(p.gen), py(p.fitness));
  ctx.lineTo(px(trail[trail.length - 1].gen), y + h - padBottom);
  ctx.closePath();
  ctx.fill();

  // Pen trace — magenta ink
  ctx.strokeStyle = C.chart;
  ctx.lineWidth = 1.4 * scale;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    if (i === 0) ctx.moveTo(px(p.gen), py(p.fitness));
    else ctx.lineTo(px(p.gen), py(p.fitness));
  }
  ctx.stroke();

  // The pen itself — a dot at the trace tip
  ctx.fillStyle = C.head;
  ctx.beginPath();
  ctx.arc(px(last.gen), py(last.fitness), 2.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// A paper tag clipped bottom-left when a newer tape is queued behind this one.
function drawPendingTag(
  ctx: CanvasRenderingContext2D,
  label: string,
  canvasW: number,
  canvasH: number,
  scale: number,
) {
  // In normal/inline mode, render at natural size. In fullscreen the rest of
  // the UI scales up but the tag is informational, not focal, so we halve
  // its growth so it doesn't dominate the corner.
  const s = canvasH >= 600 ? scale * 0.5 : 1;
  ctx.save();
  ctx.font = `${10 * s}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  const text = `↻ next tape · ${label}`;
  const tw = ctx.measureText(text).width;
  const px = 8 * s;
  const py = canvasH - 28 * s;
  const padX = 7 * s;
  const padY = 10 * s;
  ctx.fillStyle = 'rgba(228,214,178,0.10)';
  ctx.strokeStyle = 'rgba(239,121,211,0.55)';
  ctx.lineWidth = 0.8 * s;
  ctx.fillRect(px, py, tw + padX * 2, 20 * s);
  ctx.strokeRect(px + 0.5, py + 0.5, tw + padX * 2 - 1, 20 * s - 1);
  ctx.fillStyle = '#f3a8e0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + padX, py + padY);
  ctx.restore();
  void canvasW;
}
