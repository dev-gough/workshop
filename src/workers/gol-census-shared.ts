// Shared message/data types for the Game of Life census workers.
//
// A census enumerates every starting configuration of an N×N bounded grid and
// classifies each as dies / still life / oscillator(period p). The engine
// lives in gol-census-core.ts; workers are thin chunk executors driven by the
// CensusPool coordinator (src/lib/census-pool.ts), which fans chunks out to
// one worker per core and checkpoints the merged prefix to localStorage.

import type { ChunkAcc, OscExample } from './gol-census-core';

export type { ChunkAcc, OscExample };

/** Serialisable partial/complete result for one grid size. */
export interface CensusResult {
  w: number;
  h: number;
  total: number;               // 2^(w*h) — exact float64 up to 7×7
  processed: number;           // contiguous prefix of the index space covered
  dies: number;
  stillLifes: number;
  unresolved: number;          // safety-cap trips (expected 0)
  periods: Record<number, number>; // period(>=2) → count
  oscExamples: OscExample[];   // best example per period, period-desc
  stillLifeExamples: number[]; // distinct still-life states (up to 12)
  done: boolean;
  elapsedMs: number;
}

/** Ask a worker to census the index slice [start, end) of an n×n board. */
export interface CensusChunkRequest {
  n: number;
  chunkId: number;
  start: number;
  end: number;
}

export interface CensusChunkResponse {
  n: number;
  chunkId: number;
  start: number;
  end: number;
  acc: ChunkAcc;
  ms: number;                  // worker-side compute time for this chunk
}
