// RM 13 — Driving School. The whole sim, as a pure module: a seeded circuit,
// a grid of cars each driven by a tiny neural network, and a genetic algorithm
// that breeds the next heat from the last one's timing sheet.
//
// Nothing in here touches React or the DOM. The page owns one animation loop;
// it calls session.step() and reads state back out. Every random draw comes
// from a seeded PRNG, so a session is reproducible dial-for-dial.

// ── Seeded randomness ────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ── Parameters ───────────────────────────────────────────────────────────

export interface DriveParams {
  /** Seeds the founding genomes and every runtime draw. Regrid to apply. */
  seed: number;
  circuit: {
    seed: number;      // which circuit gets drawn
    corners: number;   // control points on the loop
    radius: number;    // mean radius, world units
    wobble: number;    // how far corners stray from the mean
    width: number;     // track half-width
  };
  car: {
    topSpeed: number;  // hard speed ceiling, units/tick
    accel: number;     // throttle authority per tick
    grip: number;      // steering lock, radians/tick at full deflection
    drag: number;      // fraction of speed shed each tick
  };
  sensors: {
    count: number;     // rangefinders across the fan — resizes the genome
    spread: number;    // fan width, degrees
    range: number;     // rangefinder reach, world units
    noise: number;     // gaussian sigma added to each reading
  };
  brain: {
    hidden: number;    // hidden neurons — resizes the genome
    initSpread: number; // stddev of founding weights
  };
  evolution: {
    popSize: number;     // cars per heat (applies at the next heat)
    eliteFrac: number;   // top fraction copied through untouched
    tourneyK: number;    // tournament size; 1 = selection off
    crossover: boolean;  // uniform crossover vs clone-one-parent
    mutRate: number;     // chance each weight is perturbed
    mutStrength: number; // sigma of the perturbation
    immigrants: number;  // fraction of each heat drawn fresh at random
    rotateEvery: number; // swap in a new circuit every N heats; 0 = never
  };
  session: {
    tickBudget: number;  // ticks before a heat is flagged off
    patience: number;    // ticks without progress before a car is retired
  };
}

export function defaultParams(): DriveParams {
  return {
    seed: 27,
    circuit: { seed: 4, corners: 9, radius: 175, wobble: 0.45, width: 34 },
    car: { topSpeed: 4, accel: 0.15, grip: 0.08, drag: 0.02 },
    sensors: { count: 7, spread: 126, range: 200, noise: 0 },
    brain: { hidden: 8, initSpread: 1.0 },
    evolution: {
      popSize: 60,
      eliteFrac: 0.1,
      tourneyK: 3,
      crossover: true,
      mutRate: 0.15,
      mutStrength: 0.4,
      immigrants: 0.02,
      rotateEvery: 0,
    },
    session: { tickBudget: 1800, patience: 120 },
  };
}

/** Dials that seed the session rather than steer it — they land on regrid. */
export const REGRID_KEYS = new Set([
  'seed',
  'circuit.seed', 'circuit.corners', 'circuit.radius', 'circuit.wobble', 'circuit.width',
  'sensors.count',
  'brain.hidden', 'brain.initSpread',
]);

function pickStaged(p: DriveParams) {
  return {
    seed: p.seed,
    circuit: p.circuit,
    sensorCount: p.sensors.count,
    brain: p.brain,
  };
}

export function needsRegrid(built: DriveParams, next: DriveParams): boolean {
  return JSON.stringify(pickStaged(built)) !== JSON.stringify(pickStaged(next));
}

// ── The circuit ──────────────────────────────────────────────────────────

export interface Point { x: number; y: number; }
type Segment = [number, number, number, number];

export interface Track {
  centerline: Point[];
  innerPts: Point[];
  outerPts: Point[];
  innerWalls: Segment[];
  outerWalls: Segment[];
  /** Per centerline point: 1 = kerb on the inner wall, -1 = outer, 0 = none. */
  kerb: Int8Array;
  startPos: Point;
  startHeading: number;
  width: number;
  /** Mean distance between centerline points — progress index → metres. */
  stepLen: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function generateTrack(c: DriveParams['circuit']): Track {
  const rng = mulberry32(c.seed * 2654435761);
  const n = Math.round(c.corners);
  const controlPoints: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    // Wobble scatters both the corner radius and its bearing.
    const radius = c.radius * (1 + (rng() - 0.5) * c.wobble * 1.2);
    controlPoints.push({
      x: Math.cos(angle) * radius + (rng() - 0.5) * c.radius * c.wobble * 0.5,
      y: Math.sin(angle) * radius + (rng() - 0.5) * c.radius * c.wobble * 0.5,
    });
  }

