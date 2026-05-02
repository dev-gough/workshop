'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Play, Pause, RotateCcw, Gauge, Map as MapIcon, Eye, EyeOff,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ── Math helpers ─────────────────────────────────────────────────────────

function gaussRand(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Track Generation ─────────────────────────────────────────────────────

interface Point { x: number; y: number; }
type Segment = [number, number, number, number]; // x1,y1,x2,y2

interface Track {
  centerline: Point[];
  innerWalls: Segment[];
  outerWalls: Segment[];
  startPos: Point;
  startHeading: number;
  width: number;
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function generateTrack(cx: number, cy: number): Track {
  const numPoints = 8 + Math.floor(Math.random() * 4);
  const controlPoints: Point[] = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const radius = 140 + Math.random() * 100;
    controlPoints.push({
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
    });
  }

  // Generate dense centerline via Catmull-Rom
  const centerline: Point[] = [];
  const stepsPerSegment = 30;
  for (let i = 0; i < numPoints; i++) {
    const p0 = controlPoints[(i - 1 + numPoints) % numPoints];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % numPoints];
    const p3 = controlPoints[(i + 2) % numPoints];
    for (let j = 0; j < stepsPerSegment; j++) {
      centerline.push(catmullRom(p0, p1, p2, p3, j / stepsPerSegment));
    }
  }

  const trackWidth = 35;

  // Compute normals and wall segments
  const innerWalls: Segment[] = [];
  const outerWalls: Segment[] = [];
  const innerPts: Point[] = [];
  const outerPts: Point[] = [];

  for (let i = 0; i < centerline.length; i++) {
    const next = centerline[(i + 1) % centerline.length];
    const dx = next.x - centerline[i].x;
    const dy = next.y - centerline[i].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    innerPts.push({ x: centerline[i].x + nx * trackWidth, y: centerline[i].y + ny * trackWidth });
    outerPts.push({ x: centerline[i].x - nx * trackWidth, y: centerline[i].y - ny * trackWidth });
  }

  for (let i = 0; i < innerPts.length; i++) {
    const j = (i + 1) % innerPts.length;
    innerWalls.push([innerPts[i].x, innerPts[i].y, innerPts[j].x, innerPts[j].y]);
    outerWalls.push([outerPts[i].x, outerPts[i].y, outerPts[j].x, outerPts[j].y]);
  }

  const startHeading = Math.atan2(
    centerline[1].y - centerline[0].y,
    centerline[1].x - centerline[0].x,
  );

  return {
    centerline,
    innerWalls,
    outerWalls,
    startPos: { x: centerline[0].x, y: centerline[0].y },
    startHeading,
    width: trackWidth,
  };
}

// ── Raycasting ───────────────────────────────────────────────────────────

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

function castRay(ox: number, oy: number, angle: number, walls: Segment[]): number {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let minDist = Infinity;
  for (const [x1, y1, x2, y2] of walls) {
    const d = raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ── Neural Network ───────────────────────────────────────────────────────

const SENSOR_COUNT = 7;
const HIDDEN_SIZE = 8;
const INPUT_SIZE = SENSOR_COUNT + 1; // sensors + speed
const OUTPUT_SIZE = 2; // steer, throttle
const GENOME_SIZE = (INPUT_SIZE * HIDDEN_SIZE) + HIDDEN_SIZE + (HIDDEN_SIZE * OUTPUT_SIZE) + OUTPUT_SIZE;

function createGenome(): number[] {
  const g: number[] = [];
  for (let i = 0; i < GENOME_SIZE; i++) g.push((Math.random() - 0.5) * 2);
  return g;
}

function feedForward(genome: number[], inputs: number[]): [number, number] {
  let idx = 0;

  // Input -> Hidden (ReLU)
  const hidden: number[] = new Array(HIDDEN_SIZE);
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = 0;
    for (let i = 0; i < INPUT_SIZE; i++) {
      sum += inputs[i] * genome[idx++];
    }
    sum += genome[idx++]; // bias
    hidden[h] = sum > 0 ? sum : 0; // ReLU
  }

  // Hidden -> Output (tanh)
  const output: number[] = new Array(OUTPUT_SIZE);
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    let sum = 0;
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      sum += hidden[h] * genome[idx++];
    }
    sum += genome[idx++]; // bias
    output[o] = Math.tanh(sum);
  }

  return [output[0], output[1]];
}

