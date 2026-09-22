/// <reference lib="webworker" />

import {
  IMAGE_SIZE,
  evaluationSize,
  normalizedRgbError,
  resizeRgbaNearest,
  type Candidate,
  type EvolutionQuality,
  type Polygon,
} from '../app/projects/image-evolver/evolution';

// ── Image Evolver engine — Web Worker edition ─────────────────────────────
//
// This mirrors the canvas-specific genetic-algorithm engine in
// `src/components/ImageEvolver.tsx`, sharing fitness helpers and constants. It
// runs off the main thread and uses an
// OffscreenCanvas for the fitness readbacks (`getImageData`), which is the
// speed cap on the main thread. The component keeps its own copy of the engine
// as a fallback for environments without OffscreenCanvas support.
//
// Protocol (main ⇄ worker):
//   → { type: 'start', targetData, quality, popSize, mutationRate, maxPolygons, seedPolygons? }
//   → { type: 'run' }                       resume stepping
//   → { type: 'pause' }                     stop stepping (engine kept alive)
//   → { type: 'reset' }                     rebuild population from current target
//   → { type: 'setParams', mutationRate?, maxPolygons?, popSize?, speed? }
//   ← { type: 'ready' }                     posted right after 'start' finishes init
//   ← { type: 'progress', generation, fitness, polyCount, bestPolygons }
//
// `fitness` is the raw engine fitness (0 = perfect, 1 = worst); the main thread
// converts it for display. `bestPolygons` is a plain array the main thread
// renders into its persistent best-canvas.

function randomPolygon(): Polygon {
  const cx = Math.random(), cy = Math.random();
  const verts: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    verts.push([cx + (Math.random() - 0.5) * 0.3, cy + (Math.random() - 0.5) * 0.3]);
  }
  return {
    vertices: verts,
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
    a: Math.random() * 0.5 + 0.1,
  };
}

function cloneCandidate(c: Candidate): Candidate {
  return {
    fitness: c.fitness,
    polygons: c.polygons.map(p => ({
      vertices: p.vertices.map(v => [v[0], v[1]] as [number, number]),
      r: p.r, g: p.g, b: p.b, a: p.a,
    })),
  };
}

