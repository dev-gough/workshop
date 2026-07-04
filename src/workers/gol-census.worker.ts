/// <reference lib="webworker" />
//
// Census chunk executor. Stateless per message: receives an index slice of an
// N×N board's state space, runs the optimized core engine over it (D4
// symmetry pruning + bit-parallel stepping + Brent cycle detection), and
// posts the accumulated counts back. The CensusPool coordinator merges chunks
// and owns progress/checkpointing; one of these workers runs per CPU core.

import { createCensusEngine, type CensusEngine } from './gol-census-core';
import type { CensusChunkRequest, CensusChunkResponse } from './gol-census-shared';

const engines = new Map<number, CensusEngine>();

self.onmessage = (e: MessageEvent<CensusChunkRequest>) => {
  const { n, chunkId, start, end } = e.data;
  let engine = engines.get(n);
  if (!engine) {
    engine = createCensusEngine(n);
    engines.set(n, engine);
  }
  const t0 = performance.now();
  const acc = engine.runChunk(start, end);
  const msg: CensusChunkResponse = {
    n, chunkId, start, end, acc,
    ms: performance.now() - t0,
  };
  (self as unknown as Worker).postMessage(msg);
};