// ── Car ──────────────────────────────────────────────────────────────────

interface Car {
  x: number; y: number;
  heading: number;
  speed: number;
  alive: boolean;
  fitness: number;
  genome: number[];
  sensors: number[];
  trackProgress: number;
  stuckTimer: number;
  lastProgress: number;
}

const MAX_SPEED = 4;
const MAX_TURN = 0.08;
const ACCEL = 0.15;
const FRICTION = 0.98;
const MAX_SENSOR_DIST = 200;
const CAR_RADIUS = 6;

function createCar(track: Track, genome: number[]): Car {
  return {
    x: track.startPos.x,
    y: track.startPos.y,
    heading: track.startHeading,
    speed: 0,
    alive: true,
    fitness: 0,
    genome,
    sensors: new Array(SENSOR_COUNT).fill(1),
    trackProgress: 0,
    stuckTimer: 0,
    lastProgress: 0,
  };
}

function updateCar(car: Car, track: Track, allWalls: Segment[]) {
  if (!car.alive) return;

  // Sensor readings
  const sensorSpread = Math.PI * 0.7;
  for (let i = 0; i < SENSOR_COUNT; i++) {
    const angle = car.heading + (-sensorSpread / 2 + (sensorSpread / (SENSOR_COUNT - 1)) * i);
    const d = castRay(car.x, car.y, angle, allWalls);
    car.sensors[i] = clamp(d / MAX_SENSOR_DIST, 0, 1);
  }

  // NN inputs
  const inputs = [...car.sensors, car.speed / MAX_SPEED];
  const [steer, throttle] = feedForward(car.genome, inputs);

  // Physics
  car.heading += steer * MAX_TURN;
  car.speed += throttle * ACCEL;
  car.speed *= FRICTION;
  car.speed = clamp(car.speed, 0, MAX_SPEED);

  car.x += Math.cos(car.heading) * car.speed;
  car.y += Math.sin(car.heading) * car.speed;

  // Collision check
  for (const [x1, y1, x2, y2] of allWalls) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = clamp(((car.x - x1) * dx + (car.y - y1) * dy) / len2, 0, 1);
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const dist = Math.sqrt((car.x - cx) * (car.x - cx) + (car.y - cy) * (car.y - cy));
    if (dist < CAR_RADIUS) { car.alive = false; return; }
  }

  // Update fitness (track progress)
  const cl = track.centerline;
  let bestDist = Infinity, bestIdx = car.trackProgress;
  const searchStart = Math.max(0, car.trackProgress - 5);
  const searchEnd = Math.min(cl.length - 1, car.trackProgress + 30);
  for (let i = searchStart; i <= searchEnd; i++) {
    const dx = car.x - cl[i].x, dy = car.y - cl[i].y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  // Handle wrap-around
  if (car.trackProgress > cl.length - 50) {
    for (let i = 0; i < 30; i++) {
      const dx = car.x - cl[i].x, dy = car.y - cl[i].y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i + cl.length; }
    }
  }
  if (bestIdx > car.trackProgress) car.trackProgress = bestIdx;
  car.fitness = car.trackProgress;

  // Stuck detection
  if (car.fitness === car.lastProgress) {
    car.stuckTimer++;
    if (car.stuckTimer > 120) car.alive = false;
  } else {
    car.stuckTimer = 0;
    car.lastProgress = car.fitness;
  }
}

// ── GA ───────────────────────────────────────────────────────────────────

