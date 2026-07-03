'use client';

import PolarClock from '@/components/PolarClock';
import GSMOL from '@/components/GSMOL';
import { Door } from './door';

// ── 05 · Polar Clock — the real thing, ticking ──

export function PolarRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/polar-clock" number="RM 05" room="Polar Clock" className={className}>
      <div className="pointer-events-none flex h-full items-center justify-center bg-[hsl(240_15%_5%)]">
        <PolarClock width={280} height={280} />
      </div>
    </Door>
  );
}

// ── 06 · Game of Life — live cells behind glass ──

export function GolRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/gol" number="RM 06" room="Game of Life" className={className}>
      <div className="pointer-events-none flex h-full items-center justify-center overflow-hidden bg-zinc-950">
        <GSMOL width={400} height={176} cellSize={8} minimal />
      </div>
    </Door>
  );
}

// ── 11 · Room Planner — a blueprint pinned to the wall ──

export function HouseRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/house" number="RM 11" room="Planner" className={className}>
      <div
        className="relative h-full"
        style={{
          background: 'hsl(217 65% 26%)',
          backgroundImage: `
            linear-gradient(to right, hsl(0 0% 100% / 0.08) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(0 0% 100% / 0.08) 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
        }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* room outline + interior wall + door swing arc */}
          <g fill="none" stroke="hsl(0 0% 100% / 0.85)" strokeWidth="1.4">
            <rect x="18" y="16" width="64" height="58" />
            <line x1="50" y1="16" x2="50" y2="46" />
            <line x1="18" y1="52" x2="40" y2="52" />
          </g>
          <path d="M 58 74 A 14 14 0 0 1 72 60" fill="none" stroke="hsl(0 0% 100% / 0.5)" strokeWidth="1" strokeDasharray="2.5 2.5" />
          <line x1="58" y1="74" x2="58" y2="60" stroke="hsl(0 0% 100% / 0.85)" strokeWidth="1.4" />
          <text x="26" y="34" fill="hsl(0 0% 100% / 0.45)" fontSize="5" fontFamily="monospace" letterSpacing="1">PLAN A-01</text>
        </svg>
      </div>
    </Door>
  );
}

// ── 12 · Ecosystem — critters drifting on a night meadow ──

const CRITTERS = [
  { x: 22, y: 26, r: 3.5, hue: 150, dur: 7.5, delay: 0 },
  { x: 62, y: 20, r: 2.5, hue: 90, dur: 9, delay: 1.2 },
  { x: 44, y: 52, r: 4.5, hue: 160, dur: 8, delay: 2.4 },
  { x: 76, y: 58, r: 3, hue: 45, dur: 6.5, delay: 0.8 },
  { x: 28, y: 70, r: 2.5, hue: 100, dur: 10, delay: 3 },
  { x: 68, y: 78, r: 3.5, hue: 150, dur: 7, delay: 1.8 },
];
const FOOD = [
  [14, 44], [36, 32], [56, 66], [82, 30], [48, 84], [88, 74], [20, 86],
] as const;

export function EcosystemRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/ecosystem" number="RM 12" room="Ecosystem" className={className}>
      <div className="relative h-full overflow-hidden bg-gradient-to-b from-[hsl(160_45%_8%)] to-[hsl(150_40%_13%)]">
        {FOOD.map(([x, y], i) => (
          <span
            key={i}
            className="absolute h-[3px] w-[3px] rounded-full bg-lime-300/50"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
        {CRITTERS.map((c, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              width: c.r * 2,
              height: c.r * 2,
              background: `hsl(${c.hue} 70% 55%)`,
              boxShadow: `0 0 8px hsl(${c.hue} 70% 55% / 0.5)`,
              animation: `hall-drift ${c.dur}s ease-in-out ${c.delay}s infinite`,
            }}
          />
        ))}
      </div>
    </Door>
  );
}

// ── 13 · Neuroevolution — cars learning the track ──

export function NeuroRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/neuroevolution" number="RM 13" room="Driving School" className={className}>
      <div className="h-full bg-zinc-950">
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          {/* track edges */}
          <path d="M -5 78 C 25 78 30 38 55 38 S 80 66 108 60" fill="none" stroke="hsl(240 8% 26%)" strokeWidth="1.6" />
          <path d="M -5 58 C 22 58 30 20 55 20 S 82 48 108 42" fill="none" stroke="hsl(240 8% 26%)" strokeWidth="1.6" />
          {/* centerline crawls forward */}
          <path
            d="M -5 68 C 24 68 30 29 55 29 S 81 57 108 51"
            fill="none" stroke="hsl(265 85% 68%)" strokeWidth="1"
            strokeDasharray="5 7" style={{ animation: 'hall-dash 1.6s linear infinite' }}
          />
          {/* the car */}
          <g transform="translate(42 40) rotate(-18)">
            <rect x="-4" y="-2.5" width="8" height="5" rx="1.2" fill="hsl(265 85% 68%)" />
            <line x1="4" y1="0" x2="13" y2="-3" stroke="hsl(184 90% 60% / 0.5)" strokeWidth="0.7" />
            <line x1="4" y1="0" x2="13" y2="3" stroke="hsl(184 90% 60% / 0.5)" strokeWidth="0.7" />
          </g>
          {/* a straggler that hasn't learned yet */}
          <rect x="12" y="70" width="7" height="4.5" rx="1" fill="hsl(240 8% 34%)" transform="rotate(24 15 72)" />
          {/* tiny brain, top-right */}
          <g stroke="hsl(184 90% 60% / 0.4)" strokeWidth="0.6">
            <line x1="76" y1="12" x2="86" y2="9" /><line x1="76" y1="12" x2="86" y2="17" />
            <line x1="76" y1="22" x2="86" y2="9" /><line x1="76" y1="22" x2="86" y2="17" />
            <line x1="86" y1="9" x2="94" y2="13" /><line x1="86" y1="17" x2="94" y2="13" />
          </g>
          <g fill="hsl(184 90% 60%)">
            <circle cx="76" cy="12" r="1.7" /><circle cx="76" cy="22" r="1.7" />
            <circle cx="86" cy="9" r="1.7" /><circle cx="86" cy="17" r="1.7" />
            <circle cx="94" cy="13" r="1.7" fill="hsl(265 85% 68%)" />
          </g>
        </svg>
      </div>
    </Door>
  );
}

// ── 14 · Image Evolver — translucent triangles mid-evolution ──

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic (fixed seed): same triangles server- and client-side.
const TRIANGLES = (() => {
  const rand = mulberry32(20260703);
  const hues = [12, 32, 200, 265, 340, 45];
  return Array.from({ length: 26 }, () => {
    const cx = rand() * 100, cy = rand() * 100, s = 12 + rand() * 30;
    const pts = Array.from({ length: 3 }, () =>
      `${(cx + (rand() - 0.5) * s).toFixed(1)},${(cy + (rand() - 0.5) * s).toFixed(1)}`
    ).join(' ');
    return { pts, hue: hues[Math.floor(rand() * hues.length)], o: 0.18 + rand() * 0.4 };
  });
})();

export function ImageEvolverRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/image-evolver" number="RM 14" room="Image Evolver" className={className}>
      <svg viewBox="0 0 100 100" className="h-full w-full bg-zinc-950" preserveAspectRatio="none">
        {TRIANGLES.map((t, i) => (
          <polygon key={i} points={t.pts} fill={`hsl(${t.hue} 75% 58% / ${t.o})`} />
        ))}
      </svg>
    </Door>
  );
}
