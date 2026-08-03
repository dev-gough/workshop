'use client';

import { useEffect, useState } from 'react';
import GSMOL from '@/components/GSMOL';
import { Door } from './door';

// ── 05 · Polar Clock — the observatory, seen through the door ──
// A miniature of the room in the room's own theme (.pc-theme): the dome
// falling off toward the rim, a graduated bezel, three live rings, and the
// lamplit readout at the hub.

/** The head of the Indigo Teal palette — the room's own default rings. */
const DIAL_RINGS = [
  { r: 50, pct: (d: Date) => (d.getHours() + d.getMinutes() / 60) / 24, color: 'hsl(225,70%,60%)' },
  { r: 39, pct: (d: Date) => (d.getMinutes() + d.getSeconds() / 60) / 60, color: 'hsl(172,66%,45%)' },
  { r: 28, pct: (d: Date) => d.getSeconds() / 60, color: 'hsl(350,80%,62%)' },
];

// 12 graduations, precomputed so server and client agree on the markup.
const BEZEL = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
  return {
    x1: 64 + Math.cos(a) * 58, y1: 64 + Math.sin(a) * 58,
    x2: 64 + Math.cos(a) * 62, y2: 64 + Math.sin(a) * 62,
  };
});

export function PolarRoom({ className }: { className?: string }) {
  // Null until mounted: the clock can't agree with the server about "now",
  // and a hydration mismatch is a worse tile than half a second of dashes.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:-- --';
  const date = now
    ? now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  return (
    <Door href="/projects/polar-clock" number="RM 05" room="Polar Clock" className={className}>
      <div className="pc-theme pointer-events-none relative h-full overflow-hidden">
        {/* a verdigris glow off the instrument, then the dome's falloff */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 55% 90% at 76% 50%, rgba(87,207,182,0.13), transparent 68%)' }}
        />
        <div className="pc-vignette absolute inset-0" />

        <div className="relative flex h-full items-center justify-between gap-2 pl-4 pr-1">
          <div className="min-w-0">
            <p className="pc-etch text-[9px]">Observatory</p>
            <p className="pc-readout mt-1 text-xl font-semibold tracking-tight text-foreground">{time}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{date || ' '}</p>
          </div>

          <svg viewBox="0 0 128 128" className="h-[132px] w-[132px] shrink-0">
            {BEZEL.map((t, i) => (
              <line key={i} {...t} stroke="rgba(207,224,255,0.34)" strokeWidth={1} />
            ))}
            <circle cx={64} cy={64} r={58} fill="none" stroke="rgba(85,97,138,0.45)" strokeWidth={0.75} />
            {DIAL_RINGS.map(ring => {
              const circ = 2 * Math.PI * ring.r;
              const pct = now ? ring.pct(now) : 0;
              return (
                <g key={ring.r}>
                  <circle cx={64} cy={64} r={ring.r} fill="none" stroke="rgba(120,150,210,0.15)" strokeWidth={8} />
                  <circle
                    cx={64} cy={64} r={ring.r} fill="none"
                    stroke={ring.color} strokeWidth={8} strokeLinecap="round"
                    strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
                    transform="rotate(-90 64 64)"
                    opacity={0.9}
                  />
                </g>
              );
            })}
            <circle cx={64} cy={64} r={3} fill="#f2b76a" opacity={0.85} />
          </svg>
        </div>
      </div>
    </Door>
  );
}

// ── 16 · The Groove — a record half out of its sleeve ──
// The room's whole premise in one image: the groove IS the track. The
// ridge line across the label is a stretch of the road the wax makes.

const GROOVE_ROAD = (() => {
  // Deterministic, so server and client draw the same stretch of road.
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    const y = 0.5
      + Math.sin(x * 7.1) * 0.16
      + Math.sin(x * 17.3 + 1.1) * 0.07
      + Math.sin(x * 3.2 + 2.4) * 0.09;
    pts.push(`${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`);
  }
  return pts.join(' ');
})();

export function GrooveRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/groove" number="RM 16" room="The Groove" className={className}>
      {/* No background of its own: the scope paints it, so the tile is a
          paper sleeve in daylight and the shop after closing at night. */}
      <div className="groove-theme pointer-events-none relative h-full overflow-hidden">
        {/* The wax, running off the right edge of the door. `aspect-square`
            is load-bearing: a 50% border-radius on a tile-shaped box gives
            you an ellipse, not a record. */}
        <div className="gv-vinyl absolute -bottom-[32%] -right-[14%] aspect-square h-[164%]">
          <div className="gv-label-disc absolute left-1/2 top-1/2 aspect-square h-[26%] -translate-x-1/2 -translate-y-1/2" />
        </div>
        {/* The road cut into it — fading in from the left so it reads as
            running out of the groove rather than lying on the sleeve. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-[38%] h-[34%] w-full"
          style={{ maskImage: 'linear-gradient(90deg, transparent, #000 26%)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 26%)' }}
        >
          <polyline points={GROOVE_ROAD} fill="none" stroke="#e8663a" strokeWidth="2.4" opacity="0.9" />
          <polyline points={GROOVE_ROAD} fill="none" stroke="#ffd9a8" strokeWidth="0.8" opacity="0.6" />
        </svg>
        <div className="absolute left-3 top-3">
          <p className="text-[8px] font-semibold uppercase tracking-[0.2em] text-primary">Side A</p>
          <p className="mt-0.5 text-[11px] font-medium text-foreground">Ride the groove</p>
        </div>
      </div>
    </Door>
  );
}

// ── 06 · Game of Life — chalk cells living on the seminar slate ──

export function GolRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/gol" number="RM 06" room="Game of Life" className={className}>
      <div className="pointer-events-none relative flex h-full items-center justify-center overflow-hidden bg-[#0e1513]">
        <GSMOL width={400} height={176} cellSize={8} minimal cellColor="#ece7d8" />
        {/* chalked rule notation, bottom corner of the board */}
        <span className="absolute bottom-1.5 right-2.5 font-mono text-[9px] tracking-widest text-[#ece7d8]/50">
          B3/S23
        </span>
      </div>
    </Door>
  );
}