  const centerline: Point[] = [];
  const steps = 30;
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    for (let j = 0; j < steps; j++) {
      centerline.push(catmullRom(p0, p1, p2, p3, j / steps));
    }
  }

  const N = centerline.length;
  const innerPts: Point[] = [];
  const outerPts: Point[] = [];
  for (let i = 0; i < N; i++) {
    const next = centerline[(i + 1) % N];
    const dx = next.x - centerline[i].x;
    const dy = next.y - centerline[i].y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    innerPts.push({ x: centerline[i].x + nx * c.width, y: centerline[i].y + ny * c.width });
    outerPts.push({ x: centerline[i].x - nx * c.width, y: centerline[i].y - ny * c.width });
  }

  const innerWalls: Segment[] = [];
  const outerWalls: Segment[] = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    innerWalls.push([innerPts[i].x, innerPts[i].y, innerPts[j].x, innerPts[j].y]);
    outerWalls.push([outerPts[i].x, outerPts[i].y, outerPts[j].x, outerPts[j].y]);
  }

  // Kerbs mark real corners: where the tangent swings hard, paint the concave
  // side. Signed curvature over a small window keeps it from flickering.
  const kerb = new Int8Array(N);
  const win = 6;
  for (let i = 0; i < N; i++) {
    const a = centerline[(i - win + N) % N];
    const b = centerline[i];
    const d = centerline[(i + win) % N];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(d.y - b.y, d.x - b.x);
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > 0.22) {
      // Inner points sit on the left of travel; a left turn's concave side is left.
      kerb[i] = dh > 0 ? -1 : 1;
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outerPts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }

  let per = 0;
  for (let i = 0; i < N; i++) {
    const q = centerline[(i + 1) % N];
    per += Math.hypot(q.x - centerline[i].x, q.y - centerline[i].y);
  }

  return {
    centerline, innerPts, outerPts, innerWalls, outerWalls, kerb,
    startPos: { ...centerline[0] },
    startHeading: Math.atan2(centerline[1].y - centerline[0].y, centerline[1].x - centerline[0].x),
    width: c.width,
    stepLen: per / N,
    bounds: { minX, minY, maxX, maxY },
  };
}

// ── Raycasting against a wall grid ───────────────────────────────────────

function raySegmentIntersect(
  ox: number, oy: number, dx: number, dy: number,
  x1: number, y1: number, x2: number, y2: number,
): number {
  const sx = x2 - x1, sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-10) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return Infinity;
}

const GRID_CELL = 60;

export interface WallGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  bins: number[][];
  walls: Segment[];
}

export function buildWallGrid(walls: Segment[], cell: number = GRID_CELL): WallGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of walls) {
    if (x1 < minX) minX = x1; if (x2 < minX) minX = x2;
    if (y1 < minY) minY = y1; if (y2 < minY) minY = y2;
    if (x1 > maxX) maxX = x1; if (x2 > maxX) maxX = x2;
    if (y1 > maxY) maxY = y1; if (y2 > maxY) maxY = y2;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const bins: number[][] = new Array(cols * rows);

  const push = (cx: number, cy: number, idx: number) => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const key = cy * cols + cx;
    (bins[key] ??= []).push(idx);
  };

  // Segments are short (~one track step), so a 1-cell-margin bbox fill is
  // exact enough and cheap.
  for (let s = 0; s < walls.length; s++) {
    const [x1, y1, x2, y2] = walls[s];
    const cx1 = Math.floor((Math.min(x1, x2) - minX) / cell) - 1;
    const cy1 = Math.floor((Math.min(y1, y2) - minY) / cell) - 1;
    const cx2 = Math.floor((Math.max(x1, x2) - minX) / cell) + 1;
    const cy2 = Math.floor((Math.max(y1, y2) - minY) / cell) + 1;
    for (let cy = cy1; cy <= cy2; cy++) {
      for (let cx = cx1; cx <= cx2; cx++) push(cx, cy, s);
    }
  }

  return { cell, minX, minY, cols, rows, bins, walls };
}

