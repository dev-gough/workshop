// Message types for the plane-fate worker.

import type { PlaneFate } from './gol-plane-fate';

export type { PlaneFate };

export interface PlaneFateRequest {
  id: number;
  w: number;
  h: number;
  state: number;  // census index (exact float64, ≤ 2^49)
}

export interface PlaneFateResponse {
  id: number;
  fate: PlaneFate;
}
