/// <reference lib="webworker" />
//
// Game of Life exhaustive-orientation census worker.
//
// For a W×H BOUNDED grid (cells outside the grid are permanently dead), every
// starting configuration is enumerated exhaustively. Each config is packed into
// a single 32-bit integer (bit `y*W + x`), so a grid of up to 25 cells fits in
// one uint32. Each state is simulated forward until it revisits a previously
// seen state (Brent/Floyd-style cycle detection via a hash map from state →
// first generation seen). The cycle is then classified:
//   • reaches state 0            → "dies"
//   • cycle length 1, state ≠ 0  → "still life"
//   • cycle length N > 1         → "oscillator of period N"
//
// All bounded trajectories are eventually periodic, so classification always
// terminates. The message protocol (see gol-census-shared.ts) streams progress
// roughly every ~100k states and supports pause/resume + resumable 5×5 chunks.

import type {
  CensusRequest,
  CensusResult,
  CensusWorkerMessage,
} from './gol-census-shared';

// ── Bounded-grid step, precomputed per (W,H) ──────────────────────────────
//
// For a given board geometry we precompute, for every bit position, the mask of
// its (in-bounds) neighbours. Stepping is then a per-cell popcount of
// (state & neighbourMask[i]) plus the Life rule.

interface Geometry {
  w: number;
  h: number;
  cells: number;            // w*h
  neighborMask: Uint32Array; // neighborMask[i] = bitmask of neighbours of cell i
}

function buildGeometry(w: number, h: number): Geometry {
  const cells = w * h;
  const neighborMask = new Uint32Array(cells);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let mask = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          mask |= 1 << (ny * w + nx);
        }
      }
      neighborMask[i] = mask;
    }
  }
  return { w, h, cells, neighborMask };
}

// popcount of a 32-bit int
function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function step(state: number, geo: Geometry): number {
  const { cells, neighborMask } = geo;
  let next = 0;
  for (let i = 0; i < cells; i++) {
    const n = popcount(state & neighborMask[i]);
    const alive = (state >>> i) & 1;
    if (n === 3 || (n === 2 && alive)) {
      next |= 1 << i;
    }
  }
  return next;
}

// ── Classification of a single starting state ─────────────────────────────
//
// Returns { period, dies }. period is the cycle length; `dies` is true when the
// eventual cycle is the all-dead state (period 1 on state 0). A short Map keyed
// by state → step index detects the first repeat.

const seen = new Map<number, number>();

function classify(start: number, geo: Geometry): { period: number; dies: boolean } {
  seen.clear();
  let state = start;
  let gen = 0;
  // Cap: a W×H grid has ≤2^cells states; loop must close well within that. Add
  // a generous safety cap so a logic bug can never spin forever.
  const cap = 1 << Math.min(geo.cells, 25);
  while (gen <= cap) {
    const prev = seen.get(state);
    if (prev !== undefined) {
      const period = gen - prev;
      // Determine whether the cycle contains only the dead state.
      // If the cycle is length 1 and the state is 0 → dies.
      const dies = period === 1 && state === 0;
      return { period, dies };
    }
    seen.set(state, gen);
    state = step(state, geo);
    gen++;
  }
  // Unreachable for bounded grids, but keep a defined result.
  return { period: 1, dies: state === 0 };
}

// ── Census over a range of states ─────────────────────────────────────────

const PROGRESS_INTERVAL = 100_000;

// Track, per outcome, an example configuration for the gallery. We keep the
// longest-period oscillators keyed by period.
interface OscExample {
  period: number;
  state: number;
  population: number;
}

function runCensus(
  req: CensusRequest,
  post: (msg: CensusWorkerMessage) => void,
) {
  const { w, h } = req;
  const geo = buildGeometry(w, h);
  const total = req.total; // 2^cells
  const startFrom = req.startFrom ?? 0;

  // Accumulators (may be seeded from a checkpoint for resumable runs).
  let dies = req.acc?.dies ?? 0;
  let stillLifes = req.acc?.stillLifes ?? 0;
  // period → count (period >= 2). Use a plain object serialisable to the main thread.
  const periods: Record<number, number> = { ...(req.acc?.periods ?? {}) };
  // period → best example (highest population as a tie-break).
  const oscExamples = new Map<number, OscExample>();
  if (req.acc?.oscExamples) {
    for (const ex of req.acc.oscExamples) oscExamples.set(ex.period, ex);
  }
  const stillLifeExamples: number[] = [...(req.acc?.stillLifeExamples ?? [])];

  let processed = startFrom;
  let sinceProgress = 0;
  const t0 = performance.now();

  const buildResult = (done: boolean): CensusResult => ({
    w,
    h,
    total,
    processed,
    dies,
    stillLifes,
    periods: { ...periods },
    oscExamples: [...oscExamples.values()].sort((a, b) => b.period - a.period),
    stillLifeExamples: stillLifeExamples.slice(0, 12),
    done,
    elapsedMs: performance.now() - t0 + (req.acc?.elapsedMs ?? 0),
  });

  for (let s = startFrom; s < total; s++) {
    const { period, dies: isDead } = classify(s, geo);
    if (isDead) {
      dies++;
    } else if (period === 1) {
      stillLifes++;
      if (stillLifeExamples.length < 12) stillLifeExamples.push(s);
    } else {
      periods[period] = (periods[period] ?? 0) + 1;
      const pop = popcount(s);
      const existing = oscExamples.get(period);
      if (!existing || pop > existing.population) {
        oscExamples.set(period, { period, state: s, population: pop });
      }
    }

    processed = s + 1;
    sinceProgress++;

    if (sinceProgress >= PROGRESS_INTERVAL) {
      sinceProgress = 0;
      post({ type: 'progress', result: buildResult(false) });
      // Yield check: the main thread can pause us between chunks via `chunk`.
      if (req.chunkSize && processed - startFrom >= req.chunkSize) {
        // Emit a checkpoint and stop; the caller will re-dispatch to continue.
        post({ type: 'checkpoint', result: buildResult(false) });
        return;
      }
    }
  }

  post({ type: 'done', result: buildResult(true) });
}

self.onmessage = (e: MessageEvent<CensusRequest>) => {
  const req = e.data;
  runCensus(req, (msg) => (self as unknown as Worker).postMessage(msg));
};
