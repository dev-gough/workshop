// Shared message/data types for the Game of Life census worker.
//
// A census enumerates every starting configuration of a W×H bounded grid and
// classifies each as dies / still life / oscillator(period N). Large sizes
// (e.g. 5×5, 2^25 states) run in resumable chunks; `acc` carries the partial
// accumulators back into a follow-up request so a run can be paused/resumed or
// checkpointed to localStorage across page loads.

export interface OscExample {
  period: number;
  state: number;      // packed bitboard (bit y*w + x)
  population: number;
}

/** Serialisable partial/complete result for one grid size. */
export interface CensusResult {
  w: number;
  h: number;
  total: number;               // 2^(w*h)
  processed: number;           // states classified so far
  dies: number;
  stillLifes: number;
  periods: Record<number, number>; // period(>=2) → count
  oscExamples: OscExample[];   // best example per period, period-desc
  stillLifeExamples: number[]; // packed still-life states (up to 12)
  done: boolean;
  elapsedMs: number;
}

/** Accumulator snapshot handed back to the worker to resume a chunked run. */
export interface CensusAcc {
  dies: number;
  stillLifes: number;
  periods: Record<number, number>;
  oscExamples: OscExample[];
  stillLifeExamples: number[];
  elapsedMs: number;
}

export interface CensusRequest {
  w: number;
  h: number;
  total: number;        // 2^(w*h)
  startFrom?: number;   // resume from this state index (default 0)
  chunkSize?: number;   // if set, stop & checkpoint after this many states
  acc?: CensusAcc;      // partial accumulators to resume from
}

export type CensusWorkerMessage =
  | { type: 'progress'; result: CensusResult }
  | { type: 'checkpoint'; result: CensusResult }
  | { type: 'done'; result: CensusResult };
