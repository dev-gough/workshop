'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { fmtEta, fmtDuration } from '@/lib/format';
import {
  createCensusEngine,
  decodeState,
  stepBounded,
  MAX_AXIS,
} from '@/workers/gol-census-core';
import type { CensusResult } from '@/workers/gol-census-shared';
import { CensusPool, poolWorkerCount } from '@/lib/census-pool';

// ── Board sizes ───────────────────────────────────────────────────────────
//
// The heatmap is the full W×H matrix (width → columns, height ↓ rows) up to
// 7 on each axis, and doubles as the board picker. W×H and H×W are distinct
// boards computed independently — the transpose bijection says their counts
// must agree, which scripts/census-verify.ts exploits as a cross-check.
//
// Boards up to 2^20 states compute synchronously on mount (the engine clears
// ~7M states/s/core). Anything bigger is "the long count": a CensusPool fans
// block-aligned chunks out to one worker per core, checkpointing the merged
// contiguous prefix to localStorage so a page close never loses work.

const AXES = Array.from({ length: MAX_AXIS }, (_, i) => i + 1);
const AUTO_MAX_STATES = Math.pow(2, 20);

interface Size { w: number; h: number; }

const ALL_SIZES: Size[] = AXES.flatMap(h => AXES.map(w => ({ w, h })));

function totalOf(s: Size): number { return Math.pow(2, s.w * s.h); }
function isDeep(s: Size): boolean { return totalOf(s) > AUTO_MAX_STATES; }
function sizeKey(s: Size): string { return `${s.w}x${s.h}`; }
function sameSize(a: Size | null, b: Size | null): boolean {
  return !!a && !!b && a.w === b.w && a.h === b.h;
}

const STORAGE_PREFIX = 'gol-census-v2:';
const SAVE_THROTTLE_MS = 1500;

function storageKey(s: Size) { return `${STORAGE_PREFIX}${sizeKey(s)}`; }

function loadResult(s: Size): CensusResult | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(s));
    if (!raw) return null;
    return JSON.parse(raw) as CensusResult;
  } catch {
    return null;
  }
}

function saveResult(s: Size, r: CensusResult) {
  try {
    localStorage.setItem(storageKey(s), JSON.stringify(r));
  } catch {
    /* quota — ignore */
  }
}

// Counts up to 5.6×10¹⁴ (7×7) — compact above the readable threshold.
function fmtCount(v: number): string {
  if (v >= 1e14) return (v / 1e12).toFixed(0) + 'T';
  if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e10) return (v / 1e9).toFixed(0) + 'B';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e7) return (v / 1e6).toFixed(1) + 'M';
  return v.toLocaleString();
}

function oscTotal(r: CensusResult): number {
  return Object.values(r.periods).reduce((a, b) => a + b, 0);
}

function classifiedTotal(r: CensusResult): number {
  return r.dies + r.stillLifes + oscTotal(r) + r.unresolved;
}

// ── Small cell-grid canvas for gallery / examples ─────────────────────────

function MiniGrid({ state, w, h, cell = 12 }: { state: number; w: number; h: number; cell?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // a small slab of slate, ruled in chalk (single-mode like the board)
    ctx.fillStyle = '#0e1513';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(236,231,216,0.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0.5);
      ctx.lineTo(x * cell + 0.5, h * cell + 0.5);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath();
      ctx.moveTo(0.5, y * cell + 0.5);
      ctx.lineTo(w * cell + 0.5, y * cell + 0.5);
      ctx.stroke();
    }
    // decode via exact float64 math — states above 2^32 outgrow JS bitwise ops
    const rows = decodeState(w, h, state);
    ctx.fillStyle = '#ece7d8';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((rows[y] >>> x) & 1) {
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 1, cell - 1);
        }
      }
    }
  }, [state, w, h, cell]);

  return (
    <canvas
      ref={canvasRef}
      width={w * cell + 1}
      height={h * cell + 1}
      className="rounded-sm"
    />
  );
}