/** DDA walk along the ray, testing only segments binned in the cells it crosses. */
function castRayGrid(ox: number, oy: number, angle: number, grid: WallGrid, maxDist: number): number {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const { cell, minX, minY, cols, rows, bins, walls } = grid;

  let cx = Math.floor((ox - minX) / cell);
  let cy = Math.floor((oy - minY) / cell);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(cell / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(cell / dy) : Infinity;

  const nextBoundX = minX + (dx > 0 ? (cx + 1) * cell : cx * cell);
  const nextBoundY = minY + (dy > 0 ? (cy + 1) * cell : cy * cell);
  let tMaxX = dx !== 0 ? (nextBoundX - ox) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextBoundY - oy) / dy : Infinity;

  let minHit = Infinity;
  const seen = new Set<number>();

  while (true) {
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
      const bin = bins[cy * cols + cx];
      if (bin) {
        for (let k = 0; k < bin.length; k++) {
          const s = bin[k];
          if (seen.has(s)) continue;
          seen.add(s);
          const [x1, y1, x2, y2] = walls[s];
          const d = raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2);
          if (d < minHit) minHit = d;
        }
      }
    }
    const tNext = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (minHit <= tNext) break;
    if (tNext > maxDist) break;
    if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
    else { cy += stepY; tMaxY += tDeltaY; }
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) break;
  }

  return minHit;
}

/** Nearest wall to a point, over the local 3×3 cell neighbourhood. */
function nearestWallDist(px: number, py: number, grid: WallGrid): number {
  const { cell, minX, minY, cols, rows, bins, walls } = grid;
  const bx = Math.floor((px - minX) / cell);
  const by = Math.floor((py - minY) / cell);
  let minDist = Infinity;
  const seen = new Set<number>();
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = bx + ox, cy = by + oy;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const bin = bins[cy * cols + cx];
      if (!bin) continue;
      for (let k = 0; k < bin.length; k++) {
        const s = bin[k];
        if (seen.has(s)) continue;
        seen.add(s);
        const [x1, y1, x2, y2] = walls[s];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1;
        const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
        const qx = x1 + t * dx, qy = y1 + t * dy;
        const dd = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (dd < minDist) minDist = dd;
      }
    }
  }
  return Math.sqrt(minDist);
}

// ── The brain ────────────────────────────────────────────────────────────
// inputs (rangefinders + speed) → hidden (ReLU) → steer, throttle (tanh).
// The genome is the flattened weight matrices with biases, nothing else.

export interface BrainShape {
  inputs: number;   // sensors + 1 (speed)
  hidden: number;
  outputs: 2;
  size: number;     // total weights + biases
}

export function brainShape(p: DriveParams): BrainShape {
  const inputs = p.sensors.count + 1;
  const hidden = p.brain.hidden;
  return {
    inputs, hidden, outputs: 2,
    size: inputs * hidden + hidden + hidden * 2 + 2,
  };
}

export interface Thought {
  inputs: number[];
  hidden: number[];
  /** [steer, throttle], both in [-1, 1]. */
  out: [number, number];
}

function feedForward(genome: Float64Array, shape: BrainShape, inputs: number[], keep?: Thought): [number, number] {
  let idx = 0;
  const hidden: number[] = new Array(shape.hidden);
  for (let h = 0; h < shape.hidden; h++) {
    let sum = 0;
    for (let i = 0; i < shape.inputs; i++) sum += inputs[i] * genome[idx++];
    sum += genome[idx++];
    hidden[h] = sum > 0 ? sum : 0;
  }
  const out: [number, number] = [0, 0];
  for (let o = 0; o < 2; o++) {
    let sum = 0;
    for (let h = 0; h < shape.hidden; h++) sum += hidden[h] * genome[idx++];
    sum += genome[idx++];
    out[o] = Math.tanh(sum);
  }
  if (keep) {
    keep.inputs = inputs.slice();
    keep.hidden = hidden;
    keep.out = out;
  }
  return out;
}

// ── Cars ─────────────────────────────────────────────────────────────────

export const CAR_RADIUS = 6;

export type Retirement = 'wall' | 'stalled' | null;

export interface Car {
  id: number;
  x: number; y: number;
  heading: number;
  speed: number;
  alive: boolean;
  out: Retirement;
  /** Progress along the centerline, in points, accumulated across laps. */
  progress: number;
  genome: Float64Array;
  sensors: number[];
  steer: number;
  throttle: number;
  stuckTimer: number;
  lastProgress: number;
}

function createGenome(rng: () => number, size: number, spread: number): Float64Array {
  const g = new Float64Array(size);
  for (let i = 0; i < size; i++) g[i] = gauss(rng) * spread * 0.5;
  return g;
}