// ── 11 · Room Planner — a blueprint pinned to the wall ──

export function HouseRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/house" number="RM 11" room="Drafting Room" className={className}>
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

// ── 12 · The Vivarium — a lit tank set into the cabinetry ──
// A miniature of the room: grazers as discs, hunters as arrowheads, plants as
// pollen specks, all on peat under the lamp. Positions are hand-placed rather
// than random so the server and the client agree on the scene.

const GRAZERS = [
  { x: 20, y: 34, r: 3.4, dur: 8, delay: 0 },
  { x: 47, y: 24, r: 2.6, dur: 9.5, delay: 1.4 },
  { x: 34, y: 62, r: 4.2, dur: 7.5, delay: 2.6 },
  { x: 71, y: 52, r: 3, dur: 10, delay: 0.7 },
  { x: 58, y: 76, r: 2.4, dur: 8.5, delay: 3.1 },
];
// Hunters point where they're headed — the arrowhead is the heading.
const HUNTERS = [
  { x: 80, y: 28, rot: 205 },
  { x: 26, y: 80, rot: 340 },
];
const POLLEN = [
  [12, 52], [30, 20], [41, 44], [55, 60], [64, 32], [76, 70], [88, 46],
  [18, 66], [50, 88], [84, 84], [38, 14], [68, 14],
] as const;

export function EcosystemRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/ecosystem" number="RM 12" room="The Vivarium" className={className}>
      <div className="relative h-full overflow-hidden bg-[#171c17] p-[7px]">
        <div className="relative h-full w-full overflow-hidden rounded-[2px] bg-[#0d120d] ring-1 ring-white/[0.07]">
          {/* the lamp, pooling from above */}
          <div
            className="absolute inset-x-0 top-0 h-2/3"
            style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(221,164,63,0.13), transparent 70%)' }}
          />
          {POLLEN.map(([x, y], i) => (
            <span
              key={i}
              className="absolute h-[2px] w-[2px] bg-[#d3d089]/70"
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          ))}
          {GRAZERS.map((g, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-[#6cc190]"
              style={{
                left: `${g.x}%`,
                top: `${g.y}%`,
                width: g.r * 2,
                height: g.r * 2,
                boxShadow: '0 0 7px rgba(108,193,144,0.45)',
                animation: `hall-drift ${g.dur}s ease-in-out ${g.delay}s infinite`,
              }}
            />
          ))}
          {HUNTERS.map((h, i) => (
            <span
              key={i}
              className="absolute h-0 w-0"
              style={{
                left: `${h.x}%`,
                top: `${h.y}%`,
                borderTop: '3px solid transparent',
                borderBottom: '3px solid transparent',
                borderLeft: '8px solid #e2624e',
                transform: `rotate(${h.rot}deg)`,
                filter: 'drop-shadow(0 0 5px rgba(226,98,78,0.45))',
              }}
            />
          ))}
        </div>
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

// ── 15 · Megabonk — the damage foundry: a molten impact + bracket bar ──

// The bracket palette echoes the room's own viz (main/flat/crit/…).
const MB_BAR = [
  { w: 34, c: '#f2a71c' }, // Damage %
  { w: 22, c: '#e8433f' }, // Crit
  { w: 15, c: '#e8743b' }, // Base damage
  { w: 12, c: '#37b24d' }, // Tome
  { w: 9, c: '#3b82f6' },  // Attack speed
  { w: 8, c: '#a855f7' },  // Elite
];

export function MegabonkRoom({ className }: { className?: string }) {
  return (
    <Door href="/projects/megabonk" number="RM 15" room="Megabonk" className={className}>
      <div className="relative h-full overflow-hidden bg-[#14110b]">
        {/* molten heat behind the number */}
        <div
          className="absolute left-1/2 top-[42%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, #f2ac1c, transparent 66%)', opacity: 0.22 }}
        />
        {/* impact starburst */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <polygon
            points="50,10 57,34 78,22 64,42 90,46 64,52 76,74 54,60 50,86 44,62 24,74 36,52 12,48 36,42 24,24 44,36"
            fill="#f2ac1c" opacity="0.14"
          />
        </svg>
        {/* the molten multiplier — the room's whole promise in one number */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-[58%] text-center">
          <div
            className="font-mono text-4xl font-bold tracking-tight"
            style={{
              background: 'linear-gradient(180deg,#ffd873,#f2ac1c 55%,#d97706)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            ×248
          </div>
          <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.2em] text-[#a99a7b]">
            total damage
          </div>
        </div>
        {/* a mini damage bar — each thing's share, echoing the real viz */}
        <div className="absolute inset-x-4 bottom-8 flex h-2 overflow-hidden rounded-full ring-1 ring-white/10">
          {MB_BAR.map((s, i) => (
            <span key={i} style={{ width: `${s.w}%`, background: s.c }} />
          ))}
        </div>
      </div>
    </Door>
  );
}