// ── Animated oscillator for the gallery ───────────────────────────────────
//
// Steps the actual bounded cycle with the census core's own step function.
// Click to chalk it onto the live board (page handles the tab flip).

function OscillatorGalleryItem({
  state, period, w, h, onOpen,
}: {
  state: number; period: number; w: number; h: number;
  onOpen?: () => void;
}) {
  const [frame, setFrame] = useState(state);

  useEffect(() => {
    let rows = decodeState(w, h, state);
    const block = Math.pow(2, w);
    const encode = (r: number[]) => r.reduce((s, row, y) => s + row * Math.pow(block, y), 0);
    setFrame(state);
    const id = setInterval(() => {
      rows = stepBounded(w, h, rows);
      setFrame(encode(rows));
    }, 400);
    return () => clearInterval(id);
  }, [state, w, h]);

  return (
    <button
      onClick={onOpen}
      disabled={!onOpen}
      title="Chalk it onto the board"
      className="group flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-2 transition-colors enabled:cursor-pointer enabled:hover:border-primary/50"
    >
      <MiniGrid state={frame} w={w} h={h} cell={Math.max(w, h) >= 6 ? 10 : Math.max(w, h) >= 5 ? 12 : 16} />
      <span className="text-[10px] font-medium text-muted-foreground tabular-nums transition-colors group-enabled:group-hover:text-primary">
        {w}×{h} · period {period}
      </span>
    </button>
  );
}

// ── Heatmap of oscillation % per board size ───────────────────────────────

function oscPercent(r: CensusResult): number {
  const classified = classifiedTotal(r);
  return classified > 0 ? (oscTotal(r) / classified) * 100 : 0;
}

function heatColor(pct: number): { bg: string; ink: string } {
  // 0% → bare slate, high% → yellow chalk laid on thick. Blend in HSL.
  const t = Math.min(pct / 20, 1); // scale: oscillation is rare, cap at 20%
  const hue = 163 - t * 116;  // 163 (slate green) → 47 (yellow chalk)
  const sat = 11 + t * 50;
  const light = 15 + t * 51;
  return {
    bg: `hsl(${hue}, ${sat}%, ${light}%)`,
    ink: t > 0.5 ? 'hsl(50 25% 8%)' : 'var(--gol-chalk, #ece7d8)',
  };
}

// ── Per-size result card ──────────────────────────────────────────────────

function pct(nu: number, total: number): string {
  if (total === 0) return '0%';
  return `${((nu / total) * 100).toFixed(nu / total < 0.001 ? 4 : 2)}%`;
}

const PERIOD_CHIP_CAP = 14;

