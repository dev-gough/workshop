// RM 12, The Vivarium — the simulation itself.
//
// A predator-prey world where nothing is hand-tuned at runtime: every rule the
// agents live under is a number in `EcoParams`, and the room's control rack
// edits that object directly. The point of the room is to make the algorithm
// legible, so the engine records more than it strictly needs to run — behaviour
// state, lineage, cause of death, and binned trait distributions — because those
// are what the instruments draw.
//
// Randomness runs through a seeded PRNG so a seed plus a parameter set fully
// determines a run. That is what makes the knobs worth turning: change one, keep
// the seed, and the difference you see is the parameter's doing.

export type TraitKey = 'speed' | 'vision' | 'size' | 'threshold';
export type Species = 'prey' | 'pred';
export type Behavior = 'flee' | 'hunt' | 'graze' | 'wander';
export type DeathCause = 'starved' | 'eaten' | 'aged' | 'culled';

export const TRAITS: TraitKey[] = ['speed', 'vision', 'size', 'threshold'];

export const TRAIT_LABEL: Record<TraitKey, string> = {
  speed: 'Speed',
  vision: 'Vision',
  size: 'Size',
  threshold: 'Breed at',
};

export const TRAIT_UNIT: Record<TraitKey, string> = {
  speed: 'u/t',
  vision: 'u',
  size: 'u',
  threshold: 'e',
};

export type Genome = Record<TraitKey, number>;

export interface Agent {
  id: number;
  species: Species;
  x: number;
  y: number;
  heading: number;
  energy: number;
  genome: Genome;
  age: number;
  gen: number;
  parent: number;
  kids: number;
  meals: number;
  /** Steering target in world space, relative to the agent. Drawn by the sense overlay. */
  tx: number;
  ty: number;
  state: Behavior;
  alive: boolean;
}

export interface Plant {
  x: number;
  y: number;
  eaten?: boolean;
}

// ── Parameters ───────────────────────────────────────────────────────────

export interface SpeciesParams {
  /** Founder stock — the genome the first generation is drawn around. */
  founder: Genome;
  /** How widely founders scatter around that genome, as a fraction of each trait's bounds. */
  spread: number;
  initial: number;
  startEnergy: number;
  /** Prey: energy per plant is set by plants.energy; this is the predator's base kill reward. */
  mealEnergy: number;
  /** Predators only — extra energy per unit of prey size. */
  sizeBonus: number;
  /** Ticks before death by old age. 0 disables ageing. */
  maxAge: number;
  /** Radians of turn available per tick when steering toward a target. */
  turnRate: number;
  /** Random heading jitter per tick when there is nothing to steer toward. */
  wander: number;
  /** Added to body size when testing whether a meal is in reach. */
  reach: number;
  /** Fraction of its energy a parent keeps when it breeds. */
  breedRetain: number;
  /** Fraction of the surrendered energy that reaches the offspring; the rest is the cost of breeding. */
  childShare: number;
  cap: number;
}

export interface EcoParams {
  seed: number;
  world: { w: number; h: number; wrap: boolean };
  plants: {
    spawnRate: number;
    capacity: number;
    energy: number;
    initial: number;
    /** 0 scatters plants uniformly; 1 confines them to patches. */
    patchiness: number;
    patches: number;
  };
  /** cost per tick = base × speed^speedExp × (1 + vision×visionCost) × (1 + size×sizeCost) */
  metabolism: {
    base: number;
    speedExp: number;
    visionCost: number;
    sizeCost: number;
  };
  heredity: {
    /** Probability that a given trait mutates at birth. */
    rate: number;
    /** Multiplier on every trait's mutation step. */
    scale: number;
    locked: Record<TraitKey, boolean>;
    bounds: Record<TraitKey, [number, number]>;
  };
  prey: SpeciesParams;
  pred: SpeciesParams;
  rules: {
    /** Repopulate a species that dies out, instead of letting the run end. */
    rescue: boolean;
    rescuePrey: number;
    rescuePred: number;
  };
}

/** Per-trait mutation step before `heredity.scale` is applied. */
export const TRAIT_SIGMA: Record<TraitKey, number> = {
  speed: 0.3,
  vision: 15,
  size: 1,
  threshold: 10,
};