function createCar(id: number, track: Track, genome: Float64Array, sensorCount: number): Car {
  return {
    id,
    x: track.startPos.x,
    y: track.startPos.y,
    heading: track.startHeading,
    speed: 0,
    alive: true,
    out: null,
    progress: 0,
    genome,
    sensors: new Array(sensorCount).fill(1),
    steer: 0,
    throttle: 0,
    stuckTimer: 0,
    lastProgress: 0,
  };
}

// ── Session records ──────────────────────────────────────────────────────

export interface HeatRecord {
  gen: number;
  best: number;      // metres
  mean: number;      // metres
  diversity: number; // mean per-weight stddev across the grid
  ticks: number;
  crashed: number;   // retired into a wall
  stalled: number;   // retired for lack of progress
  record: boolean;   // beat every heat before it
  newCircuit: boolean; // this heat began on a fresh circuit
}

export const TELEMETRY_CAP = 512;

/** Rolling pit-wall traces for the leader: speed, throttle, steer per tick. */
export interface Telemetry {
  speed: Float32Array;    // 0..1 of top speed
  throttle: Float32Array; // -1..1
  steer: Float32Array;    // -1..1
  genParity: Uint8Array;  // flips when a new heat starts — draws the boundary
  head: number;           // next write slot
  filled: number;
}

const TRAIL_CAP = 260;

// ── The session ──────────────────────────────────────────────────────────

export class Session {
  params: DriveParams;
  track: Track;
  grid: WallGrid;
  cars: Car[] = [];
  shape: BrainShape;

  gen = 0;
  tick = 0;
  /** Best distance ever driven, metres — the lap record's big brother. */
  bestEver = 0;
  bestEverGen = 0;
  carriedGrid = false;

  history: HeatRecord[] = [];
  telemetry: Telemetry = {
    speed: new Float32Array(TELEMETRY_CAP),
    throttle: new Float32Array(TELEMETRY_CAP),
    steer: new Float32Array(TELEMETRY_CAP),
    genParity: new Uint8Array(TELEMETRY_CAP),
    head: 0,
    filled: 0,
  };
  /** Survival curve of the running heat: alive count sampled every 4 ticks. */
  attrition: number[] = [];
  /** Survival curves of recent finished heats, oldest first. */
  pastAttrition: { gen: number; curve: number[]; pop: number }[] = [];
  /** The leader's recent path, with speed, for the tarmac trail. */
  trail: { x: number; y: number; v: number }[] = [];

  private rng: () => number;
  private parity = 0;
  private pendingNewCircuit = false;

  constructor(params: DriveParams) {
    this.params = structuredClone(params);
    this.rng = mulberry32(this.params.seed * 747796405 + 1);
    this.shape = brainShape(this.params);
    this.track = generateTrack(this.params.circuit);
    this.grid = buildWallGrid([...this.track.innerWalls, ...this.track.outerWalls]);
    this.spawnGrid();
  }

  private spawnGrid(genomes?: Float64Array[]) {
    const p = this.params;
    const cars: Car[] = [];
    for (let i = 0; i < p.evolution.popSize; i++) {
      const genome = genomes && i < genomes.length
        ? genomes[i]
        : createGenome(this.rng, this.shape.size, p.brain.initSpread);
      cars.push(createCar(i, this.track, genome, p.sensors.count));
    }
    this.cars = cars;
    this.tick = 0;
    this.attrition = [];
    this.trail = [];
  }

  /** Swap in a fresh circuit and re-race the same grid on it. */
  newCircuit(seed?: number) {
    const p = this.params;
    p.circuit.seed = seed ?? (Math.floor(this.rng() * 100000) + 1);
    this.track = generateTrack(p.circuit);
    this.grid = buildWallGrid([...this.track.innerWalls, ...this.track.outerWalls]);
    const genomes = this.cars
      .slice()
      .sort((a, b) => b.progress - a.progress)
      .map(c => c.genome);
    this.spawnGrid(genomes);
    this.carriedGrid = true;
    this.pendingNewCircuit = true;
  }

  metres(progress: number): number {
    return progress * this.track.stepLen;
  }

  laps(car: Car): number {
    return car.progress / this.track.centerline.length;
  }

  find(id: number): Car | null {
    return this.cars.find(c => c.id === id) ?? null;
  }

