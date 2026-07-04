/// <reference lib="webworker" />
//
// Census chunk executor. Stateless per message: receives an index slice of a
// W×H board's state space, runs the optimized core engine over it (symmetry
// pruning + bit-parallel stepping + Brent cycle detection), and posts the
// accumulated counts back. The CensusPool coordinator merges chunks and owns
// progress/checkpointing; one of these workers runs per CPU core.

import { createCensusEngine, type CensusEngine } from './gol-census-core';
import type { CensusChunkRequest, CensusChunkResponse } from './gol-census-shared';

const engines = new Map<string, CensusEngine>();

self.onmessage = (e: MessageEvent<CensusChunkRequest>) => {
  const { w, h, start, end } = e.data;
  const key = `${w}x${h}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = createCensusEngine(w, h);
    engines.set(key, engine);
  }
  const t0 = performance.now();
  const acc = engine.runChunk(start, end);
  const msg: CensusChunkResponse = {
    w, h, start, end, acc,
    ms: performance.now() - t0,
  };
  (self as unknown as Worker).postMessage(msg);
};
