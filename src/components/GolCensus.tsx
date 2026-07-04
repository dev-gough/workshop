'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { fmtEta, fmtDuration } from '@/lib/format';
import {
  createCensusEngine,
  decodeState,
  stepBounded,
  MAX_N,
} from '@/workers/gol-census-core';
import type { CensusResult } from '@/workers/gol-census-shared';
import { CensusPool, freshResult, poolWorkerCount } from '@/lib/census-pool';

// ── Board sizes ───────────────────────────────────────────────────────────
//
// 1×1..4×4 (≤65k states) compute synchronously on mount — the engine clears
// them in milliseconds. 5×5 and up are "the long count": a CensusPool fans
// block-aligned chunks out to one worker per core, and the merged contiguous
// prefix checkpoints to localStorage so a page close never loses work.
// 7×7 is the ceiling: its 2^49 indices are the largest that stay exact in a
// float64 (8×8 would need 2^64), and even it is a gift to future hardware.

const AUTO_NS = [1, 2, 3, 4];
const DEEP_NS = [5, 6, 7];
const ALL_NS = [...AUTO_NS, ...DEEP_NS];

const STORAGE_PREFIX = 'gol-census-v2:';
const SAVE_THROTTLE_MS = 1500;

function storageKey(n: number) { return `${STORAGE_PREFIX}${n}x${n}`; }

function loadResult(n: number): CensusResult | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(n));
    if (!raw) return null;
    return JSON.parse(raw) as CensusResult;
  } catch {
    return null;
  }
}

function saveResult(n: number, r: CensusResult) {
  try {
    localStorage.setItem(storageKey(n), JSON.stringify(r));
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

function classifiedTotal(r: CensusResult): number {
  return r.dies + r.stillLifes + oscTotal(r) + r.unresolved;
}

function oscTotal(r: CensusResult): number {
  return Object.values(r.periods).reduce((a, b) => a + b, 0);
}

// ── Small cell-grid canvas for gallery / examples ─────────────────────────

function MiniGrid({ state, n, cell = 12 }: { state: number; n: number; cell?: number }) {
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
    for (let x = 0; x <= n; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0.5);
      ctx.lineTo(x * cell + 0.5, n * cell + 0.5);
      ctx.stroke();
    }
    for (let y = 0; y <= n; y++) {
      ctx.beginPath();
      ctx.moveTo(0.5, y * cell + 0.5);
      ctx.lineTo(n * cell + 0.5, y * cell + 0.5);
      ctx.stroke();
    }
    // decode via exact float64 math — states above 2^32 outgrow JS bitwise ops
    const rows = decodeState(n, state);
    ctx.fillStyle = '#ece7d8';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((rows[y] >>> x) & 1) {
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 1, cell - 1);
        }
      }
    }
  }, [state, n, cell]);

  return (
    <canvas
      ref={canvasRef}
      width={n * cell + 1}
      height={n * cell + 1}
      className="rounded-sm"
    />
  );
}

// ── Animated oscillator for the gallery ───────────────────────────────────
//
// Renders the actual cycle of a period-N oscillator by stepping the bounded
// board on an interval, using the census core's own step function.

function OscillatorGalleryItem({ state, period, n }: { state: number; period: number; n: number }) {
  const [frame, setFrame] = useState(state);

  useEffect(() => {
    let rows = decodeState(n, state);
    const block = Math.pow(2, n);
    const encode = (r: number[]) => r.reduce((s, row, y) => s + row * Math.pow(block, y), 0);
    setFrame(state);
    const id = setInterval(() => {
      rows = stepBounded(n, rows);
      setFrame(encode(rows));
    }, 400);
    return () => clearInterval(id);
  }, [state, n]);

  return (
    <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-border bg-card">
      <MiniGrid state={frame} n={n} cell={n >= 6 ? 10 : n >= 5 ? 12 : 16} />
      <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
        {n}×{n} · period {period}
      </span>
    </div>
  );
}

// ── Heatmap of oscillation % per grid dimension ───────────────────────────

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