/** Hard limits on what the bounds sliders themselves can be set to. */
export const TRAIT_LIMITS: Record<TraitKey, [number, number]> = {
  speed: [0.1, 8],
  vision: [5, 300],
  size: [1, 25],
  threshold: [20, 400],
};

export const TRAIT_STEP: Record<TraitKey, number> = {
  speed: 0.1,
  vision: 5,
  size: 0.5,
  threshold: 5,
};

export function defaultParams(): EcoParams {
  return {
    seed: 1729,
    world: { w: 1200, h: 600, wrap: true },
    plants: {
      spawnRate: 4.5,
      capacity: 745,
      energy: 25,
      initial: 300,
      patchiness: 0,
      patches: 6,
    },
    metabolism: { base: 0.08, speedExp: 1.4, visionCost: 0.002, sizeCost: 0.05 },
    heredity: {
      rate: 0.3,
      scale: 1,
      locked: { speed: false, vision: false, size: false, threshold: false },
      bounds: { speed: [0.5, 5], vision: [15, 200], size: [2, 15], threshold: [40, 250] },
    },
    prey: {
      founder: { speed: 2.25, vision: 70, size: 6, threshold: 100 },
      spread: 0.18,
      initial: 120,
      startEnergy: 60,
      mealEnergy: 0,
      sizeBonus: 0,
      maxAge: 0,
      turnRate: 0.15,
      wander: 0.3,
      reach: 3,
      breedRetain: 0.5,
      childShare: 0.8,
      cap: 600,
    },
    pred: {
      founder: { speed: 2.55, vision: 100, size: 7.5, threshold: 125 },
      spread: 0.18,
      initial: 23,
      startEnergy: 80,
      mealEnergy: 40,
      sizeBonus: 3,
      maxAge: 0,
      turnRate: 0.15,
      wander: 0.3,
      reach: 0,
      breedRetain: 0.5,
      childShare: 0.8,
      cap: 300,
    },
    rules: { rescue: true, rescuePrey: 20, rescuePred: 5 },
  };
}

/** Parameters that only take effect on a restock — they seed the world rather than govern it. */
export const RESTOCK_KEYS = new Set([
  'seed',
  'world.w',
  'world.h',
  'plants.initial',
  'prey.initial',
  'prey.startEnergy',
  'prey.founder.speed',
  'prey.founder.vision',
  'prey.founder.size',
  'prey.founder.threshold',
  'prey.spread',
  'pred.initial',
  'pred.startEnergy',
  'pred.founder.speed',
  'pred.founder.vision',
  'pred.founder.size',
  'pred.founder.threshold',
  'pred.spread',
]);

// ── Recorded history ─────────────────────────────────────────────────────

export const BINS = 22;
export const HISTORY_COLS = 320;
export const SAMPLE_EVERY = 5;

export interface PopSample {
  t: number;
  prey: number;
  pred: number;
  plants: number;
  /** Deaths in the sample window, by cause. */
  starved: number;
  eaten: number;
  aged: number;
  births: number;
}

export interface TraitStat {
  mean: number;
  sd: number;
  /** Trait distribution binned across the trait's bounds, normalised to 0–255. */
  hist: Uint8Array;
  /** Mean trait of everything born in the sample window, or NaN if nothing bred. */
  bornMean: number;
}

export interface TraitSample {
  t: number;
  prey: Record<TraitKey, TraitStat>;
  pred: Record<TraitKey, TraitStat>;
}

export interface Stats {
  tick: number;
  prey: number;
  pred: number;
  plants: number;
  births: number;
  deaths: Record<DeathCause, number>;
  maxGen: number;
  meanGen: { prey: number; pred: number };
  meanEnergy: { prey: number; pred: number };
  traits: {
    prey: Record<TraitKey, number>;
    pred: Record<TraitKey, number>;
  };
  extinct: { prey: boolean; pred: boolean };
  signal: EcoSignal;
}

export type EcoSignalLevel = 'calibrating' | 'stable' | 'watch' | 'tipping';

export interface EcoSignal {
  level: EcoSignalLevel;
  label: string;
  detail: string;
  /** Change between the early and late halves of the observation window. */
  change: number;
}