  carAt(wx: number, wy: number, r: number): Car | null {
    let best: Car | null = null;
    let bestD = r * r;
    for (const c of this.cars) {
      const d = (c.x - wx) * (c.x - wx) + (c.y - wy) * (c.y - wy);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** The car the pit wall watches: best alive, else best of the heat. */
  champion(): Car | null {
    let bestAlive: Car | null = null;
    let bestAny: Car | null = null;
    for (const c of this.cars) {
      if (!bestAny || c.progress > bestAny.progress) bestAny = c;
      if (c.alive && (!bestAlive || c.progress > bestAlive.progress)) bestAlive = c;
    }
    return bestAlive ?? bestAny;
  }

  /** Timing order: alive first by distance, then the retired by distance. */
  standings(): Car[] {
    return this.cars.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.progress - a.progress;
    });
  }

  /** Re-run a car's brain on its latest readings, keeping the activations. */
  think(car: Car): Thought {
    const t: Thought = { inputs: [], hidden: [], out: [0, 0] };
    const p = this.params;
    feedForward(car.genome, this.shape, [...car.sensors, car.speed / p.car.topSpeed], t);
    return t;
  }

  aliveCount(): number {
    let n = 0;
    for (const c of this.cars) if (c.alive) n++;
    return n;
  }

  /** One tick. Advances every car; breeds the next heat when this one ends. */
  step() {
    const p = this.params;
    const alive = this.aliveCount();
    if (alive === 0 || this.tick >= p.session.tickBudget) {
      this.endHeat();
      return;
    }

    for (const car of this.cars) this.stepCar(car);
    this.tick++;

    if (this.tick % 4 === 0) this.attrition.push(this.aliveCount());

    // Pit-wall traces follow the leader.
    const champ = this.champion();
    if (champ) {
      const t = this.telemetry;
      t.speed[t.head] = champ.speed / p.car.topSpeed;
      t.throttle[t.head] = champ.throttle;
      t.steer[t.head] = champ.steer;
      t.genParity[t.head] = this.parity;
      t.head = (t.head + 1) % TELEMETRY_CAP;
      if (t.filled < TELEMETRY_CAP) t.filled++;

      if (champ.alive) {
        this.trail.push({ x: champ.x, y: champ.y, v: champ.speed / p.car.topSpeed });
        if (this.trail.length > TRAIL_CAP) this.trail.shift();
      }
    }
  }

  private stepCar(car: Car) {
    if (!car.alive) return;
    const p = this.params;
    const track = this.track;
    const grid = this.grid;

    // Rangefinders. The fan is symmetric about the heading; noise, if dialled
    // in, corrupts the reading — not the wall.
    const count = p.sensors.count;
    const spread = (p.sensors.spread * Math.PI) / 180;
    const range = p.sensors.range;
    let frontal = Infinity;
    for (let i = 0; i < count; i++) {
      const angle = count === 1
        ? car.heading
        : car.heading + (-spread / 2 + (spread / (count - 1)) * i);
      const d = castRayGrid(car.x, car.y, angle, grid, range);
      if (i === (count - 1) >> 1) frontal = d;
      let reading = clamp(d / range, 0, 1);
      if (p.sensors.noise > 0) reading = clamp(reading + gauss(this.rng) * p.sensors.noise, 0, 1);
      car.sensors[i] = reading;
    }

    // The brain decides; the tarmac disposes.
    const [steer, throttle] = feedForward(
      car.genome, this.shape, [...car.sensors, car.speed / p.car.topSpeed],
    );
    car.steer = steer;
    car.throttle = throttle;

    car.heading += steer * p.car.grip;
    car.speed += throttle * p.car.accel;
    car.speed *= 1 - p.car.drag;
    car.speed = clamp(car.speed, 0, p.car.topSpeed);

    car.x += Math.cos(car.heading) * car.speed;
    car.y += Math.sin(car.heading) * car.speed;

    // Head-on first (the frontal ray already paid for it), then the corners.
    if (frontal < CAR_RADIUS || nearestWallDist(car.x, car.y, grid) < CAR_RADIUS) {
      car.alive = false;
      car.out = 'wall';
      return;
    }

    // Progress along the centerline, wrap-aware. The window is small and
    // gated by physical distance so a car can never bank progress across a
    // hairpin where the path folds back within reach of the search — the
    // timing sheet only pays for ground actually covered.
    const cl = track.centerline;
    const N = cl.length;
    const at = car.progress % N;
    let bestDist = Infinity;
    let bestOff = 0;
    for (let off = -5; off <= 6; off++) {
      const i = ((at + off) % N + N) % N;
      const dx = car.x - cl[i].x, dy = car.y - cl[i].y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestOff = off; }
    }
    const gate = track.width * 1.5;
    if (bestOff > 0 && bestDist < gate * gate) car.progress += bestOff;