export default function GolCensus() {
  const [results, setResults] = useState<Record<number, CensusResult>>({});
  const [deepN, setDeepN] = useState(5);
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const poolRef = useRef<CensusPool | null>(null);
  const rateRef = useRef<{ t: number; processed: number } | null>(null);
  const lastSaveRef = useRef(0);

  const setResult = useCallback((r: CensusResult) => {
    setResults(prev => ({ ...prev, [r.w]: r }));
  }, []);

  // ── Load persisted results; compute the instant sizes on the spot ──
  useEffect(() => {
    const loaded: Record<number, CensusResult> = {};
    for (const n of ALL_NS) {
      const r = loadResult(n);
      if (r) loaded[n] = r;
    }
    if (Object.keys(loaded).length) setResults(loaded);

    // 1×1..4×4: ≤65k states each — the engine clears the lot in ~10ms on the
    // main thread, so no worker ceremony. Deferred a tick to let paint land.
    const missing = AUTO_NS.filter(n => !loaded[n]?.done);
    if (missing.length === 0) return;
    const t = setTimeout(() => {
      for (const n of missing) {
        const engine = createCensusEngine(n);
        const t0 = performance.now();
        const acc = engine.runChunk(0, engine.total);
        const result: CensusResult = {
          w: n,
          h: n,
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
        saveResult(n, result);
        setResult(result);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep runs (5×5+): worker pool with contiguous checkpoints ──

  const persistThrottled = useCallback((r: CensusResult, force = false) => {
    const now = performance.now();
    if (!force && now - lastSaveRef.current < SAVE_THROTTLE_MS) return;
    lastSaveRef.current = now;
    saveResult(r.w, r);
  }, []);

  const trackRate = useCallback((r: CensusResult) => {
    const now = performance.now();
    const classified = classifiedTotal(r);
    const prev = rateRef.current;
    if (prev && now - prev.t > 400) {
      const inst = ((classified - prev.processed) / (now - prev.t)) * 1000;
      setRate(old => (old === null ? inst : old * 0.7 + inst * 0.3));
      rateRef.current = { t: now, processed: classified };
    } else if (!prev) {
      rateRef.current = { t: now, processed: classified };
    }
  }, []);

  const startDeep = useCallback(() => {
    if (poolRef.current) return;
    const n = deepN;
    rateRef.current = null;
    setRate(null);
    const pool = new CensusPool(n, loadResult(n), {
      onUpdate: (r) => {
        setResult(r);
        trackRate(r);
        persistThrottled(r);
      },
      onDone: (r) => {
        setResult(r);
        persistThrottled(r, true);
        setRunning(false);
        poolRef.current = null;
        setRate(null);
      },
    });
    poolRef.current = pool;
    setRunning(true);
    pool.start();
  }, [deepN, persistThrottled, setResult, trackRate]);

  const pauseDeep = useCallback(() => {
    const pool = poolRef.current;
    if (!pool) return;
    const snapshot = pool.stop();
    poolRef.current = null;
    setRunning(false);
    setRate(null);
    setResult(snapshot);
    persistThrottled(snapshot, true);
  }, [persistThrottled, setResult]);

  const resetDeep = useCallback(() => {
    if (running) return;
    try { localStorage.removeItem(storageKey(deepN)); } catch { /* ignore */ }
    setResults(prev => {
      const next = { ...prev };
      delete next[deepN];
      return next;
    });
  }, [deepN, running]);

  // Pause (checkpointing) if the page unmounts mid-run.
  useEffect(() => () => {
    const pool = poolRef.current;
    if (pool) {
      const snapshot = pool.stop();
      saveResult(snapshot.w, snapshot);
      poolRef.current = null;
    }
  }, []);

  // ── Derived ──
  //
  // Progress is measured in states CLASSIFIED (weighted by symmetry orbits),
  // not the raw index cursor: pruning makes per-index cost swing ~1000×
  // across the space, so the cursor is a poor progress signal, while
  // classified grows with actual work and lands exactly on `total`.
  const deepResult = results[deepN];
  const deepTotal = Math.pow(2, deepN * deepN);
  const deepClassified = deepResult ? classifiedTotal(deepResult) : 0;
  const deepPct = (deepClassified / deepTotal) * 100;
  const etaSeconds = rate && rate > 0 ? Math.round((deepTotal - deepClassified) / rate) : 0;

  const galleryItems = ALL_NS
    .map(n => results[n])
    .filter((r): r is CensusResult => !!r)
    .flatMap(r => r.oscExamples.map(ex => ({ ...ex, n: r.w })))
    .sort((a, b) => b.period - a.period)
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="ws-serif text-2xl font-semibold">The census</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every starting configuration on a bounded N×N board, simulated to its cycle and classified
          as dies&nbsp;out, still&nbsp;life, or oscillator. Boards to 4×4 compute instantly;
          5×5 and up run on every core this machine has.
        </p>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">Oscillation heatmap</h3>
          <span className="text-[10px] text-muted-foreground">% of configs ending in an oscillating cycle</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_NS.map(n => {
            const r = results[n];
            const hasData = r && classifiedTotal(r) > 0;
            const pctVal = hasData ? oscPercent(r) : null;
            const heat = pctVal !== null ? heatColor(pctVal) : null;
            return (
              <div
                key={n}
                className={`flex flex-col items-center justify-center rounded-lg w-20 h-20 shadow-sm ${heat ? '' : 'bg-muted text-muted-foreground'}`}
                style={heat ? { background: heat.bg, color: heat.ink } : undefined}
                title={
                  hasData
                    ? `${n}×${n}: ${pctVal!.toFixed(3)}% oscillate${r.done ? '' : ' (partial)'}`
                    : `${n}×${n}: not yet counted`
                }
              >
                <span className="text-xs font-semibold">{n}×{n}</span>
                <span className="text-[11px] font-mono tabular-nums">
                  {pctVal !== null ? `${pctVal.toFixed(2)}%${r.done ? '' : '…'}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* The long count — deep sizes on the worker pool */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">The long count</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
              One worker per core sweeps the state space in resumable chunks — D4 symmetry
              pruning, bit-parallel stepping, Brent cycle detection. Progress checkpoints to
              this browser, so closing the page never loses a run.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {running ? (
              <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={pauseDeep}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={startDeep}
                disabled={deepResult?.done}
              >
                <Play className="h-3.5 w-3.5" />
                {deepResult && !deepResult.done && deepResult.processed > 0 ? 'Resume' : 'Start'}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={resetDeep} disabled={running}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>

        {/* Size chips — a stick of chalk per board */}
        <div className="flex flex-wrap gap-2">
          {DEEP_NS.map(n => {
            const r = results[n];
            const selected = n === deepN;
            const status = r?.done
              ? 'complete'
              : r && r.processed > 0
                ? `${((classifiedTotal(r) / Math.pow(2, n * n)) * 100).toFixed(1)}%`
                : `${fmtCount(Math.pow(2, n * n))} states`;
            return (
              <button
                key={n}
                onClick={() => setDeepN(n)}
                disabled={running}
                className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                }`}
              >
                <span className="text-xs font-semibold">{n}×{n}</span>
                <span className="text-[10px] font-mono tabular-nums opacity-80">{status}</span>
              </button>
            );
          })}
          <span className="self-center text-[10px] text-muted-foreground pl-1">
            8×8 would need 2⁶⁴ — past float64 and past patience. {MAX_N}×{MAX_N} is the wall.
          </span>
        </div>

        {deepResult && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-chart-1 transition-[width] duration-200"
                style={{ width: `${Math.min(deepPct, 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-[10px] text-muted-foreground font-mono tabular-nums">
              <span
                title={`${deepClassified.toLocaleString()} of ${deepTotal.toLocaleString()} states classified · index cursor at ${(deepResult.processed).toLocaleString()}`}
              >
                {deepPct.toFixed(2)}% · {fmtCount(deepClassified)} / {fmtCount(deepTotal)} counted
              </span>
              <span className="flex items-center gap-3">
                {running && rate !== null && rate > 0 && (
                  <>
                    <span>{fmtCount(Math.round(rate))} states/s · {poolRef.current?.workerCount ?? poolWorkerCount()} workers</span>
                    <span>ETA {fmtEta(etaSeconds)}</span>
                  </>
                )}
                {deepResult.done && (
                  <span className="text-chart-4">
                    complete in {fmtDuration(Math.max(1, Math.round(deepResult.elapsedMs / 1000)))}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Per-size result cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {ALL_NS.map(n => {
          const r = results[n];
          if (!r || classifiedTotal(r) === 0) return null;
          return <ResultCard key={n} result={r} />;
        })}
      </div>

      {/* Longest-period oscillator gallery */}
      {galleryItems.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3">Longest-period oscillators found</h3>
          <div className="flex flex-wrap gap-3">
            {galleryItems.map((it, i) => (
              <OscillatorGalleryItem key={`${it.n}-${it.period}-${i}`} state={it.state} period={it.period} n={it.n} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