/**
 * A deliberately simple early-warning instrument. It compares two halves of
 * the recent record rather than reacting to one noisy sample.
 */
export function classifyEcoSignal(
  samples: readonly PopSample[],
  current: Pick<Stats, 'prey' | 'pred' | 'plants'>,
): EcoSignal {
  if (current.prey === 0 || current.pred === 0) {
    const subject = current.prey === 0 && current.pred === 0
      ? 'Both populations'
      : current.prey === 0 ? 'Grazers' : 'Hunters';
    return {
      level: 'tipping',
      label: 'Threshold crossed',
      detail: `${subject} have collapsed to zero.`,
      change: -1,
    };
  }

  const window = samples.slice(-12);
  if (window.length < 8) {
    return {
      level: 'calibrating',
      label: 'Learning the cycle',
      detail: `${8 - window.length} more samples before trend detection.`,
      change: 0,
    };
  }

  const split = Math.floor(window.length / 2);
  const trend = (key: 'prey' | 'pred' | 'plants') => {
    let early = 0;
    let late = 0;
    for (let i = 0; i < split; i++) early += window[i][key];
    for (let i = split; i < window.length; i++) late += window[i][key];
    early /= split;
    late /= window.length - split;
    return (late - early) / Math.max(1, early);
  };

  const changes = [
    { name: 'Grazer', change: trend('prey') },
    { name: 'Hunter', change: trend('pred') },
    { name: 'Plant', change: trend('plants') },
  ];
  changes.sort((a, b) => a.change - b.change);
  const weakest = changes[0];
  const pct = Math.round(Math.abs(weakest.change) * 100);

  if (weakest.change <= -0.35) {
    return {
      level: 'tipping',
      label: `${weakest.name} collapse risk`,
      detail: `Recent mean is down ${pct}% across the observation window.`,
      change: weakest.change,
    };
  }
  if (weakest.change <= -0.18) {
    return {
      level: 'watch',
      label: `${weakest.name} pressure`,
      detail: `Recent mean is down ${pct}%; watch whether the cycle rebounds.`,
      change: weakest.change,
    };
  }
  return {
    level: 'stable',
    label: 'Cycle holding',
    detail: 'No population is falling fast enough to trigger the watch.',
    change: weakest.change,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}

const CELL = 40;

// ── Engine ───────────────────────────────────────────────────────────────

export class Ecosystem {
  params: EcoParams;
  agents: Agent[] = [];
  plants: Plant[] = [];
  tick = 0;

  pop: PopSample[] = [];
  traitHistory: TraitSample[] = [];

  totals: Record<DeathCause, number> = { starved: 0, eaten: 0, aged: 0, culled: 0 };
  totalBirths = 0;
  maxGen = 0;

  private rand: () => number;
  private nextId = 1;
  private spare: number | null = null;
  private agentGrids: Record<Species, Map<number, Agent[]>> = {
    prey: new Map(),
    pred: new Map(),
  };
  private plantGrid = new Map<number, Plant[]>();
  private cols = 1;
  private patchCenters: [number, number][] = [];

  // Accumulators drained on every history sample.
  private windowDeaths = { starved: 0, eaten: 0, aged: 0 };
  private windowBirths = 0;
  private bornSums: Record<Species, Record<TraitKey, number>> = {
    prey: { speed: 0, vision: 0, size: 0, threshold: 0 },
    pred: { speed: 0, vision: 0, size: 0, threshold: 0 },
  };
  private bornCounts: Record<Species, number> = { prey: 0, pred: 0 };

  constructor(params: EcoParams) {
    this.params = params;
    this.rand = mulberry32(params.seed);
    this.cols = Math.ceil(params.world.w / CELL) + 1;

    const patchRand = mulberry32(params.seed ^ 0x9e3779b9);
    for (let i = 0; i < params.plants.patches; i++) {
      this.patchCenters.push([patchRand() * params.world.w, patchRand() * params.world.h]);
    }

    for (let i = 0; i < params.prey.initial; i++) this.founder('prey');
    for (let i = 0; i < params.pred.initial; i++) this.founder('pred');
    for (let i = 0; i < params.plants.initial; i++) this.addPlant(this.newPlant());
  }

  private gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.rand();
    while (v === 0) v = this.rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  private newPlant(): Plant {
    const { world, plants } = this.params;
    if (plants.patchiness > 0 && this.patchCenters.length > 0 && this.rand() < plants.patchiness) {
      const [cx, cy] = this.patchCenters[Math.floor(this.rand() * this.patchCenters.length)];
      const radius = Math.min(world.w, world.h) / (2 * Math.sqrt(this.patchCenters.length));
      const x = cx + this.gauss() * radius * 0.5;
      const y = cy + this.gauss() * radius * 0.5;
      return { x: this.wrapX(x), y: this.wrapY(y) };
    }
    return { x: this.rand() * world.w, y: this.rand() * world.h };
  }

  private wrapX(x: number) {
    const w = this.params.world.w;
    return ((x % w) + w) % w;
  }

  private wrapY(y: number) {
    const h = this.params.world.h;
    return ((y % h) + h) % h;
  }

  private founder(species: Species) {
    const sp = this.params[species];
    const bounds = this.params.heredity.bounds;
    const genome = {} as Genome;
    for (const k of TRAITS) {
      const [lo, hi] = bounds[k];
      const jitter = (this.rand() - 0.5) * 2 * sp.spread * (hi - lo);
      genome[k] = clamp(sp.founder[k] + jitter, lo, hi);
    }
    this.agents.push(this.makeAgent(species, genome, this.rand() * this.params.world.w, this.rand() * this.params.world.h, sp.startEnergy, 0, 0));
  }

  private makeAgent(species: Species, genome: Genome, x: number, y: number, energy: number, gen: number, parent: number): Agent {
    return {
      id: this.nextId++,
      species,
      x,
      y,
      heading: this.rand() * Math.PI * 2,
      energy,
      genome,
      age: 0,
      gen,
      parent,
      kids: 0,
      meals: 0,
      tx: 0,
      ty: 0,
      state: 'wander',
      alive: true,
    };
  }

  private mutate(g: Genome): Genome {
    const { rate, scale, locked, bounds } = this.params.heredity;
    const child = {} as Genome;
    for (const k of TRAITS) {
      const [lo, hi] = bounds[k];
      const step = locked[k] || this.rand() >= rate ? 0 : this.gauss() * TRAIT_SIGMA[k] * scale;
      child[k] = clamp(g[k] + step, lo, hi);
    }
    return child;
  }

  /** Energy burned per tick. The heart of the model: every trait costs something to carry. */
  cost(g: Genome): number {
    const m = this.params.metabolism;
    return m.base * Math.pow(g.speed, m.speedExp) * (1 + g.vision * m.visionCost) * (1 + g.size * m.sizeCost);
  }

  private key(x: number, y: number) {
    return Math.floor(y / CELL) * this.cols + Math.floor(x / CELL);
  }

  private addPlant(plant: Plant) {
    this.plants.push(plant);
    const k = this.key(plant.x, plant.y);
    const cell = this.plantGrid.get(k);
    if (cell) cell.push(plant);
    else this.plantGrid.set(k, [plant]);
  }

  private removePlant(plant: Plant) {
    const k = this.key(plant.x, plant.y);
    const cell = this.plantGrid.get(k);
    if (!cell) return;
    const i = cell.indexOf(plant);
    if (i >= 0) cell.splice(i, 1);
    if (cell.length === 0) this.plantGrid.delete(k);
  }

  private buildAgentGrids() {
    this.agentGrids.prey.clear();
    this.agentGrids.pred.clear();
    for (const a of this.agents) {
      if (!a.alive) continue;
      const k = this.key(a.x, a.y);
      const grid = this.agentGrids[a.species];
      const cell = grid.get(k);
      if (cell) cell.push(a);
      else grid.set(k, [a]);
    }
  }

  /** Shortest offset from a to b, honouring a toroidal world. */
  private delta(ax: number, ay: number, bx: number, by: number): [number, number, number] {
    let dx = bx - ax;
    let dy = by - ay;
    if (this.params.world.wrap) {
      const { w, h } = this.params.world;
      if (dx > w / 2) dx -= w;
      else if (dx < -w / 2) dx += w;
      if (dy > h / 2) dy -= h;
      else if (dy < -h / 2) dy += h;
    }
    return [dx, dy, Math.sqrt(dx * dx + dy * dy)];
  }

  private nearbyAgents(species: Species, x: number, y: number, radius: number, out: Agent[]) {
    out.length = 0;
    const grid = this.agentGrids[species];
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cell = grid.get((cy + dy) * this.cols + (cx + dx));
        if (cell) for (const a of cell) out.push(a);
      }
    }
  }

  private nearbyPlants(x: number, y: number, radius: number, out: Plant[]) {
    out.length = 0;
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cell = this.plantGrid.get((cy + dy) * this.cols + (cx + dx));
        if (cell) for (const p of cell) out.push(p);
      }
    }
  }

  step() {
    const P = this.params;
    const { w: WW, h: WH, wrap } = P.world;

    // Growth is fractional: the whole part seeds outright, the remainder is a
    // per-tick chance, so a rate below one plant per tick still means something.
    const whole = Math.floor(P.plants.spawnRate);
    const sprouts = whole + (this.rand() < P.plants.spawnRate - whole ? 1 : 0);
    for (let i = 0; i < sprouts; i++) {
      if (this.plants.length >= P.plants.capacity) break;
      this.addPlant(this.newPlant());
    }

    this.buildAgentGrids();

    const newborns: Agent[] = [];
    const scratchA: Agent[] = [];
    const scratchP: Plant[] = [];
    let anyEaten = false;

    for (const a of this.agents) {
      if (!a.alive) continue;
      const sp = P[a.species];
      const g = a.genome;

      a.energy -= this.cost(g);
      a.age++;

      if (a.energy <= 0) {
        a.alive = false;
        this.windowDeaths.starved++;
        this.totals.starved++;
        continue;
      }
      if (sp.maxAge > 0 && a.age > sp.maxAge) {
        a.alive = false;
        this.windowDeaths.aged++;
        this.totals.aged++;
        continue;
      }

      // ── Sense: pick a target, and remember it so the overlay can draw it.
      let targetX = 0;
      let targetY = 0;
      let state: Behavior = 'wander';

      if (a.species === 'prey') {
        this.nearbyAgents('pred', a.x, a.y, g.vision, scratchA);
        let best = Infinity;
        let px = 0;
        let py = 0;
        for (const n of scratchA) {
          if (n.species !== 'pred' || !n.alive) continue;
          const [dx, dy, d] = this.delta(a.x, a.y, n.x, n.y);
          if (d < g.vision && d < best) {
            best = d;
            px = dx;
            py = dy;
          }
        }
        if (best < Infinity) {
          targetX = -px;
          targetY = -py;
          state = 'flee';
        } else {
          this.nearbyPlants(a.x, a.y, g.vision, scratchP);
          let closest = Infinity;
          for (const p of scratchP) {
            if (p.eaten) continue;
            const [dx, dy, d] = this.delta(a.x, a.y, p.x, p.y);
            if (d < g.vision && d < closest) {
              closest = d;
              targetX = dx;
              targetY = dy;
              state = 'graze';
            }
          }
        }
      } else {
        this.nearbyAgents('prey', a.x, a.y, g.vision, scratchA);
        let closest = Infinity;
        for (const n of scratchA) {
          if (n.species !== 'prey' || !n.alive) continue;
          const [dx, dy, d] = this.delta(a.x, a.y, n.x, n.y);
          if (d < g.vision && d < closest) {
            closest = d;
            targetX = dx;
            targetY = dy;
            state = 'hunt';
          }
        }
      }

      a.state = state;
      a.tx = targetX;
      a.ty = targetY;

      // ── Act: turn toward the target at the species' agility, else drift.
      if (state === 'wander') {
        a.heading += (this.rand() - 0.5) * sp.wander;
      } else {
        let diff = Math.atan2(targetY, targetX) - a.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        a.heading += clamp(diff, -sp.turnRate, sp.turnRate);
      }

      let nx = a.x + Math.cos(a.heading) * g.speed;
      let ny = a.y + Math.sin(a.heading) * g.speed;
      if (wrap) {
        nx = this.wrapX(nx);
        ny = this.wrapY(ny);
      } else {
        // Walled world: bounce off the glass.
        if (nx < 0 || nx > WW) {
          a.heading = Math.PI - a.heading;
          nx = clamp(nx, 0, WW);
        }
        if (ny < 0 || ny > WH) {
          a.heading = -a.heading;
          ny = clamp(ny, 0, WH);
        }
      }
      a.x = nx;
      a.y = ny;

      // ── Eat.
      if (a.species === 'prey') {
        const reach = g.size + sp.reach;
        this.nearbyPlants(a.x, a.y, reach, scratchP);
        for (const p of scratchP) {
          if (p.eaten) continue;
          const [, , d] = this.delta(a.x, a.y, p.x, p.y);
          if (d < reach) {
            a.energy += P.plants.energy;
            a.meals++;
            p.eaten = true;
            this.removePlant(p);
            anyEaten = true;
            break;
          }
        }
      } else {
        this.nearbyAgents('prey', a.x, a.y, g.size + 20 + sp.reach, scratchA);
        for (const n of scratchA) {
          if (n.species !== 'prey' || !n.alive) continue;
          const [, , d] = this.delta(a.x, a.y, n.x, n.y);
          if (d < g.size + n.genome.size + sp.reach) {
            n.alive = false;
            this.windowDeaths.eaten++;
            this.totals.eaten++;
            a.energy += sp.mealEnergy + n.genome.size * sp.sizeBonus;
            a.meals++;
            break;
          }
        }
      }

      // ── Breed. The parent surrenders energy; only part of it reaches the child.
      if (a.energy > g.threshold) {
        const surrendered = a.energy * (1 - sp.breedRetain);
        a.energy -= surrendered;
        a.kids++;
        const gen = a.gen + 1;
        if (gen > this.maxGen) this.maxGen = gen;
        const child = this.makeAgent(
          a.species,
          this.mutate(g),
          this.wrapX(a.x + (this.rand() - 0.5) * 10),
          this.wrapY(a.y + (this.rand() - 0.5) * 10),
          surrendered * sp.childShare,
          gen,
          a.id,
        );
        newborns.push(child);
        this.totalBirths++;
        this.windowBirths++;
        this.bornCounts[a.species]++;
        for (const k of TRAITS) this.bornSums[a.species][k] += child.genome[k];
      }
    }

    if (anyEaten) this.plants = this.plants.filter(p => !p.eaten);

    this.agents = this.agents.filter(a => a.alive);
    for (const n of newborns) this.agents.push(n);

    // ── Carrying capacity. The weakest go first, which is itself selection.
    let preyCount = 0;
    let predCount = 0;
    for (const a of this.agents) {
      if (a.species === 'prey') preyCount++;
      else predCount++;
    }
    preyCount = this.enforceCap('prey', preyCount);
    predCount = this.enforceCap('pred', predCount);

    this.tick++;
    if (this.tick % SAMPLE_EVERY === 0) this.sample(preyCount, predCount);

    if (P.rules.rescue) {
      if (preyCount === 0) for (let i = 0; i < P.rules.rescuePrey; i++) this.founder('prey');
      if (predCount === 0) for (let i = 0; i < P.rules.rescuePred; i++) this.founder('pred');
    }
  }

  private enforceCap(species: Species, count: number): number {
    const cap = this.params[species].cap;
    if (cap <= 0 || count <= cap) return count;
    const keep = Math.floor(cap * 0.88);
    const pool = this.agents.filter(a => a.species === species);
    pool.sort((a, b) => a.energy - b.energy);
    const kill = pool.length - keep;
    for (let i = 0; i < kill; i++) {
      pool[i].alive = false;
      this.totals.culled++;
    }
    this.agents = this.agents.filter(a => a.alive);
    return keep;
  }

  private sample(preyCount: number, predCount: number) {
    this.pop.push({
      t: this.tick,
      prey: preyCount,
      pred: predCount,
      plants: this.plants.length,
      starved: this.windowDeaths.starved,
      eaten: this.windowDeaths.eaten,
      aged: this.windowDeaths.aged,
      births: this.windowBirths,
    });
    if (this.pop.length > HISTORY_COLS) this.pop.shift();

    const bounds = this.params.heredity.bounds;
    const build = (species: Species): Record<TraitKey, TraitStat> => {
      const out = {} as Record<TraitKey, TraitStat>;
      const members = this.agents.filter(a => a.species === species);
      const n = members.length;
      const born = this.bornCounts[species];
      for (const k of TRAITS) {
        const [lo, hi] = bounds[k];
        const span = hi - lo || 1;
        const hist = new Uint8Array(BINS);
        let sum = 0;
        let sq = 0;
        let peak = 0;
        const counts = new Uint16Array(BINS);
        for (const a of members) {
          const v = a.genome[k];
          sum += v;
          sq += v * v;
          const bin = clamp(Math.floor(((v - lo) / span) * BINS), 0, BINS - 1);
          counts[bin]++;
          if (counts[bin] > peak) peak = counts[bin];
        }
        if (peak > 0) for (let i = 0; i < BINS; i++) hist[i] = Math.round((counts[i] / peak) * 255);
        const mean = n > 0 ? sum / n : 0;
        out[k] = {
          mean,
          sd: n > 1 ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0,
          hist,
          bornMean: born > 0 ? this.bornSums[species][k] / born : NaN,
        };
      }
      return out;
    };

    this.traitHistory.push({ t: this.tick, prey: build('prey'), pred: build('pred') });
    if (this.traitHistory.length > HISTORY_COLS) this.traitHistory.shift();

    this.windowDeaths = { starved: 0, eaten: 0, aged: 0 };
    this.windowBirths = 0;
    for (const s of ['prey', 'pred'] as Species[]) {
      this.bornCounts[s] = 0;
      for (const k of TRAITS) this.bornSums[s][k] = 0;
    }
  }

  stats(): Stats {
    let prey = 0;
    let pred = 0;
    let preyGen = 0;
    let predGen = 0;
    let preyE = 0;
    let predE = 0;
    const preyT = { speed: 0, vision: 0, size: 0, threshold: 0 };
    const predT = { speed: 0, vision: 0, size: 0, threshold: 0 };
    for (const a of this.agents) {
      if (a.species === 'prey') {
        prey++;
        preyGen += a.gen;
        preyE += a.energy;
        for (const k of TRAITS) preyT[k] += a.genome[k];
      } else {
        pred++;
        predGen += a.gen;
        predE += a.energy;
        for (const k of TRAITS) predT[k] += a.genome[k];
      }
    }
    const div = (v: number, n: number) => (n > 0 ? v / n : 0);
    for (const k of TRAITS) {
      preyT[k] = div(preyT[k], prey);
      predT[k] = div(predT[k], pred);
    }
    const current = { prey, pred, plants: this.plants.length };
    return {
      tick: this.tick,
      ...current,
      births: this.totalBirths,
      deaths: { ...this.totals },
      maxGen: this.maxGen,
      meanGen: { prey: div(preyGen, prey), pred: div(predGen, pred) },
      meanEnergy: { prey: div(preyE, prey), pred: div(predE, pred) },
      traits: { prey: preyT, pred: predT },
      extinct: { prey: prey === 0, pred: pred === 0 },
      signal: classifyEcoSignal(this.pop, current),
    };
  }

  agentAt(x: number, y: number, radius: number): Agent | null {
    let best: Agent | null = null;
    let bestD = radius;
    for (const a of this.agents) {
      const [, , d] = this.delta(x, y, a.x, a.y);
      const hit = Math.max(radius, a.genome.size);
      if (d < hit && d < bestD + a.genome.size) {
        best = a;
        bestD = d;
      }
    }
    return best;
  }

  find(id: number): Agent | null {
    for (const a of this.agents) if (a.id === id) return a;
    return null;
  }
}

/** True when two parameter sets differ on anything that only takes effect on restock. */
export function needsRestock(a: EcoParams, b: EcoParams): boolean {
  for (const key of RESTOCK_KEYS) {
    let va: unknown = a;
    let vb: unknown = b;
    for (const part of key.split('.')) {
      va = (va as Record<string, unknown> | undefined)?.[part];
      vb = (vb as Record<string, unknown> | undefined)?.[part];
    }
    if (va !== vb) return true;
  }
  return false;
}
