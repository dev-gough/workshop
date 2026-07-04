// CensusPool — multi-core coordinator for deep Game of Life census runs.
//
// Spawns one worker per available core and hands out block-aligned index
// ranges from a shared cursor (work stealing: a worker gets its next range
// the moment it finishes one). Results can arrive out of order; they're
// staged in `pending` and merged strictly in index order, so the persisted
// `processed` value is always a CONTIGUOUS prefix of the state space — a
// checkpoint can resume from it with nothing lost and nothing double-counted.
// Pausing discards at most the in-flight ranges (seconds of work).
//
// Chunk sizes are ADAPTIVE. D4 symmetry pruning concentrates simulation work
// where orbit minima live and lets whole 2^n blocks in the remaining stripes
// skip in O(1) — measured cost per index swings ~1000× across the space
// (scripts/census-verify.ts + chunk probing). Each completed chunk's wall
// time steers the next dispatch: fast chunks double the size, slow ones
// halve it, within [2^20, 2^25]. This keeps checkpoints landing every few
// seconds in the dense-work stripes without drowning the skip stripes in
// message overhead.
//
// Progress reporting note: `processed` (index cursor) is nearly meaningless
// as a progress measure because of that skew — the UI should report
// dies+stills+oscillators (+unresolved), i.e. states *classified*, which
// grows in proportion to work done and reaches `total` exactly at the end.

import { mergeAcc, type ChunkAcc } from '@/workers/gol-census-core';
import type {
  CensusChunkRequest,
  CensusChunkResponse,
  CensusResult,
} from '@/workers/gol-census-shared';

const CHUNK_MIN = 1 << 20;        // 1M indices — always a multiple of 2^n blocks
const CHUNK_MAX = 1 << 25;       // 33.5M — bounds pause latency in dense stripes
const GROW_BELOW_MS = 400;
const SHRINK_ABOVE_MS = 2500;

export function freshResult(n: number): CensusResult {
  return {
    w: n,
    h: n,
    total: Math.pow(2, n * n),
    processed: 0,
    dies: 0,
    stillLifes: 0,
    unresolved: 0,
    periods: {},
    oscExamples: [],
    stillLifeExamples: [],
    done: false,
    elapsedMs: 0,
  };
}

export function poolWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  return Math.max(1, cores - 1); // leave a core for the UI thread
}

export interface CensusPoolCallbacks {
  /** Fired after each contiguous merge — result is a live snapshot. */
  onUpdate: (result: CensusResult) => void;
  onDone: (result: CensusResult) => void;
}

export class CensusPool {
  readonly n: number;
  readonly workerCount: number;
  private readonly result: CensusResult;
  private readonly pending = new Map<number, { end: number; acc: ChunkAcc }>(); // keyed by range start
  private workers: Worker[] = [];
  private cursor: number;       // next index to hand out
  private contiguous: number;   // everything below this is merged + durable
  private chunkSize = CHUNK_MIN;
  private lastWall = 0;
  private stopped = false;

  constructor(n: number, resume: CensusResult | null, private cb: CensusPoolCallbacks) {
    this.n = n;
    this.workerCount = poolWorkerCount();

    if (resume && !resume.done && resume.processed > 0) {
      // `processed` is always a sum of CHUNK_MIN-aligned ranges → block-aligned.
      this.contiguous = resume.processed;
      this.result = { ...resume };
    } else {
      this.contiguous = 0;
      this.result = freshResult(n);
    }
    this.cursor = this.contiguous;
  }

  start(): void {
    if (this.workers.length || this.stopped) return;
    this.lastWall = performance.now();
    for (let i = 0; i < this.workerCount; i++) {
      if (this.cursor >= this.result.total) break;
      const w = new Worker(new URL('../workers/gol-census.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<CensusChunkResponse>) => this.onChunk(w, e.data);
      this.workers.push(w);
      this.dispatch(w);
    }
  }

  /** Terminate workers and return the last consistent checkpoint. */
  stop(): CensusResult {
    this.stopped = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
    this.tickClock();
    return this.snapshot();
  }

  private tickClock(): void {
    if (this.lastWall > 0) {
      const now = performance.now();
      this.result.elapsedMs += now - this.lastWall;
      this.lastWall = now;
    }
  }

  private dispatch(w: Worker): void {
    if (this.stopped || this.cursor >= this.result.total) return;
    const start = this.cursor;
    const end = Math.min(start + this.chunkSize, this.result.total);
    this.cursor = end;
    const req: CensusChunkRequest = { n: this.n, chunkId: start, start, end };
    w.postMessage(req);
  }

  private onChunk(w: Worker, resp: CensusChunkResponse): void {
    if (this.stopped) return;

    // Steer chunk size toward ~1-2s of work (bounded both ways).
    if (resp.ms < GROW_BELOW_MS && this.chunkSize < CHUNK_MAX) this.chunkSize *= 2;
    else if (resp.ms > SHRINK_ABOVE_MS && this.chunkSize > CHUNK_MIN) this.chunkSize /= 2;

    this.pending.set(resp.start, { end: resp.end, acc: resp.acc });

    // Merge every range that extends the contiguous prefix.
    let merged = false;
    while (this.pending.has(this.contiguous)) {
      const { end, acc } = this.pending.get(this.contiguous)!;
      this.pending.delete(this.contiguous);
      this.mergeChunk(acc);
      this.contiguous = end;
      merged = true;
    }
    if (merged) {
      this.result.processed = this.contiguous;
      this.tickClock();
    }

    if (this.contiguous >= this.result.total) {
      this.result.done = true;
      this.stopped = true;
      for (const worker of this.workers) worker.terminate();
      this.workers = [];
      this.cb.onDone(this.snapshot());
      return;
    }

    this.dispatch(w);
    if (merged) this.cb.onUpdate(this.snapshot());
  }

  private mergeChunk(acc: ChunkAcc): void {
    const r = this.result;
    const into = {
      dies: r.dies,
      stillLifes: r.stillLifes,
      unresolved: r.unresolved,
      periods: r.periods,
      oscExamples: r.oscExamples,
      stillLifeExamples: r.stillLifeExamples,
    };
    mergeAcc(into, acc);
    r.dies = into.dies;
    r.stillLifes = into.stillLifes;
    r.unresolved = into.unresolved;
    r.periods = into.periods;
    r.oscExamples = into.oscExamples;
    r.stillLifeExamples = into.stillLifeExamples;
  }

  private snapshot(): CensusResult {
    return {
      ...this.result,
      periods: { ...this.result.periods },
      oscExamples: [...this.result.oscExamples],
      stillLifeExamples: [...this.result.stillLifeExamples],
    };
  }
}
