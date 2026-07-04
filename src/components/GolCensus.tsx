'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import type {
  CensusAcc,
  CensusRequest,
  CensusResult,
  CensusWorkerMessage,
} from '@/workers/gol-census-shared';

// ── Grid sizes ────────────────────────────────────────────────────────────
//
// Square sizes 1×1..4×4 complete near-instantly (≤65k states). 5×5 (2^25 =
// 33.5M states) is run in resumable chunks with a start/pause control and
// periodic localStorage checkpoints.

interface Size { w: number; h: number; }

const AUTO_SIZES: Size[] = [
  { w: 1, h: 1 },
  { w: 2, h: 2 },
  { w: 3, h: 3 },
  { w: 4, h: 4 },
];
const BIG_SIZE: Size = { w: 5, h: 5 };

const CHUNK_SIZE = 2_000_000; // states per resumable chunk for 5×5

const STORAGE_PREFIX = 'gol-census-v1:';

function sizeKey(s: Size) { return `${s.w}x${s.h}`; }
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

function accFromResult(r: CensusResult): CensusAcc {
  return {
    dies: r.dies,
    stillLifes: r.stillLifes,
    periods: r.periods,
    oscExamples: r.oscExamples,
    stillLifeExamples: r.stillLifeExamples,
    elapsedMs: r.elapsedMs,
  };
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
    ctx.fillStyle = '#ece7d8';
    for (let i = 0; i < w * h; i++) {
      if ((state >>> i) & 1) {
        const cx = i % w;
        const cy = Math.floor(i / w);
        ctx.fillRect(cx * cell + 1, cy * cell + 1, cell - 1, cell - 1);
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
// Renders the actual cycle of a period-N oscillator by stepping a bounded
// bitboard on an interval. Purely decorative; static frame is fine but this is
// the "animate the cycle" bonus.

function buildNeighborMask(w: number, h: number): Uint32Array {
  const mask = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          m |= 1 << (ny * w + nx);
        }
      }
      mask[y * w + x] = m;
    }
  }
  return mask;
}
function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function boundedStep(state: number, w: number, h: number, mask: Uint32Array): number {
  let next = 0;
  const cells = w * h;
  for (let i = 0; i < cells; i++) {
    const n = popcount(state & mask[i]);
    const alive = (state >>> i) & 1;
    if (n === 3 || (n === 2 && alive)) next |= 1 << i;
  }
  return next;
}

function OscillatorGalleryItem({ state, period, w, h }: { state: number; period: number; w: number; h: number }) {
  const [frame, setFrame] = useState(state);
  useEffect(() => {
    const mask = buildNeighborMask(w, h);
    let cur = state;
    setFrame(state);
    const id = setInterval(() => {
      cur = boundedStep(cur, w, h, mask);
      setFrame(cur);
    }, 400);
    return () => clearInterval(id);
  }, [state, w, h]);

  return (
    <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-border bg-card">
      <MiniGrid state={frame} w={w} h={h} cell={w >= 5 ? 12 : 16} />
      <span className="text-[10px] font-medium text-muted-foreground tabular-nums">period {period}</span>
    </div>
  );
}

// ── Heatmap of oscillation % per grid dimension ───────────────────────────