function renderCandidate(
  ctx: OffscreenCanvasRenderingContext2D,
  c: Candidate,
  w: number, h: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const p of c.polygons) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath();
    ctx.moveTo(p.vertices[0][0] * w, p.vertices[0][1] * h);
    for (let i = 1; i < p.vertices.length; i++) {
      ctx.lineTo(p.vertices[i][0] * w, p.vertices[i][1] * h);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function computeFitness(
  ctx: OffscreenCanvasRenderingContext2D,
  candidate: Candidate,
  targetData: Uint8ClampedArray,
  w: number, h: number,
): number {
  renderCandidate(ctx, candidate, w, h);
  const candidateData = ctx.getImageData(0, 0, w, h).data;
  return normalizedRgbError(candidateData, targetData);
}

function gaussRand(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

class ImageEvolverEngine {
  population: Candidate[];
  best: Candidate;
  generation: number;
  fullTargetData: Uint8ClampedArray;
  targetData: Uint8ClampedArray;
  offscreen: OffscreenCanvasRenderingContext2D;
  popSize: number;
  mutationRate: number;
  maxPolygons: number;
  evaluationSize: number;
  quality: EvolutionQuality;

  constructor(
    targetData: Uint8ClampedArray,
    popSize: number,
    mutationRate: number,
    maxPolygons: number,
    quality: EvolutionQuality,
    seedPolygons?: Polygon[],
  ) {
    this.fullTargetData = targetData;
    this.quality = quality;
    this.evaluationSize = evaluationSize(quality);
    this.targetData = resizeRgbaNearest(
      targetData, IMAGE_SIZE, IMAGE_SIZE, this.evaluationSize, this.evaluationSize,
    );
    this.popSize = popSize;
    this.mutationRate = mutationRate;
    this.maxPolygons = maxPolygons;
    this.generation = 0;

    const offCanvas = new OffscreenCanvas(this.evaluationSize, this.evaluationSize);
    this.offscreen = offCanvas.getContext('2d', { willReadFrequently: true })!;

    this.population = [];
    for (let i = 0; i < popSize; i++) {
      const c: Candidate = { polygons: [], fitness: 1 };
      const nPolys = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < nPolys; j++) c.polygons.push(randomPolygon());
      c.fitness = computeFitness(
        this.offscreen, c, this.targetData, this.evaluationSize, this.evaluationSize,
      );
      this.population.push(c);
    }

    // If we were handed persisted polygons, seed one candidate from them so a
    // page refresh doesn't lose progress.
    if (seedPolygons && seedPolygons.length > 0) {
      const seeded: Candidate = { polygons: seedPolygons.map(p => ({
        vertices: p.vertices.map(v => [v[0], v[1]] as [number, number]),
        r: p.r, g: p.g, b: p.b, a: p.a,
      })), fitness: 1 };
      seeded.fitness = computeFitness(
        this.offscreen, seeded, this.targetData, this.evaluationSize, this.evaluationSize,
      );
      this.population[0] = seeded;
    }

    this.population.sort((a, b) => a.fitness - b.fitness);
    this.best = cloneCandidate(this.population[0]);
  }

  setPopSize(n: number) {
    if (n === this.popSize) return;
    if (n > this.population.length) {
      while (this.population.length < n) {
        const src = this.population[Math.floor(Math.random() * this.population.length)];
        this.population.push(cloneCandidate(src));
      }
    } else if (n < this.population.length) {
      this.population.sort((a, b) => a.fitness - b.fitness);
      this.population.length = n;
    }
    this.popSize = n;
  }

  tournamentSelect(k: number = 3): Candidate {
    let best: Candidate | null = null;
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      if (!best || this.population[idx].fitness < best.fitness) {
        best = this.population[idx];
      }
    }
    return best!;
  }

  crossover(a: Candidate, b: Candidate): Candidate {
    const aPolys = a.polygons;
    const bPolys = b.polygons;
    const maxLen = Math.max(aPolys.length, bPolys.length);
    const child: Polygon[] = [];
    for (let i = 0; i < maxLen; i++) {
      if (i < aPolys.length && i < bPolys.length) {
        child.push(Math.random() < 0.5 ? { ...aPolys[i], vertices: aPolys[i].vertices.map(v => [...v] as [number, number]) } : { ...bPolys[i], vertices: bPolys[i].vertices.map(v => [...v] as [number, number]) });
      } else if (i < aPolys.length) {
        if (Math.random() < 0.5) child.push({ ...aPolys[i], vertices: aPolys[i].vertices.map(v => [...v] as [number, number]) });
      } else {
        if (Math.random() < 0.5) child.push({ ...bPolys[i], vertices: bPolys[i].vertices.map(v => [...v] as [number, number]) });
      }
    }
    if (child.length === 0) child.push(randomPolygon());
    return { polygons: child, fitness: 1 };
  }

  mutate(c: Candidate) {
    const rate = this.mutationRate;

    for (const p of c.polygons) {
      for (const v of p.vertices) {
        if (Math.random() < rate) v[0] = clamp(v[0] + gaussRand() * 0.05, 0, 1);
        if (Math.random() < rate) v[1] = clamp(v[1] + gaussRand() * 0.05, 0, 1);
      }
      if (Math.random() < rate) p.r = clamp(Math.round(p.r + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.g = clamp(Math.round(p.g + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.b = clamp(Math.round(p.b + gaussRand() * 20), 0, 255);
      if (Math.random() < rate) p.a = clamp(p.a + gaussRand() * 0.1, 0.05, 0.95);
    }

    if (Math.random() < rate * 0.5 && c.polygons.length < this.maxPolygons) {
      c.polygons.push(randomPolygon());
    }
    if (Math.random() < rate * 0.3 && c.polygons.length > 1) {
      c.polygons.splice(Math.floor(Math.random() * c.polygons.length), 1);
    }
    if (Math.random() < rate * 0.2 && c.polygons.length > 1) {
      const i = Math.floor(Math.random() * c.polygons.length);
      const j = Math.floor(Math.random() * c.polygons.length);
      [c.polygons[i], c.polygons[j]] = [c.polygons[j], c.polygons[i]];
    }
  }

  step() {
    const eliteCount = Math.max(2, Math.floor(this.popSize * 0.1));
    this.population.sort((a, b) => a.fitness - b.fitness);

    const next: Candidate[] = [];
    for (let i = 0; i < eliteCount; i++) {
      next.push(cloneCandidate(this.population[i]));
    }
    while (next.length < this.popSize) {
      const a = this.tournamentSelect();
      const b = this.tournamentSelect();
      const child = this.crossover(a, b);
      this.mutate(child);
      child.fitness = computeFitness(
        this.offscreen, child, this.targetData, this.evaluationSize, this.evaluationSize,
      );
      next.push(child);
    }

    this.population = next;
    this.population.sort((a, b) => a.fitness - b.fitness);
    if (this.population[0].fitness < this.best.fitness) {
      this.best = cloneCandidate(this.population[0]);
    }
    this.generation++;
  }
}

// ── Message plumbing ──────────────────────────────────────────────────────

type InMessage =
  | { type: 'start'; targetData: Uint8ClampedArray; popSize: number; mutationRate: number; maxPolygons: number; quality: EvolutionQuality; speed: number; seedPolygons?: Polygon[] }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'setParams'; mutationRate?: number; maxPolygons?: number; popSize?: number; speed?: number };

let engine: ImageEvolverEngine | null = null;
let running = false;
let speed = 10;           // generations per second (target)
let timer: ReturnType<typeof setTimeout> | null = null;

const PROGRESS_INTERVAL = 100; // ~10 posts/sec
let lastProgressPost = 0;

function postProgress(force = false) {
  if (!engine) return;
  const now = Date.now();
  if (!force && now - lastProgressPost < PROGRESS_INTERVAL) return;
  lastProgressPost = now;
  self.postMessage({
    type: 'progress',
    generation: engine.generation,
    fitness: engine.best.fitness,
    polyCount: engine.best.polygons.length,
    bestPolygons: engine.best.polygons,
  });
}

function scheduleTick() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (!running || !engine) return;
  // Run generations at roughly `speed` per second. A short scheduling slice
  // (~16ms) keeps param/pause messages responsive; batch steps within it.
  const interval = 1000 / speed;
  const slice = Math.max(interval, 16);
  const start = Date.now();
  const deadline = start + slice;
  let steps = 0;
  do {
    engine.step();
    steps++;
  } while (Date.now() < deadline && steps < 500);
  postProgress();
  // Wait for the remainder of the intended wall-clock budget for these steps.
  const targetElapsed = steps * interval;
  const actualElapsed = Date.now() - start;
  const wait = Math.max(0, targetElapsed - actualElapsed);
  timer = setTimeout(scheduleTick, wait);
}

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'start': {
      engine = new ImageEvolverEngine(
        msg.targetData, msg.popSize, msg.mutationRate, msg.maxPolygons, msg.quality,
        msg.seedPolygons,
      );
      speed = msg.speed;
      running = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      self.postMessage({ type: 'ready' });
      postProgress(true);
      break;
    }
    case 'run': {
      if (!engine) break;
      running = true;
      scheduleTick();
      break;
    }
    case 'pause': {
      running = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      postProgress(true);
      break;
    }
    case 'reset': {
      if (!engine) break;
      running = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      engine = new ImageEvolverEngine(
        engine.fullTargetData,
        engine.popSize,
        engine.mutationRate,
        engine.maxPolygons,
        engine.quality,
      );
      postProgress(true);
      break;
    }
    case 'setParams': {
      if (!engine) break;
      if (msg.mutationRate !== undefined) engine.mutationRate = msg.mutationRate;
      if (msg.maxPolygons !== undefined) engine.maxPolygons = msg.maxPolygons;
      if (msg.popSize !== undefined) engine.setPopSize(msg.popSize);
      if (msg.speed !== undefined) speed = msg.speed;
      break;
    }
  }
};

export {};
