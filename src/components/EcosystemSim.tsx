'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, RotateCcw, Gauge, Leaf, Skull, LineChart,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ── Types ────────────────────────────────────────────────────────────────

interface Genome {
  speed: number;
  visionRange: number;
  size: number;
  reproductionThreshold: number;
}

interface Agent {
  id: number;
  type: 'prey' | 'predator';
  x: number; y: number;
  vx: number; vy: number;
  heading: number;
  energy: number;
  genome: Genome;
  age: number;
  alive: boolean;
}

interface Food {
  x: number; y: number;
  eaten?: boolean;
}

interface PopSnapshot {
  tick: number;
  prey: number;
  predators: number;
}

interface TraitSnapshot {
  tick: number;
  preySpeed: number;
  preyVision: number;
  preySize: number;
  predSpeed: number;
  predVision: number;
  predSize: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function gaussRand(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function wrapDist(ax: number, ay: number, bx: number, by: number, w: number, h: number): [number, number, number] {
  let dx = bx - ax, dy = by - ay;
  if (dx > w / 2) dx -= w; else if (dx < -w / 2) dx += w;
  if (dy > h / 2) dy -= h; else if (dy < -h / 2) dy += h;
  return [dx, dy, Math.sqrt(dx * dx + dy * dy)];
}

// ── Engine ────────────────────────────────────────────────────────────────

const CELL_SIZE = 40;

class EcosystemEngine {
  agents: Agent[];
  food: Food[];
  worldW: number;
  worldH: number;
  tick: number;
  nextId: number;
  history: PopSnapshot[];
  traitHistory: TraitSnapshot[];
  mutationRate: number;
  foodSpawnRate: number;
  grid: Map<number, Agent[]>;
  foodGrid: Map<number, Food[]>;
  gridCols: number;

  constructor(worldW: number, worldH: number, initialPrey: number, initialPredators: number, foodSpawnRate: number, mutationRate: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.tick = 0;
    this.nextId = 0;
    this.history = [];
    this.traitHistory = [];
    this.mutationRate = mutationRate;
    this.foodSpawnRate = foodSpawnRate;
    this.grid = new Map();
    this.foodGrid = new Map();
    this.gridCols = Math.ceil(worldW / CELL_SIZE);
    this.agents = [];
    this.food = [];

    for (let i = 0; i < initialPrey; i++) this.spawnAgent('prey');
    for (let i = 0; i < initialPredators; i++) this.spawnAgent('predator');
    for (let i = 0; i < 200; i++) this.food.push({ x: Math.random() * worldW, y: Math.random() * worldH });
  }

  spawnAgent(type: 'prey' | 'predator', parent?: Genome, x?: number, y?: number) {
    let genome: Genome;
    if (parent) {
      genome = this.mutateGenome(parent);
    } else {
      genome = type === 'prey'
        ? { speed: 1.5 + Math.random() * 1.5, visionRange: 40 + Math.random() * 60, size: 4 + Math.random() * 4, reproductionThreshold: 80 + Math.random() * 40 }
        : { speed: 1.8 + Math.random() * 1.5, visionRange: 60 + Math.random() * 80, size: 5 + Math.random() * 5, reproductionThreshold: 100 + Math.random() * 50 };
    }
    this.agents.push({
      id: this.nextId++,
      type,
      x: x ?? Math.random() * this.worldW,
      y: y ?? Math.random() * this.worldH,
      vx: 0, vy: 0,
      heading: Math.random() * Math.PI * 2,
      energy: type === 'prey' ? 60 : 80,
      genome,
      age: 0,
      alive: true,
    });
  }

  mutateGenome(g: Genome): Genome {
    const r = this.mutationRate;
    return {
      speed: clamp(g.speed + (Math.random() < r ? gaussRand() * 0.3 : 0), 0.5, 5),
      visionRange: clamp(g.visionRange + (Math.random() < r ? gaussRand() * 15 : 0), 15, 200),
      size: clamp(g.size + (Math.random() < r ? gaussRand() * 1 : 0), 2, 15),
      reproductionThreshold: clamp(g.reproductionThreshold + (Math.random() < r ? gaussRand() * 10 : 0), 40, 250),
    };
  }

  metabolism(g: Genome): number {
    return 0.08 * Math.pow(g.speed, 1.4) * (1 + g.visionRange / 500) * (1 + g.size / 20);
  }

  buildGrid() {
    this.grid.clear();
    for (const a of this.agents) {
      if (!a.alive) continue;
      const cx = Math.floor(a.x / CELL_SIZE);
      const cy = Math.floor(a.y / CELL_SIZE);
      const key = cy * this.gridCols + cx;
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(a);
    }
  }

  buildFoodGrid() {
    this.foodGrid.clear();
    for (const f of this.food) {
      const cx = Math.floor(f.x / CELL_SIZE);
      const cy = Math.floor(f.y / CELL_SIZE);
      const key = cy * this.gridCols + cx;
      let arr = this.foodGrid.get(key);
      if (!arr) { arr = []; this.foodGrid.set(key, arr); }
      arr.push(f);
    }
  }

  getNearby(x: number, y: number, radius: number): Agent[] {
    const r = Math.ceil(radius / CELL_SIZE);
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    const result: Agent[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const key = (cy + dy) * this.gridCols + (cx + dx);
        const cell = this.grid.get(key);
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  getNearbyFood(x: number, y: number, radius: number): Food[] {
    const r = Math.ceil(radius / CELL_SIZE);
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    const result: Food[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const key = (cy + dy) * this.gridCols + (cx + dx);
        const cell = this.foodGrid.get(key);
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  step() {
    // Spawn food
    for (let i = 0; i < this.foodSpawnRate; i++) {
      if (this.food.length < 500) {
        this.food.push({ x: Math.random() * this.worldW, y: Math.random() * this.worldH });
      }
    }

    this.buildGrid();
    this.buildFoodGrid();

    const newAgents: Agent[] = [];
    let foodEaten = false;

    for (const a of this.agents) {
      if (!a.alive) continue;

      const g = a.genome;
      a.energy -= this.metabolism(g);
      a.age++;

      if (a.energy <= 0) { a.alive = false; continue; }

      // Find target
      let targetDx = 0, targetDy = 0;
      let hasTarget = false;

      if (a.type === 'prey') {
        // Flee from nearby predators
        const nearby = this.getNearby(a.x, a.y, g.visionRange);
        let closestPredDist = Infinity, predDx = 0, predDy = 0;
        for (const n of nearby) {
          if (n.type !== 'predator' || !n.alive) continue;
          const [dx, dy, d] = wrapDist(a.x, a.y, n.x, n.y, this.worldW, this.worldH);
          if (d < g.visionRange && d < closestPredDist) {
            closestPredDist = d; predDx = dx; predDy = dy;
          }
        }
        if (closestPredDist < g.visionRange) {
          // Flee!
          targetDx = -predDx; targetDy = -predDy;
          hasTarget = true;
        } else {
          // Seek food
          let closestDist = Infinity;
          const nearbyFood = this.getNearbyFood(a.x, a.y, g.visionRange);
          for (const f of nearbyFood) {
            if (f.eaten) continue;
            const [dx, dy, d] = wrapDist(a.x, a.y, f.x, f.y, this.worldW, this.worldH);
            if (d < g.visionRange && d < closestDist) {
              closestDist = d; targetDx = dx; targetDy = dy; hasTarget = true;
            }
          }
        }
      } else {
        // Predator: seek prey
        const nearby = this.getNearby(a.x, a.y, g.visionRange);
        let closestDist = Infinity;
        for (const n of nearby) {
          if (n.type !== 'prey' || !n.alive) continue;
          const [dx, dy, d] = wrapDist(a.x, a.y, n.x, n.y, this.worldW, this.worldH);
          if (d < g.visionRange && d < closestDist) {
            closestDist = d; targetDx = dx; targetDy = dy; hasTarget = true;
          }
        }
      }

      // Steering
      if (hasTarget) {
        const targetAngle = Math.atan2(targetDy, targetDx);
        let diff = targetAngle - a.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        a.heading += clamp(diff, -0.15, 0.15);
      } else {
        a.heading += (Math.random() - 0.5) * 0.3;
      }

      // Move
      a.vx = Math.cos(a.heading) * g.speed;
      a.vy = Math.sin(a.heading) * g.speed;
      a.x = ((a.x + a.vx) % this.worldW + this.worldW) % this.worldW;
      a.y = ((a.y + a.vy) % this.worldH + this.worldH) % this.worldH;

      // Eat
      if (a.type === 'prey') {
        const nearbyFood = this.getNearbyFood(a.x, a.y, g.size + 3);
        for (const f of nearbyFood) {
          if (f.eaten) continue;
          const [, , d] = wrapDist(a.x, a.y, f.x, f.y, this.worldW, this.worldH);
          if (d < g.size + 3) {
            a.energy += 25;
            f.eaten = true;
            foodEaten = true;
            break;
          }
        }
      } else {
        const nearby = this.getNearby(a.x, a.y, g.size + 15);
        for (const n of nearby) {
          if (n.type !== 'prey' || !n.alive) continue;
          const [, , d] = wrapDist(a.x, a.y, n.x, n.y, this.worldW, this.worldH);
          if (d < g.size + n.genome.size) {
            n.alive = false;
            a.energy += 40 + n.genome.size * 3;
            break;
          }
        }
      }

      // Reproduce
      if (a.energy > g.reproductionThreshold) {
        a.energy *= 0.5;
        newAgents.push({
          id: this.nextId++,
          type: a.type,
          x: a.x + (Math.random() - 0.5) * 10,
          y: a.y + (Math.random() - 0.5) * 10,
          vx: 0, vy: 0,
          heading: Math.random() * Math.PI * 2,
          energy: a.energy * 0.8,
          genome: this.mutateGenome(g),
          age: 0,
          alive: true,
        });
      }
    }

    // Remove eaten food (only rebuild the array if anything was consumed)
    if (foodEaten) this.food = this.food.filter(f => !f.eaten);

    // Remove dead
    this.agents = this.agents.filter(a => a.alive);
    this.agents.push(...newAgents);

    // Single-pass stats: counts + trait sums for both species
    let preyCount = 0, predCount = 0;
    let preySpeed = 0, preyVision = 0, preySize = 0;
    let predSpeed = 0, predVision = 0, predSize = 0;
    for (const a of this.agents) {
      const g = a.genome;
      if (a.type === 'prey') {
        preyCount++;
        preySpeed += g.speed; preyVision += g.visionRange; preySize += g.size;
      } else {
        predCount++;
        predSpeed += g.speed; predVision += g.visionRange; predSize += g.size;
      }
    }

    // Population cap to prevent meltdown
    if (preyCount > 400) {
      const prey = this.agents.filter(a => a.type === 'prey');
      prey.sort((a, b) => a.energy - b.energy);
      for (let i = 0; i < prey.length - 350; i++) prey[i].alive = false;
      this.agents = this.agents.filter(a => a.alive);
      preyCount = 350;
    }

    this.tick++;
    if (this.tick % 5 === 0) {
      this.history.push({ tick: this.tick, prey: preyCount, predators: predCount });
      if (this.history.length > 600) this.history.shift();
      this.traitHistory.push({
        tick: this.tick,
        preySpeed: preyCount > 0 ? preySpeed / preyCount : 0,
        preyVision: preyCount > 0 ? preyVision / preyCount : 0,
        preySize: preyCount > 0 ? preySize / preyCount : 0,
        predSpeed: predCount > 0 ? predSpeed / predCount : 0,
        predVision: predCount > 0 ? predVision / predCount : 0,
        predSize: predCount > 0 ? predSize / predCount : 0,
      });
      if (this.traitHistory.length > 600) this.traitHistory.shift();
    }

    // Respawn if extinct
    if (preyCount === 0) {
      for (let i = 0; i < 20; i++) this.spawnAgent('prey');
    }
    if (predCount === 0) {
      for (let i = 0; i < 5; i++) this.spawnAgent('predator');
    }
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────

function drawEcosystem(
  ctx: CanvasRenderingContext2D,
  engine: EcosystemEngine,
  canvasW: number,
  canvasH: number,
  isDark: boolean,
  showTraits: boolean,
) {
  const graphH = 100;
  const traitH = showTraits ? 100 : 0;
  const worldH = canvasH - graphH - traitH - (showTraits ? 8 : 4);
  const scaleX = canvasW / engine.worldW;
  const scaleY = worldH / engine.worldH;

  const bgColor = isDark ? 'hsl(224,35%,11%)' : 'hsl(0,0%,96%)';

  // World background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasW, worldH);

  // Food
  ctx.fillStyle = isDark ? '#4ade80' : '#16a34a';
  for (const f of engine.food) {
    ctx.beginPath();
    ctx.arc(f.x * scaleX, f.y * scaleY, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Agents
  for (const a of engine.agents) {
    const sx = a.x * scaleX;
    const sy = a.y * scaleY;
    const r = Math.max(2, a.genome.size * Math.min(scaleX, scaleY) * 0.4);
    const alpha = clamp(a.energy / 80, 0.3, 1);

    if (a.type === 'prey') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isDark ? '#4ade80' : '#16a34a';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isDark ? '#f87171' : '#dc2626';
      ctx.beginPath();
      const h = a.heading;
      ctx.moveTo(sx + Math.cos(h) * r * 1.5, sy + Math.sin(h) * r * 1.5);
      ctx.lineTo(sx + Math.cos(h + 2.5) * r, sy + Math.sin(h + 2.5) * r);
      ctx.lineTo(sx + Math.cos(h - 2.5) * r, sy + Math.sin(h - 2.5) * r);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Graph area
  const graphY = worldH + 4;
  ctx.fillStyle = isDark ? 'hsl(224,35%,8%)' : 'hsl(0,0%,93%)';
  ctx.fillRect(0, graphY, canvasW, graphH);

  // Border between world and graph
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, graphY); ctx.lineTo(canvasW, graphY);
  ctx.stroke();

  const preyColor = isDark ? '#4ade80' : '#16a34a';
  const predColor = isDark ? '#f87171' : '#dc2626';
  const labelColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';

  const history = engine.history;
  if (history.length < 2) return;

  // Find max for Y scale
  let maxPop = 10;
  for (const s of history) maxPop = Math.max(maxPop, s.prey, s.predators);
  maxPop = Math.ceil(maxPop * 1.1);

  const gx = (i: number) => (i / (history.length - 1)) * canvasW;
  const gy = (val: number) => graphY + graphH - (val / maxPop) * (graphH - 10) - 5;

  // Prey line
  ctx.strokeStyle = preyColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = gx(i), y = gy(history[i].prey);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Predator line
  ctx.strokeStyle = predColor;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = gx(i), y = gy(history[i].predators);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Labels
  ctx.fillStyle = labelColor;
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(`population  ·  max: ${maxPop}`, 4, graphY + 12);

  // ── Trait-drift strip ────────────────────────────────────────────────────
  if (!showTraits) return;

  const traitHistory = engine.traitHistory;
  const traitY = graphY + graphH + 4;

  // Panel background
  ctx.fillStyle = isDark ? 'hsl(224,35%,8%)' : 'hsl(0,0%,93%)';
  ctx.fillRect(0, traitY, canvasW, traitH);

  // Border between population and trait strips
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, traitY); ctx.lineTo(canvasW, traitY);
  ctx.stroke();

  if (traitHistory.length < 2) return;

  // Each trait is normalised to its own genome clamp range so all three fit
  // one axis; species share a hue (green prey / red pred), traits differ by
  // dash pattern: speed solid, vision dashed, size dotted.
  const RANGES = {
    speed: [0.5, 5] as const,
    vision: [15, 200] as const,
    size: [2, 15] as const,
  };
  const norm = (val: number, [lo, hi]: readonly [number, number]) => (val - lo) / (hi - lo);

  const tx = (i: number) => (i / (traitHistory.length - 1)) * canvasW;
  const ty = (n: number) => traitY + traitH - clamp(n, 0, 1) * (traitH - 10) - 5;

  const drawTrait = (
    pick: (s: TraitSnapshot) => number,
    range: readonly [number, number],
    color: string,
    dash: number[],
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i < traitHistory.length; i++) {
      const x = tx(i), y = ty(norm(pick(traitHistory[i]), range));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  drawTrait(s => s.preySpeed, RANGES.speed, preyColor, []);
  drawTrait(s => s.preyVision, RANGES.vision, preyColor, [4, 3]);
  drawTrait(s => s.preySize, RANGES.size, preyColor, [1, 3]);
  drawTrait(s => s.predSpeed, RANGES.speed, predColor, []);
  drawTrait(s => s.predVision, RANGES.vision, predColor, [4, 3]);
  drawTrait(s => s.predSize, RANGES.size, predColor, [1, 3]);
  ctx.setLineDash([]);

  // Legend + current values (latest sample)
  const last = traitHistory[traitHistory.length - 1];
  ctx.fillStyle = labelColor;
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText(
    `trait drift  ·  ─ speed  ┄ vision  ┈ size`,
    4, traitY + 12,
  );
  ctx.fillText(
    `prey  spd ${last.preySpeed.toFixed(1)}  vis ${last.preyVision.toFixed(0)}  sz ${last.preySize.toFixed(1)}`,
    4, traitY + traitH - 14,
  );
  ctx.fillText(
    `pred  spd ${last.predSpeed.toFixed(1)}  vis ${last.predVision.toFixed(0)}  sz ${last.predSize.toFixed(1)}`,
    4, traitY + traitH - 3,
  );
}

// ── React Component ──────────────────────────────────────────────────────

const EcosystemSim = () => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EcosystemEngine | null>(null);
  const rafRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [running, setRunning] = useState(false);
  const [showTraits, setShowTraits] = useState(true);
  const showTraitsRef = useRef(showTraits);
  showTraitsRef.current = showTraits;
  const [tick, setTick] = useState(0);
  const [preyCount, setPreyCount] = useState(0);
  const [predCount, setPredCount] = useState(0);
  const [foodCount, setFoodCount] = useState(0);
  const [speed, setSpeed] = useState(30);
  const [foodRate, setFoodRate] = useState(3);
  const [mutRate, setMutRate] = useState(0.3);

  const WORLD_W = 800;
  const WORLD_H = 600;

  // Init engine
  if (!engineRef.current) {
    engineRef.current = new EcosystemEngine(WORLD_W, WORLD_H, 80, 15, foodRate, mutRate);
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawEcosystem(ctx, engine, canvas.width, canvas.height, themeRef.current === 'dark', showTraitsRef.current);
  }, []);

  // Resize
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      canvasSizeRef.current = { w, h };
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = w; canvas.height = h; redraw(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // Update engine params
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.foodSpawnRate = foodRate;
      engineRef.current.mutationRate = mutRate;
    }
  }, [foodRate, mutRate]);

  // Simulation loop (time-based: speed = ticks per second)
  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;

    let lastTime = performance.now();
    let accumulator = 0;

    const loop = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      accumulator += dt;

      const interval = 1000 / speed;
      const maxSteps = Math.min(Math.floor(accumulator / interval), 10);
      if (maxSteps > 0) {
        for (let i = 0; i < maxSteps; i++) engine.step();
        accumulator -= maxSteps * interval;
        setTick(engine.tick);
        setPreyCount(engine.agents.filter(a => a.type === 'prey').length);
        setPredCount(engine.agents.filter(a => a.type === 'predator').length);
        setFoodCount(engine.food.length);
      }
      redraw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [running, speed, redraw]);

  useEffect(() => { redraw(); }, [theme, showTraits, redraw]);

  const handleReset = useCallback(() => {
    setRunning(false);
    engineRef.current = new EcosystemEngine(WORLD_W, WORLD_H, 80, 15, foodRate, mutRate);
    setTick(0); setPreyCount(80); setPredCount(15); setFoodCount(200);
    redraw();
  }, [foodRate, mutRate, redraw]);

  // Compute avg traits (single pass, memoised per tick so it only recomputes
  // when the sim actually advances, not on every unrelated re-render)
  const { avgPreySpeed, avgPredSpeed } = useMemo(() => {
    const engine = engineRef.current;
    let preyN = 0, preySpeedSum = 0, predN = 0, predSpeedSum = 0;
    if (engine) {
      for (const a of engine.agents) {
        if (a.type === 'prey') { preyN++; preySpeedSum += a.genome.speed; }
        else { predN++; predSpeedSum += a.genome.speed; }
      }
    }
    return {
      avgPreySpeed: preyN > 0 ? (preySpeedSum / preyN).toFixed(1) : '-',
      avgPredSpeed: predN > 0 ? (predSpeedSum / predN).toFixed(1) : '-',
    };
  }, [tick]);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-2 bg-card rounded-lg border border-border">
        <div className="flex items-center gap-1">
          <Button variant="default" size="sm" className="h-7 w-7 p-0" onClick={() => setRunning(!running)} title={running ? 'Pause' : 'Play'}>
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
          </Button>
        </div>

        <div className="w-px h-5 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              <Slider value={[speed]} onValueChange={(v) => setSpeed(v[0])} min={5} max={300} step={5} className="w-20" />
              <span className="text-[10px] text-muted-foreground w-10 tabular-nums">{speed}t/s</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Simulation speed &mdash; ticks per second</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Leaf className="h-3 w-3 text-muted-foreground" />
              <Slider value={[foodRate]} onValueChange={(v) => setFoodRate(v[0])} min={1} max={15} step={1} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-8 tabular-nums">{foodRate}/t</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Food spawn rate &mdash; new food particles per tick. More food favors prey growth.</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Mut</span>
              <Slider value={[mutRate]} onValueChange={(v) => setMutRate(v[0])} min={0.05} max={0.8} step={0.05} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-8 tabular-nums">{(mutRate * 100).toFixed(0)}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Mutation rate &mdash; how much offspring traits vary from parents. Higher = faster adaptation but less stability.</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={handleReset}>
          <RotateCcw className="h-3 w-3" /> Reset
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showTraits ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs gap-1 px-2"
              onClick={() => setShowTraits(v => !v)}
            >
              <LineChart className="h-3 w-3" /> Traits
            </Button>
          </TooltipTrigger>
          <TooltipContent>Trait drift &mdash; show/hide the average speed/vision/size chart to watch traits evolve under selection.</TooltipContent>
        </Tooltip>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Tick</span>
            <span className="font-mono tabular-nums font-medium">{tick.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            <span className="font-mono tabular-nums font-medium">{preyCount}</span>
            <span className="text-muted-foreground text-[10px]">({avgPreySpeed}v)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
            <span className="font-mono tabular-nums font-medium">{predCount}</span>
            <span className="text-muted-foreground text-[10px]">({avgPredSpeed}v)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Leaf className="h-3 w-3 text-green-500" />
            <span className="font-mono tabular-nums font-medium">{foodCount}</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapperRef} className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden bg-card">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
};

export default EcosystemSim;