function oscPercent(r: CensusResult): number {
  const oscCount = Object.values(r.periods).reduce((a, b) => a + b, 0);
  return r.processed > 0 ? (oscCount / r.processed) * 100 : 0;
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

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${((n / total) * 100).toFixed(n / total < 0.001 ? 4 : 2)}%`;
}

function ResultCard({ result }: { result: CensusResult }) {
  const oscCount = Object.values(result.periods).reduce((a, b) => a + b, 0);
  const periodEntries = Object.entries(result.periods)
    .map(([p, c]) => [Number(p), c] as const)
    .sort((a, b) => a[0] - b[0]);

  const rows: { label: string; count: number; color: string }[] = [
    { label: 'Dies out', count: result.dies, color: 'bg-muted-foreground/40' },
    { label: 'Still life', count: result.stillLifes, color: 'bg-chart-2' },
    { label: 'Oscillates', count: oscCount, color: 'bg-chart-1' },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">{result.w}×{result.h} board</h3>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {result.processed.toLocaleString()} / {result.total.toLocaleString()}
        </span>
      </div>

      {/* Outcome breakdown */}
      <div className="flex flex-col gap-1.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${row.color}`} />
            <span className="text-muted-foreground w-16">{row.label}</span>
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={`h-full ${row.color}`}
                style={{ width: `${result.processed > 0 ? (row.count / result.processed) * 100 : 0}%` }}
              />
            </div>
            <span className="font-mono tabular-nums w-12 text-right">{row.count.toLocaleString()}</span>
            <span className="font-mono tabular-nums w-14 text-right text-muted-foreground">
              {pct(row.count, result.processed)}
            </span>
          </div>
        ))}
      </div>

      {/* Period breakdown */}
      {periodEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {periodEntries.map(([p, c]) => (
            <span
              key={p}
              className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-chart-1/10 text-chart-1 border border-chart-1/25"
              title={`${c.toLocaleString()} configs oscillate with period ${p}`}
            >
              p{p}: {c.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function GolCensus() {
  const [results, setResults] = useState<Record<string, CensusResult>>({});
  const [bigRunning, setBigRunning] = useState(false);
  const [bigRate, setBigRate] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const bigResultRef = useRef<CensusResult | null>(null);
  const rateRef = useRef<{ t: number; processed: number } | null>(null);

  const setResult = useCallback((r: CensusResult) => {
    setResults(prev => ({ ...prev, [sizeKey({ w: r.w, h: r.h })]: r }));
  }, []);

  // ── Run the quick (auto) sizes once on mount, resuming from storage ──
  useEffect(() => {
    // Load any persisted results first (instant paint).
    const loaded: Record<string, CensusResult> = {};
    for (const s of [...AUTO_SIZES, BIG_SIZE]) {
      const r = loadResult(s);
      if (r) loaded[sizeKey(s)] = r;
    }
    if (Object.keys(loaded).length) setResults(loaded);

    // Compute any auto sizes not yet complete. These are tiny, run them inline
    // in a throwaway worker sequentially.
    const worker = new Worker(new URL('../workers/gol-census.worker.ts', import.meta.url));
    let cancelled = false;
    const queue = AUTO_SIZES.filter(s => !loaded[sizeKey(s)]?.done);
    let idx = 0;

    const runNext = () => {
      if (cancelled || idx >= queue.length) { worker.terminate(); return; }
      const s = queue[idx];
      const req: CensusRequest = { w: s.w, h: s.h, total: 2 ** (s.w * s.h) };
      worker.postMessage(req);
    };

    worker.onmessage = (e: MessageEvent<CensusWorkerMessage>) => {
      const { result } = e.data;
      if (cancelled) return;
      setResult(result);
      if (e.data.type === 'done') {
        saveResult({ w: result.w, h: result.h }, result);
        idx++;
        runNext();
      }
    };

    runNext();
    return () => { cancelled = true; worker.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 5×5 chunked runner ──
  const dispatchBigChunk = useCallback((from: number, acc: CensusAcc | undefined) => {
    const worker = workerRef.current;
    if (!worker) return;
    const req: CensusRequest = {
      w: BIG_SIZE.w,
      h: BIG_SIZE.h,
      total: 2 ** (BIG_SIZE.w * BIG_SIZE.h),
      startFrom: from,
      chunkSize: CHUNK_SIZE,
      acc,
    };
    worker.postMessage(req);
  }, []);

  const startBig = useCallback(() => {
    if (bigRunning) return;
    setBigRunning(true);
    rateRef.current = { t: performance.now(), processed: 0 };

    const worker = new Worker(new URL('../workers/gol-census.worker.ts', import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<CensusWorkerMessage>) => {
      const { result } = e.data;
      bigResultRef.current = result;
      setResult(result);

      // Rate estimate (states/sec).
      const rr = rateRef.current;
      if (rr) {
        const now = performance.now();
        const dt = (now - rr.t) / 1000;
        if (dt > 0.5) {
          setBigRate(Math.round((result.processed - rr.processed) / dt));
          rateRef.current = { t: now, processed: result.processed };
        }
      }

      if (e.data.type === 'done') {
        saveResult(BIG_SIZE, result);
        setBigRunning(false);
        worker.terminate();
        workerRef.current = null;
      } else if (e.data.type === 'checkpoint') {
        // Persist and continue with a fresh chunk.
        saveResult(BIG_SIZE, result);
        dispatchBigChunk(result.processed, accFromResult(result));
      }
    };

    // Resume from checkpoint if present.
    const existing = bigResultRef.current ?? loadResult(BIG_SIZE);
    if (existing && !existing.done && existing.processed > 0) {
      bigResultRef.current = existing;
      dispatchBigChunk(existing.processed, accFromResult(existing));
    } else {
      dispatchBigChunk(0, undefined);
    }
  }, [bigRunning, dispatchBigChunk, setResult]);

  const pauseBig = useCallback(() => {
    const worker = workerRef.current;
    if (worker) { worker.terminate(); workerRef.current = null; }
    setBigRunning(false);
    // Persist the latest so we can resume across visits.
    const r = bigResultRef.current;
    if (r) saveResult(BIG_SIZE, r);
  }, []);

  const resetBig = useCallback(() => {
    pauseBig();
    try { localStorage.removeItem(storageKey(BIG_SIZE)); } catch { /* ignore */ }
    bigResultRef.current = null;
    setBigRate(null);
    setResults(prev => {
      const next = { ...prev };
      delete next[sizeKey(BIG_SIZE)];
      return next;
    });
  }, [pauseBig]);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  // ── Derived: heatmap + gallery across all completed sizes ──
  const allSizes = [...AUTO_SIZES, BIG_SIZE];
  const bigResult = results[sizeKey(BIG_SIZE)];

  // Gather longest-period oscillators across all sizes for the gallery.
  const galleryItems = allSizes
    .map(s => results[sizeKey(s)])
    .filter((r): r is CensusResult => !!r)
    .flatMap(r => r.oscExamples.map(ex => ({ ...ex, w: r.w, h: r.h })))
    .sort((a, b) => b.period - a.period)
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="ws-serif text-2xl font-semibold">The census</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every starting configuration on a bounded W×H board, simulated to its cycle and classified
          as dies&nbsp;out, still&nbsp;life, or oscillator. Small boards compute instantly; 5×5
          (33.5M states) runs in resumable chunks.
        </p>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">Oscillation heatmap</h3>
          <span className="text-[10px] text-muted-foreground">% of configs ending in an oscillating cycle</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {allSizes.map(s => {
            const r = results[sizeKey(s)];
            const pctVal = r ? oscPercent(r) : null;
            const heat = pctVal !== null ? heatColor(pctVal) : null;
            return (
              <div
                key={sizeKey(s)}
                className={`flex flex-col items-center justify-center rounded-lg w-20 h-20 shadow-sm ${heat ? '' : 'bg-muted text-muted-foreground'}`}
                style={heat ? { background: heat.bg, color: heat.ink } : undefined}
                title={r ? `${s.w}×${s.h}: ${pctVal!.toFixed(3)}% oscillate` : `${s.w}×${s.h}: pending`}
              >
                <span className="text-xs font-semibold">{s.w}×{s.h}</span>
                <span className="text-[11px] font-mono tabular-nums">
                  {pctVal !== null ? `${pctVal.toFixed(2)}%` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5×5 controls */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">5×5 census (2²⁵ = 33.5M states)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Runs in {(CHUNK_SIZE / 1_000_000).toFixed(0)}M-state chunks, checkpointed to
              localStorage so a page close doesn&apos;t lose progress.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {bigRunning ? (
              <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={pauseBig}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5" onClick={startBig}>
                <Play className="h-3.5 w-3.5" />
                {bigResult && !bigResult.done && bigResult.processed > 0 ? 'Resume' : 'Start'}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={resetBig} disabled={bigRunning}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
        {bigResult && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-chart-1 transition-[width] duration-200"
                style={{ width: `${(bigResult.processed / bigResult.total) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono tabular-nums">
              <span>{((bigResult.processed / bigResult.total) * 100).toFixed(2)}% · {bigResult.processed.toLocaleString()} / {bigResult.total.toLocaleString()}</span>
              {bigRate !== null && bigRunning && <span>{bigRate.toLocaleString()} states/s</span>}
              {bigResult.done && <span className="text-chart-4">complete</span>}
            </div>
          </div>
        )}
      </div>

      {/* Per-size result cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {allSizes.map(s => {
          const r = results[sizeKey(s)];
          if (!r) return null;
          return <ResultCard key={sizeKey(s)} result={r} />;
        })}
      </div>

      {/* Longest-period oscillator gallery */}
      {galleryItems.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3">Longest-period oscillators found</h3>
          <div className="flex flex-wrap gap-3">
            {galleryItems.map((it, i) => (
              <OscillatorGalleryItem key={`${it.w}x${it.h}-${it.period}-${i}`} state={it.state} period={it.period} w={it.w} h={it.h} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