    // No progress for a patience-worth of ticks: flagged off, not crashed.
    if (car.progress === car.lastProgress) {
      car.stuckTimer++;
      if (car.stuckTimer > p.session.patience) {
        car.alive = false;
        car.out = 'stalled';
      }
    } else {
      car.stuckTimer = 0;
      car.lastProgress = car.progress;
    }
  }

  // ── Breeding the next heat ───────────────────────────────────────────

  private tournament(sorted: Car[]): Car {
    const k = Math.max(1, Math.round(this.params.evolution.tourneyK));
    let best: Car | null = null;
    for (let i = 0; i < k; i++) {
      const c = sorted[Math.floor(this.rng() * sorted.length)];
      if (!best || c.progress > best.progress) best = c;
    }
    return best!;
  }

  private endHeat() {
    const p = this.params;
    const cars = this.cars;
    const sorted = cars.slice().sort((a, b) => b.progress - a.progress);

    // The timing sheet for the record.
    const bestM = this.metres(sorted[0]?.progress ?? 0);
    let sum = 0, crashed = 0, stalled = 0;
    for (const c of cars) {
      sum += this.metres(c.progress);
      if (c.out === 'wall') crashed++;
      if (c.out === 'stalled') stalled++;
    }
    const G = this.shape.size;
    let diversity = 0;
    if (cars.length > 1) {
      // Mean per-weight stddev — how much genetic room the grid still has.
      for (let g = 0; g < G; g++) {
        let m = 0;
        for (const c of cars) m += c.genome[g];
        m /= cars.length;
        let v = 0;
        for (const c of cars) v += (c.genome[g] - m) * (c.genome[g] - m);
        diversity += Math.sqrt(v / cars.length);
      }
      diversity /= G;
    }
    const record = bestM > this.bestEver;
    if (record) { this.bestEver = bestM; this.bestEverGen = this.gen; }
    this.history.push({
      gen: this.gen,
      best: bestM,
      mean: cars.length ? sum / cars.length : 0,
      diversity,
      ticks: this.tick,
      crashed,
      stalled,
      record,
      newCircuit: this.pendingNewCircuit,
    });
    this.pendingNewCircuit = false;

    this.pastAttrition.push({ gen: this.gen, curve: this.attrition.slice(), pop: cars.length });
    if (this.pastAttrition.length > 12) this.pastAttrition.shift();

    // Selection. Elites ride through untouched; immigrants walk in off the
    // street; everyone else is bred from tournament winners.
    const popNext = p.evolution.popSize;
    const elite = Math.min(popNext, Math.max(0, Math.round(popNext * p.evolution.eliteFrac)));
    const immigrants = Math.round(popNext * p.evolution.immigrants);
    const genomes: Float64Array[] = [];

    for (let i = 0; i < elite && i < sorted.length; i++) {
      genomes.push(sorted[i].genome.slice());
    }
    while (genomes.length < popNext) {
      if (genomes.length >= popNext - immigrants) {
        genomes.push(createGenome(this.rng, this.shape.size, p.brain.initSpread));
        continue;
      }
      const a = this.tournament(sorted);
      const b = p.evolution.crossover ? this.tournament(sorted) : a;
      const child = new Float64Array(this.shape.size);
      for (let g = 0; g < this.shape.size; g++) {
        child[g] = (this.rng() < 0.5 ? a : b).genome[g];
        if (this.rng() < p.evolution.mutRate) {
          child[g] += gauss(this.rng) * p.evolution.mutStrength;
        }
      }
      genomes.push(child);
    }

    this.gen++;
    this.parity ^= 1;
    this.carriedGrid = false;

    // Circuit rotation: a fresh track every N heats keeps the grid honest —
    // brains that memorised one circuit get found out on the next.
    if (p.evolution.rotateEvery > 0 && this.gen % p.evolution.rotateEvery === 0) {
      p.circuit.seed = Math.floor(this.rng() * 100000) + 1;
      this.track = generateTrack(p.circuit);
      this.grid = buildWallGrid([...this.track.innerWalls, ...this.track.outerWalls]);
      this.pendingNewCircuit = true;
    }

    this.spawnGrid(genomes);
  }

  /** Run the rest of the current heat in one burst (bounded). */
  skipHeat() {
    const start = this.gen;
    let guard = this.params.session.tickBudget + 4;
    while (this.gen === start && guard-- > 0) this.step();
  }
}
