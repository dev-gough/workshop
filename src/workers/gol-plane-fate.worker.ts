/// <reference lib="webworker" />
//
// Plane-fate executor. Receives a census state (w, h, index), classifies its
// fate on the infinite plane (gol-plane-fate.ts), posts the verdict back.
// One shared instance serves the gallery, fed sequentially by
// src/lib/plane-fate-client.ts — each seed is milliseconds except the rare
// methuselah, so a queue on a single worker is plenty.

import { planeFateOfState } from './gol-plane-fate';
import type { PlaneFateRequest, PlaneFateResponse } from './gol-plane-fate-shared';

self.onmessage = (e: MessageEvent<PlaneFateRequest>) => {
  const { id, w, h, state } = e.data;
  const fate = planeFateOfState(w, h, state);
  const msg: PlaneFateResponse = { id, fate };
  (self as unknown as Worker).postMessage(msg);
};
