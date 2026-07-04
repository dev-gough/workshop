// Client for the plane-fate worker: a module-level cache + one lazy shared
// worker, exposed as a React hook for the census oscillator gallery.
//
// Results are memoized per (w, h, state) for the life of the page — fates are
// deterministic, and the gallery re-renders every animation frame-step, so
// the hook must be cheap and stable after the first resolution.

import { useEffect, useState } from 'react';
import type { PlaneFate, PlaneFateRequest, PlaneFateResponse } from '@/workers/gol-plane-fate-shared';

export type { PlaneFate };

const cache = new Map<string, PlaneFate>();
const waiters = new Map<number, (fate: PlaneFate | null) => void>();
let worker: Worker | null = null;
let nextId = 1;

function keyOf(w: number, h: number, state: number): string {
  return `${w}x${h}:${state}`;
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/gol-plane-fate.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<PlaneFateResponse>) => {
      const resolve = waiters.get(e.data.id);
      if (resolve) {
        waiters.delete(e.data.id);
        resolve(e.data.fate);
      }
    };
    worker.onerror = () => {
      // Broken worker: fail every waiter (hooks just show no badge) and let
      // the next request spawn a fresh one.
      for (const resolve of waiters.values()) resolve(null);
      waiters.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export function getPlaneFate(w: number, h: number, state: number): Promise<PlaneFate | null> {
  const key = keyOf(w, h, state);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise(resolve => {
    const id = nextId++;
    waiters.set(id, fate => {
      if (fate) cache.set(key, fate);
      resolve(fate);
    });
    const req: PlaneFateRequest = { id, w, h, state };
    ensureWorker().postMessage(req);
  });
}

/** Fate of a census state on the infinite plane; null while computing. */
export function usePlaneFate(w: number, h: number, state: number): PlaneFate | null {
  const [fate, setFate] = useState<PlaneFate | null>(() => cache.get(keyOf(w, h, state)) ?? null);

  useEffect(() => {
    const cached = cache.get(keyOf(w, h, state));
    if (cached) {
      setFate(cached);
      return;
    }
    let alive = true;
    setFate(null);
    getPlaneFate(w, h, state).then(f => {
      if (alive && f) setFate(f);
    });
    return () => { alive = false; };
  }, [w, h, state]);

  return fate;
}