function tournamentSelect(cars: Car[], k: number = 3): Car {
  let best: Car | null = null;
  for (let i = 0; i < k; i++) {
    const c = cars[Math.floor(Math.random() * cars.length)];
    if (!best || c.fitness > best.fitness) best = c;
  }
  return best!;
}

function evolve(cars: Car[], mutRate: number, mutStrength: number): number[][] {
  cars.sort((a, b) => b.fitness - a.fitness);
  const eliteCount = Math.max(2, Math.floor(cars.length * 0.1));
  const genomes: number[][] = [];

  // Elites
  for (let i = 0; i < eliteCount; i++) {
    genomes.push([...cars[i].genome]);
  }

  // Fill rest
  while (genomes.length < cars.length) {
    const a = tournamentSelect(cars);
    const b = tournamentSelect(cars);
    // Uniform crossover
    const child: number[] = new Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
      child[i] = Math.random() < 0.5 ? a.genome[i] : b.genome[i];
    }
    // Mutation
    for (let i = 0; i < GENOME_SIZE; i++) {
      if (Math.random() < mutRate) {
        child[i] += gaussRand() * mutStrength;
      }
    }
    genomes.push(child);
  }

  return genomes;
}

// ── Drawing ──────────────────────────────────────────────────────────────

function drawScene(
  ctx: CanvasRenderingContext2D,
  track: Track,
  cars: Car[],
  canvasW: number,
  canvasH: number,
  isDark: boolean,
  showSensors: boolean,
  camX: number,
  camY: number,
  camScale: number,
) {
  const bgColor = isDark ? 'hsl(224,35%,11%)' : 'hsl(0,0%,96%)';
  const trackColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
  const wallColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(camScale, camScale);
  ctx.translate(-camX, -camY);

  // Track surface (fill between walls)
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  ctx.beginPath();
  for (let i = 0; i < track.outerWalls.length; i++) {
    const [x1, y1] = track.outerWalls[i];
    i === 0 ? ctx.moveTo(x1, y1) : ctx.lineTo(x1, y1);
  }
  ctx.closePath();
  // Cut out inner
  for (let i = track.innerWalls.length - 1; i >= 0; i--) {
    const [x1, y1] = track.innerWalls[i];
    i === track.innerWalls.length - 1 ? ctx.moveTo(x1, y1) : ctx.lineTo(x1, y1);
  }
  ctx.closePath();
  ctx.fill('evenodd');

  // Centerline
  ctx.strokeStyle = trackColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  for (let i = 0; i < track.centerline.length; i++) {
    const p = track.centerline[i];
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Walls
  ctx.strokeStyle = wallColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of track.innerWalls) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  for (const [x1, y1, x2, y2] of track.outerWalls) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();

  // Start line
  ctx.strokeStyle = isDark ? 'rgba(74,222,128,0.5)' : 'rgba(22,163,74,0.5)';
  ctx.lineWidth = 3;
  const sp = track.startPos;
  const sn = track.startHeading + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(sp.x + Math.cos(sn) * track.width, sp.y + Math.sin(sn) * track.width);
  ctx.lineTo(sp.x - Math.cos(sn) * track.width, sp.y - Math.sin(sn) * track.width);
  ctx.stroke();

  // Cars
  const sorted = [...cars].sort((a, b) => a.fitness - b.fitness);
  const best = sorted[sorted.length - 1];

  for (const car of sorted) {
    const isBest = car === best;
    const alpha = car.alive ? (isBest ? 1 : 0.6) : 0.1;

    ctx.globalAlpha = alpha;

    // Car body
    const h = car.heading;
    const r = CAR_RADIUS;
    if (isBest && car.alive) {
      ctx.fillStyle = isDark ? '#facc15' : '#ca8a04';
    } else if (car.alive) {
      ctx.fillStyle = isDark ? '#60a5fa' : '#2563eb';
    } else {
      ctx.fillStyle = isDark ? '#555' : '#999';
    }

    ctx.beginPath();
    ctx.moveTo(car.x + Math.cos(h) * r * 1.5, car.y + Math.sin(h) * r * 1.5);
    ctx.lineTo(car.x + Math.cos(h + 2.4) * r, car.y + Math.sin(h + 2.4) * r);
    ctx.lineTo(car.x + Math.cos(h - 2.4) * r, car.y + Math.sin(h - 2.4) * r);
    ctx.closePath();
    ctx.fill();

    // Sensors for best
    if (showSensors && isBest && car.alive) {
      ctx.strokeStyle = isDark ? 'rgba(250,204,21,0.4)' : 'rgba(202,138,4,0.3)';
      ctx.lineWidth = 1;
      const sensorSpread = Math.PI * 0.7;
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const angle = car.heading + (-sensorSpread / 2 + (sensorSpread / (SENSOR_COUNT - 1)) * i);
        const d = car.sensors[i] * MAX_SENSOR_DIST;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(car.x + Math.cos(angle) * d, car.y + Math.sin(angle) * d);
        ctx.stroke();
        // Dot at end
        ctx.fillStyle = car.sensors[i] < 0.2 ? 'rgba(248,113,113,0.8)' : 'rgba(250,204,21,0.5)';
        ctx.beginPath();
        ctx.arc(car.x + Math.cos(angle) * d, car.y + Math.sin(angle) * d, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── React Component ──────────────────────────────────────────────────────

const Neuroevolution = () => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<Track | null>(null);
  const carsRef = useRef<Car[]>([]);
  const allWallsRef = useRef<Segment[]>([]);
  const rafRef = useRef<number>(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const camRef = useRef({ x: 0, y: 0, scale: 1 });
  const tickRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [bestFitness, setBestFitness] = useState(0);
  const [aliveCount, setAliveCount] = useState(0);
  const [speed, setSpeed] = useState(60);
  const [popSize, setPopSize] = useState(60);
  const [mutRate, setMutRate] = useState(0.15);
  const [mutStrength, setMutStrength] = useState(0.4);
  const [showSensors, setShowSensors] = useState(true);

  const generationRef = useRef(0);

  // Initialize track and cars
  const initSim = useCallback((existingGenomes?: number[][]) => {
    const { w, h } = canvasSizeRef.current;
    const cx = w > 0 ? w / 2 : 400;
    const cy = h > 0 ? h / 2 : 300;

    if (!trackRef.current) {
      trackRef.current = generateTrack(cx, cy);
    }
    const track = trackRef.current;
    allWallsRef.current = [...track.innerWalls, ...track.outerWalls];

    const cars: Car[] = [];
    for (let i = 0; i < popSize; i++) {
      const genome = existingGenomes && i < existingGenomes.length
        ? existingGenomes[i]
        : createGenome();
      cars.push(createCar(track, genome));
    }
    carsRef.current = cars;
    tickRef.current = 0;
  }, [popSize]);

  // Ensure initialized
  useEffect(() => {
    if (carsRef.current.length === 0) initSim();
  }, [initSim]);

  const newTrack = useCallback(() => {
    setRunning(false);
    trackRef.current = null;
    generationRef.current = 0;
    setGeneration(0);
    setBestFitness(0);
    initSim();
  }, [initSim]);

  const handleReset = useCallback(() => {
    setRunning(false);
    generationRef.current = 0;
    setGeneration(0);
    setBestFitness(0);
    initSim();
  }, [initSim]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cam = camRef.current;
    drawScene(ctx, track, carsRef.current, canvas.width, canvas.height, themeRef.current === 'dark', showSensors, cam.x, cam.y, cam.scale);
  }, [showSensors]);

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
      if (canvas) { canvas.width = w; canvas.height = h; }

      // Re-center camera if track exists
      if (trackRef.current) {
        const cl = trackRef.current.centerline;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of cl) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const trackW = maxX - minX + 100;
        const trackH = maxY - minY + 100;
        camRef.current.x = (minX + maxX) / 2;
        camRef.current.y = (minY + maxY) / 2;
        camRef.current.scale = Math.min(w / trackW, h / trackH, 1.5);
      }
      redraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // Simulation loop (time-based: speed = ticks per second)
  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }

    let lastTime = performance.now();
    let accumulator = 0;

    const loop = (now: number) => {
      const track = trackRef.current;
      const cars = carsRef.current;
      const allWalls = allWallsRef.current;
      if (!track || cars.length === 0) { rafRef.current = requestAnimationFrame(loop); return; }

      const dt = now - lastTime;
      lastTime = now;
      accumulator += dt;

      const interval = 1000 / speed;
      const maxSteps = Math.min(Math.floor(accumulator / interval), 15);

      for (let s = 0; s < maxSteps; s++) {
        const alive = cars.filter(c => c.alive);
        if (alive.length === 0 || tickRef.current > 2000) {
          // Evolve
          const genomes = evolve(cars, mutRate, mutStrength);
          const best = [...cars].sort((a, b) => b.fitness - a.fitness)[0];
          generationRef.current++;
          setGeneration(generationRef.current);
          setBestFitness(Math.round(best.fitness));

          // Reset cars
          for (let i = 0; i < cars.length; i++) {
            const newCar = createCar(track, i < genomes.length ? genomes[i] : createGenome());
            cars[i] = newCar;
          }
          while (cars.length < popSize) cars.push(createCar(track, createGenome()));
          cars.length = popSize;
          carsRef.current = cars;
          tickRef.current = 0;
          accumulator = 0;
          break;
        }

        for (const car of cars) updateCar(car, track, allWalls);
        tickRef.current++;
      }
      if (maxSteps > 0) accumulator -= maxSteps * interval;

      // Camera follows best alive car
      const aliveCars = cars.filter(c => c.alive);
      if (aliveCars.length > 0) {
        const best = aliveCars.reduce((a, b) => a.fitness > b.fitness ? a : b);
        const cam = camRef.current;
        cam.x = lerp(cam.x, best.x, 0.05);
        cam.y = lerp(cam.y, best.y, 0.05);
      }

      setAliveCount(cars.filter(c => c.alive).length);
      redraw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [running, speed, mutRate, mutStrength, popSize, redraw]);

  useEffect(() => { redraw(); }, [theme, redraw]);

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
              <Slider value={[speed]} onValueChange={(v) => setSpeed(v[0])} min={10} max={600} step={10} className="w-20" />
              <span className="text-[10px] text-muted-foreground w-10 tabular-nums">{speed}t/s</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Simulation speed &mdash; physics ticks per second</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Pop</span>
              <Slider value={[popSize]} onValueChange={(v) => setPopSize(v[0])} min={20} max={200} step={10} className="w-16" />
              <span className="text-[10px] text-muted-foreground w-6 tabular-nums">{popSize}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Population size &mdash; number of cars per generation. Larger populations explore more solutions.</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Mut</span>
              <Slider value={[mutRate]} onValueChange={(v) => setMutRate(v[0])} min={0.01} max={0.5} step={0.01} className="w-14" />
              <span className="text-[10px] text-muted-foreground w-8 tabular-nums">{(mutRate * 100).toFixed(0)}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Mutation rate &mdash; probability each neural network weight is perturbed. Higher = more exploration.</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 bg-border" />

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={newTrack}>
            <MapIcon className="h-3 w-3" /> New Track
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowSensors(!showSensors)} title="Toggle sensors">
            {showSensors ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Gen</span>
            <span className="font-mono tabular-nums font-medium">{generation}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Best</span>
            <span className="font-mono tabular-nums font-medium">{bestFitness}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Alive</span>
            <span className="font-mono tabular-nums font-medium">{aliveCount}/{popSize}</span>
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

export default Neuroevolution;