function ResultCard({ result }: { result: CensusResult }) {
  const osc = oscTotal(result);
  const classified = classifiedTotal(result);
  const periodEntries = Object.entries(result.periods)
    .map(([p, c]) => [Number(p), c] as const)
    .sort((a, b) => a[0] - b[0]);

  const rows: { label: string; count: number; color: string }[] = [
    { label: 'Dies out', count: result.dies, color: 'bg-muted-foreground/40' },
    { label: 'Still life', count: result.stillLifes, color: 'bg-chart-2' },
    { label: 'Oscillates', count: osc, color: 'bg-chart-1' },
  ];
  if (result.unresolved > 0) {
    rows.push({ label: 'Unresolved', count: result.unresolved, color: 'bg-chart-3' });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">
          {result.w}×{result.h} board
          {!result.done && <span className="ml-2 normal-case tracking-normal text-muted-foreground">in progress</span>}
        </h3>
        <span
          className="text-[10px] text-muted-foreground font-mono tabular-nums"
          title={`${classified.toLocaleString()} of ${result.total.toLocaleString()} states classified`}
        >
          {fmtCount(classified)} / {fmtCount(result.total)}
        </span>
      </div>

      {/* Outcome breakdown — percentages are of states classified so far */}
      <div className="flex flex-col gap-1.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${row.color}`} />
            <span className="text-muted-foreground w-16">{row.label}</span>
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={`h-full ${row.color}`}
                style={{ width: `${classified > 0 ? (row.count / classified) * 100 : 0}%` }}
              />
            </div>
            <span className="font-mono tabular-nums w-14 text-right" title={row.count.toLocaleString()}>
              {fmtCount(row.count)}
            </span>
            <span className="font-mono tabular-nums w-14 text-right text-muted-foreground">
              {pct(row.count, classified)}
            </span>
          </div>
        ))}
      </div>

      {/* Period breakdown */}
      {periodEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {periodEntries.slice(0, PERIOD_CHIP_CAP).map(([p, c]) => (
            <span
              key={p}
              className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-chart-1/10 text-chart-1 border border-chart-1/25"
              title={`${c.toLocaleString()} configs oscillate with period ${p}`}
            >
              p{p}: {fmtCount(c)}
            </span>
          ))}
          {periodEntries.length > PERIOD_CHIP_CAP && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{periodEntries.length - PERIOD_CHIP_CAP} more periods
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface GolCensusProps {
  /** Chalk an oscillator's cells onto the main board (page flips the tab). */
  onShowOnBoard?: (cells: { x: number; y: number }[]) => void;
}

export default function GolCensus({ onShowOnBoard }: GolCensusProps) {
  const [results, setResults] = useState<Record<string, CensusResult>>({});
  const [sel, setSel] = useState<Size>({ w: 5, h: 5 });
  const [runningSize, setRunningSize] = useState<Size | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const poolRef = useRef<CensusPool | null>(null);
  const rateRef = useRef<{ t: number; classified: number } | null>(null);
  const lastSaveRef = useRef(0);

  const setResult = useCallback((r: CensusResult) => {
    setResults(prev => ({ ...prev, [sizeKey({ w: r.w, h: r.h })]: r }));
  }, []);

  // ── Load persisted results; compute the instant boards on the spot ──
  useEffect(() => {
    const loaded: Record<string, CensusResult> = {};
    for (const s of ALL_SIZES) {
      const r = loadResult(s);
      if (r) loaded[sizeKey(s)] = r;
    }
    if (Object.keys(loaded).length) setResults(loaded);

    // Every board ≤2^20 states runs synchronously — one per macrotask so the
    // UI keeps painting while the matrix fills in.
    const queue = ALL_SIZES.filter(s => !isDeep(s) && !loaded[sizeKey(s)]?.done);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const runNext = () => {
      if (cancelled || queue.length === 0) return;
      const s = queue.shift()!;
      const engine = createCensusEngine(s.w, s.h);
      const t0 = performance.now();
      const acc = engine.runChunk(0, engine.total);
      const result: CensusResult = {
        w: s.w,
        h: s.h,
        total: engine.total,
        processed: engine.total,
        dies: acc.dies,
        stillLifes: acc.stillLifes,
        unresolved: acc.unresolved,
        periods: acc.periods,
        oscExamples: acc.oscExamples,
        stillLifeExamples: acc.stillLifeExamples,
        done: true,
        elapsedMs: performance.now() - t0,
      };
      saveResult(s, result);
      setResult(result);
      timer = setTimeout(runNext, 0);
    };
    timer = setTimeout(runNext, 0);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep runs: worker pool with contiguous checkpoints ──

  const persistThrottled = useCallback((r: CensusResult, force = false) => {
    const now = performance.now();
    if (!force && now - lastSaveRef.current < SAVE_THROTTLE_MS) return;
    lastSaveRef.current = now;
    saveResult({ w: r.w, h: r.h }, r);
  }, []);

  const trackRate = useCallback((r: CensusResult) => {
    const now = performance.now();
    const classified = classifiedTotal(r);
    const prev = rateRef.current;
    if (prev && now - prev.t > 400) {
      const inst = ((classified - prev.classified) / (now - prev.t)) * 1000;
      setRate(old => (old === null ? inst : old * 0.7 + inst * 0.3));
      rateRef.current = { t: now, classified };
    } else if (!prev) {
      rateRef.current = { t: now, classified };
    }
  }, []);

  const startDeep = useCallback(() => {
    if (poolRef.current) return;
    const s = sel;
    rateRef.current = null;
    setRate(null);
    const pool = new CensusPool(s.w, s.h, loadResult(s), {
      onUpdate: (r) => {
        setResult(r);
        trackRate(r);
        persistThrottled(r);
      },
      onDone: (r) => {
        setResult(r);
        persistThrottled(r, true);
        setRunningSize(null);
        poolRef.current = null;
        setRate(null);
      },
    });
    poolRef.current = pool;
    setRunningSize(s);
    pool.start();
  }, [sel, persistThrottled, setResult, trackRate]);

  const pauseDeep = useCallback(() => {
    const pool = poolRef.current;
    if (!pool) return;
    const snapshot = pool.stop();
    poolRef.current = null;
    setRunningSize(null);
    setRate(null);
    setResult(snapshot);
    persistThrottled(snapshot, true);
  }, [persistThrottled, setResult]);

  const resetDeep = useCallback(() => {
    if (runningSize) return;
    try { localStorage.removeItem(storageKey(sel)); } catch { /* ignore */ }
    setResults(prev => {
      const next = { ...prev };
      delete next[sizeKey(sel)];
      return next;
    });
  }, [sel, runningSize]);

  // Pause (checkpointing) if the page unmounts mid-run.
  useEffect(() => () => {
    const pool = poolRef.current;
    if (pool) {
      const snapshot = pool.stop();
      saveResult({ w: snapshot.w, h: snapshot.h }, snapshot);
      poolRef.current = null;
    }
  }, []);

  const openOscillator = useCallback((w: number, h: number, state: number) => {
    if (!onShowOnBoard) return;
    const rows = decodeState(w, h, state);
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((rows[y] >>> x) & 1) cells.push({ x, y });
      }
    }
    onShowOnBoard(cells);
  }, [onShowOnBoard]);

  // ── Derived ──
  //
  // Progress is measured in states CLASSIFIED (weighted by symmetry orbits),
  // not the raw index cursor: pruning makes per-index cost swing ~1000×
  // across the space, so the cursor is a poor progress signal, while
  // classified grows with actual work and lands exactly on `total`.
  const selResult = results[sizeKey(sel)];
  const selTotal = totalOf(sel);
  const selClassified = selResult ? classifiedTotal(selResult) : 0;
  const selPct = (selClassified / selTotal) * 100;
  const selIsRunning = sameSize(runningSize, sel);
  const etaSeconds = rate && rate > 0 ? Math.round((selTotal - selClassified) / rate) : 0;

  const galleryItems = Object.values(results)
    .flatMap(r => r.oscExamples.map(ex => ({ ...ex, w: r.w, h: r.h })))
    .sort((a, b) => b.period - a.period)
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="ws-serif text-2xl font-semibold">The census</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every starting configuration on a bounded W×H board, simulated to its cycle and
          classified as dies&nbsp;out, still&nbsp;life, or oscillator. Boards to a million states
          compute on arrival; bigger ones run on every core this machine has.
        </p>
      </div>

      {/* Heatmap matrix — width → columns, height ↓ rows. Also the picker. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">Oscillation heatmap</h3>
          <span className="text-[10px] text-muted-foreground">
            % of configs ending in an oscillating cycle · select a board to inspect it
          </span>
        </div>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `2rem repeat(${MAX_AXIS}, minmax(0, 1fr))` }}
        >
          <div className="flex items-end justify-center pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span title="height ↓ / width →">h\w</span>
          </div>
          {AXES.map(w => (
            <div key={`col-${w}`} className="flex items-end justify-center pb-1 text-[10px] font-mono text-muted-foreground">
              {w}
            </div>
          ))}
          {AXES.map(h => (
            <div key={`row-${h}`} className="contents">
              <div className="flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                {h}
              </div>
              {AXES.map(w => {
                const s = { w, h };
                const r = results[sizeKey(s)];
                const hasData = r && classifiedTotal(r) > 0;
                const pctVal = hasData ? oscPercent(r) : null;
                const heat = pctVal !== null ? heatColor(pctVal) : null;
                const selected = sameSize(sel, s);
                const isRun = sameSize(runningSize, s);
                return (
                  <button
                    key={sizeKey(s)}
                    onClick={() => setSel(s)}
                    className={`flex h-11 flex-col items-center justify-center rounded-md transition-shadow ${
                      heat ? '' : 'bg-muted text-muted-foreground'
                    } ${selected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40'}`}
                    style={heat ? { background: heat.bg, color: heat.ink } : undefined}
                    title={
                      hasData
                        ? `${w}×${h}: ${pctVal!.toFixed(3)}% oscillate${r.done ? '' : ' (partial)'}`
                        : `${w}×${h}: ${fmtCount(totalOf(s))} states, not yet counted`
                    }
                  >
                    <span className={`text-[10px] font-mono tabular-nums leading-none ${isRun ? 'animate-pulse' : ''}`}>
                      {pctVal !== null ? `${pctVal.toFixed(2)}${r.done ? '' : '…'}` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* The long count — controls for the selected deep board */}
      {isDeep(sel) && (
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                The long count — {sel.w}×{sel.h}
                <span className="ml-2 font-mono normal-case tracking-normal text-muted-foreground">
                  {fmtCount(selTotal)} states
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
                One worker per core sweeps the state space in resumable chunks — symmetry
                pruning, bit-parallel stepping, Brent cycle detection. Progress checkpoints
                to this browser, so closing the page never loses a run.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {runningSize ? (
                <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={pauseDeep}>
                  <Pause className="h-3.5 w-3.5" /> Pause {runningSize.w}×{runningSize.h}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={startDeep}
                  disabled={selResult?.done}
                >
                  <Play className="h-3.5 w-3.5" />
                  {selResult && !selResult.done && selResult.processed > 0 ? 'Resume' : 'Start'}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={resetDeep} disabled={!!runningSize}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>

          {runningSize && !selIsRunning && (
            <p className="text-[11px] text-muted-foreground">
              {runningSize.w}×{runningSize.h} is mid-count — pause it to start {sel.w}×{sel.h}.
            </p>
          )}

          {selResult && (
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-chart-1 transition-[width] duration-200"
                  style={{ width: `${Math.min(selPct, 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-[10px] text-muted-foreground font-mono tabular-nums">
                <span
                  title={`${selClassified.toLocaleString()} of ${selTotal.toLocaleString()} states classified · index cursor at ${selResult.processed.toLocaleString()}`}
                >
                  {selPct.toFixed(2)}% · {fmtCount(selClassified)} / {fmtCount(selTotal)} counted
                </span>
                <span className="flex items-center gap-3">
                  {selIsRunning && rate !== null && rate > 0 && (
                    <>
                      <span>{fmtCount(Math.round(rate))} states/s · {poolRef.current?.workerCount ?? poolWorkerCount()} workers</span>
                      <span>ETA {fmtEta(etaSeconds)}</span>
                    </>
                  )}
                  {selResult.done && (
                    <span className="text-chart-4">
                      complete in {fmtDuration(Math.max(1, Math.round(selResult.elapsedMs / 1000)))}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected board detail */}
      {selResult && classifiedTotal(selResult) > 0 && <ResultCard result={selResult} />}

      {/* Longest-period oscillator gallery */}
      {galleryItems.length > 0 && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">Longest-period oscillators found</h3>
            <span className="text-[10px] text-muted-foreground">select one to chalk it onto the board</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {galleryItems.map((it, i) => (
              <OscillatorGalleryItem
                key={`${it.w}x${it.h}-${it.period}-${i}`}
                state={it.state}
                period={it.period}
                w={it.w}
                h={it.h}
                onOpen={onShowOnBoard ? () => openOscillator(it.w, it.h, it.state) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
