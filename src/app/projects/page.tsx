'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Clock, Grid3X3, Home, Music, Trophy, Server, ArrowRight, Palette, Bug, Brain, Atom, Share2, Film, Wallet, Code2 } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { motion } from 'motion/react';
import { useAudio } from '@/components/AudioProvider';

// ── Decorative visuals per project ──

function PolarClockVisual() {
  const rings = [
    { r: 52, pct: 0.72, color: 'hsl(225,70%,60%)' },
    { r: 40, pct: 0.45, color: 'hsl(172,66%,45%)' },
    { r: 28, pct: 0.88, color: 'hsl(350,80%,62%)' },
  ];
  return (
    <svg viewBox="0 0 120 120" className="w-28 h-28 flex-shrink-0">
      {rings.map((ring, i) => {
        const circ = 2 * Math.PI * ring.r;
        const dash = circ * ring.pct;
        return (
          <g key={i}>
            <circle cx={60} cy={60} r={ring.r} fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={8} />
            <circle cx={60} cy={60} r={ring.r} fill="none" stroke={ring.color} strokeWidth={8}
              strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
              transform="rotate(-90 60 60)" opacity={0.85}>
              <animateTransform attributeName="transform" type="rotate"
                from="-90 60 60" to="270 60 60" dur={`${30 + i * 20}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
      <text x={60} y={60} textAnchor="middle" dominantBaseline="middle"
        fontSize={10} fill="white" opacity={0.6} fontFamily="monospace" fontWeight={700}>
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </text>
    </svg>
  );
}

function GOLVisual() {
  // Glider and block patterns
  const alive = new Set([
    '2,0', '3,1', '1,2', '2,2', '3,2',
    '6,1', '7,1', '6,2', '7,2',
    '10,3', '11,4', '10,4', '11,3',
    '0,5', '1,5', '1,6',
  ]);
  const rows = 8, cols = 14;
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const on = alive.has(`${c},${r}`);
        return (
          <div key={i} className="aspect-square rounded-[1px]"
            style={{ backgroundColor: on ? 'rgba(74,222,128,0.7)' : 'rgba(74,222,128,0.06)', width: 8, height: 8 }} />
        );
      })}
    </div>
  );
}

function RoomPlannerVisual() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-20 opacity-40">
      {/* Grid lines */}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`h${i}`} x1={0} x2={100} y1={i * 16} y2={i * 16} stroke="currentColor" strokeOpacity={0.12} strokeWidth={0.5} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={`v${i}`} x1={i * 16.67} x2={i * 16.67} y1={0} y2={80} stroke="currentColor" strokeOpacity={0.12} strokeWidth={0.5} />
      ))}
      {/* Furniture silhouettes */}
      <rect x={10} y={10} width={25} height={15} rx={2} fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.5} />
      <rect x={45} y={25} width={12} height={12} rx={1} fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.5} />
      <rect x={65} y={8} width={20} height={30} rx={2} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.2} strokeWidth={0.5} />
      <circle cx={25} cy={55} r={8} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.2} strokeWidth={0.5} />
    </svg>
  );
}

function BarFooVisual() {
  const { isPlaying, getFrequencyData } = useAudio();
  const [bars, setBars] = useState<number[]>([0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.6, 0.45, 0.75, 0.55, 0.85, 0.35, 0.65, 0.5, 0.7]);
  const rafRef = useRef<number>(0);
  const liveRef = useRef(false);

  const tick = useCallback(() => {
    const data = getFrequencyData();
    if (data && data.some(v => v > 0)) {
      liveRef.current = true;
      // Sample 15 bars from the frequency data (skip first bin, focus on audible range)
      const count = 15;
      const step = Math.max(1, Math.floor((data.length - 1) / count));
      const newBars = Array.from({ length: count }, (_, i) => {
        const val = data[Math.min(1 + i * step, data.length - 1)];
        return Math.max(0.04, val / 255);
      });
      setBars(newBars);
    } else if (liveRef.current) {
      liveRef.current = false;
      setBars([0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.6, 0.45, 0.75, 0.55, 0.85, 0.35, 0.65, 0.5, 0.7]);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [getFrequencyData]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    } else if (liveRef.current) {
      liveRef.current = false;
      setBars([0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.6, 0.45, 0.75, 0.55, 0.85, 0.35, 0.65, 0.5, 0.7]);
    }
  }, [isPlaying, tick]);

  const isLive = liveRef.current && isPlaying;

  return (
    <div className="flex items-end gap-[3px] h-16 flex-shrink-0">
      {bars.map((h, i) => (
        isLive ? (
          <div key={i} className="w-1.5 rounded-full transition-[height] duration-75"
            style={{
              backgroundColor: `hsl(${270 + i * 4}, 70%, 65%)`,
              height: `${h * 100}%`,
              minHeight: 3,
            }}
          />
        ) : (
          <motion.div key={i} className="w-1.5 rounded-full"
            style={{ backgroundColor: `hsl(${270 + i * 4}, 70%, 65%)` }}
            initial={{ height: 4 }}
            animate={{ height: `${h * 100}%` }}
            transition={{ duration: 0.8, delay: i * 0.04, repeat: Infinity, repeatType: 'reverse', repeatDelay: 1 + Math.random() * 2 }}
          />
        )
      ))}
    </div>
  );
}

function LOLVisual() {
  const tiers = [
    { color: '#5a5a5a', label: 'I' },
    { color: '#8B4513', label: 'B' },
    { color: '#A0A0A0', label: 'S' },
    { color: '#FFD700', label: 'G' },
    { color: '#00CED1', label: 'P' },
    { color: '#1E90FF', label: 'D' },
    { color: '#9932CC', label: 'M' },
    { color: '#FF4500', label: 'GM' },
    { color: '#00FFFF', label: 'C' },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {tiers.map((t, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: t.color, backgroundColor: i < 5 ? t.color : 'transparent', opacity: i < 5 ? 0.6 : 0.3 }} />
          <span className="text-[7px] font-mono opacity-40">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function SoulseekVisual() {
  return (
    <svg viewBox="0 0 120 50" className="w-full h-12 mt-1">
      {/* Network nodes */}
      <circle cx={60} cy={25} r={4} fill="hsl(270,70%,60%)" opacity={0.7} />
      <circle cx={25} cy={15} r={3} fill="hsl(270,60%,50%)" opacity={0.5} />
      <circle cx={95} cy={18} r={3} fill="hsl(270,60%,50%)" opacity={0.5} />
      <circle cx={30} cy={40} r={2.5} fill="hsl(270,50%,45%)" opacity={0.4} />
      <circle cx={90} cy={38} r={2.5} fill="hsl(270,50%,45%)" opacity={0.4} />
      <circle cx={50} cy={8} r={2} fill="hsl(270,50%,40%)" opacity={0.3} />
      <circle cx={75} cy={42} r={2} fill="hsl(270,50%,40%)" opacity={0.3} />
      {/* Connections */}
      <line x1={60} y1={25} x2={25} y2={15} stroke="hsl(270,60%,55%)" strokeWidth={0.5} opacity={0.3} />
      <line x1={60} y1={25} x2={95} y2={18} stroke="hsl(270,60%,55%)" strokeWidth={0.5} opacity={0.3} />
      <line x1={60} y1={25} x2={30} y2={40} stroke="hsl(270,60%,55%)" strokeWidth={0.5} opacity={0.3} />
      <line x1={60} y1={25} x2={90} y2={38} stroke="hsl(270,60%,55%)" strokeWidth={0.5} opacity={0.3} />
      <line x1={25} y1={15} x2={50} y2={8} stroke="hsl(270,50%,50%)" strokeWidth={0.4} opacity={0.2} />
      <line x1={95} y1={18} x2={75} y2={42} stroke="hsl(270,50%,50%)" strokeWidth={0.4} opacity={0.2} />
      {/* Transfer arrows */}
      <line x1={42} y1={20} x2={55} y2={24} stroke="hsl(150,80%,50%)" strokeWidth={1} opacity={0.4} strokeLinecap="round" />
      <line x1={65} y1={24} x2={80} y2={20} stroke="hsl(210,80%,55%)" strokeWidth={1} opacity={0.4} strokeLinecap="round" />
    </svg>
  );
}

function SplitWiserVisual() {
  // Two stacked tile-style "balance" rows + a coin to evoke money/splits
  return (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      {/* Top row: Alice +$42 */}
      <rect x={6} y={8} width={108} height={16} rx={4} fill="hsl(45,93%,55%)" fillOpacity={0.08} stroke="hsl(45,93%,55%)" strokeOpacity={0.25} strokeWidth={0.6} />
      <circle cx={16} cy={16} r={4} fill="hsl(280,60%,65%)" fillOpacity={0.7} />
      <rect x={26} y={13.5} width={28} height={2} rx={1} fill="white" fillOpacity={0.3} />
      <text x={108} y={19} textAnchor="end" fontSize={7} fill="hsl(140,70%,55%)" fillOpacity={0.85} fontFamily="monospace" fontWeight={700}>+$42</text>

      {/* Bottom row: Bob -$28 */}
      <rect x={6} y={28} width={108} height={16} rx={4} fill="hsl(45,93%,55%)" fillOpacity={0.08} stroke="hsl(45,93%,55%)" strokeOpacity={0.25} strokeWidth={0.6} />
      <circle cx={16} cy={36} r={4} fill="hsl(150,60%,55%)" fillOpacity={0.7} />
      <rect x={26} y={33.5} width={20} height={2} rx={1} fill="white" fillOpacity={0.3} />
      <text x={108} y={39} textAnchor="end" fontSize={7} fill="hsl(0,70%,60%)" fillOpacity={0.85} fontFamily="monospace" fontWeight={700}>-$28</text>

      {/* Coin floating bottom-right */}
      <circle cx={102} cy={52} r={5} fill="hsl(45,93%,55%)" fillOpacity={0.85} />
      <text x={102} y={54.5} textAnchor="middle" fontSize={6} fill="hsl(45,90%,15%)" fontFamily="monospace" fontWeight={900}>$</text>
    </svg>
  );
}

function JellyfinVisual() {
  // Stylized clapperboard + progress ticks hinting at active downloads
  return (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      {/* Clapperboard body */}
      <rect x={10} y={20} width={48} height={30} rx={2} fill="hsl(195,80%,55%)" fillOpacity={0.18} stroke="hsl(195,80%,55%)" strokeOpacity={0.4} strokeWidth={0.6} />
      {/* Clapperboard top diagonal stripes */}
      <polygon points="10,20 18,12 26,20" fill="hsl(195,80%,65%)" fillOpacity={0.3} />
      <polygon points="26,20 34,12 42,20" fill="hsl(195,80%,65%)" fillOpacity={0.45} />
      <polygon points="42,20 50,12 58,20" fill="hsl(195,80%,65%)" fillOpacity={0.3} />
      {/* Mini active-transfer bars */}
      <rect x={68} y={18} width={42} height={2} rx={1} fill="white" fillOpacity={0.08} />
      <rect x={68} y={18} width={32} height={2} rx={1} fill="hsl(195,90%,60%)" fillOpacity={0.7} />
      <rect x={68} y={26} width={42} height={2} rx={1} fill="white" fillOpacity={0.08} />
      <rect x={68} y={26} width={18} height={2} rx={1} fill="hsl(195,90%,60%)" fillOpacity={0.5} />
      <rect x={68} y={34} width={42} height={2} rx={1} fill="white" fillOpacity={0.08} />
      <rect x={68} y={34} width={42} height={2} rx={1} fill="hsl(150,80%,55%)" fillOpacity={0.6} />
      {/* TV/movie glyphs inside clapper */}
      <text x={34} y={42} textAnchor="middle" fontSize={11} fill="white" fillOpacity={0.55} fontFamily="monospace" fontWeight={700}>JF</text>
    </svg>
  );
}

function ServerVisual() {
  return (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      {/* Mini CPU gauge */}
      <path d="M 30 50 A 25 25 0 0 1 80 50" fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={5} strokeLinecap="round" />
      <path d="M 30 50 A 25 25 0 0 1 68 28" fill="none" stroke="hsl(195,100%,50%)" strokeWidth={5} strokeLinecap="round" opacity={0.6} />
      <text x={55} y={46} textAnchor="middle" fontSize={9} fill="white" opacity={0.5} fontFamily="monospace">72%</text>
      <text x={55} y={56} textAnchor="middle" fontSize={6} fill="white" opacity={0.3} fontFamily="monospace">CPU</text>
      {/* Mini terminal lines */}
      <rect x={88} y={12} width={25} height={2} rx={1} fill="hsl(195,100%,50%)" opacity={0.3} />
      <rect x={88} y={18} width={18} height={2} rx={1} fill="white" opacity={0.12} />
      <rect x={88} y={24} width={22} height={2} rx={1} fill="white" opacity={0.12} />
      <rect x={88} y={30} width={14} height={2} rx={1} fill="hsl(150,80%,50%)" opacity={0.2} />
      <rect x={88} y={36} width={20} height={2} rx={1} fill="white" opacity={0.12} />
    </svg>
  );
}

// ── GA Project Visuals ──

function ImageEvolverVisual() {
  return (
    <svg viewBox="0 0 120 50" className="w-full h-12 mt-1">
      <polygon points="15,45 45,8 60,40" fill="hsl(350,70%,55%)" fillOpacity={0.35} />
      <polygon points="30,42 55,5 80,38" fill="hsl(330,60%,60%)" fillOpacity={0.3} />
      <polygon points="50,45 75,10 100,42" fill="hsl(350,80%,65%)" fillOpacity={0.25} />
      <polygon points="20,35 40,15 70,45" fill="hsl(10,70%,55%)" fillOpacity={0.2} />
      <polygon points="60,40 90,8 110,35" fill="hsl(340,60%,50%)" fillOpacity={0.3} />
    </svg>
  );
}

function EcosystemVisual() {
  return (
    <svg viewBox="0 0 120 50" className="w-full h-12 mt-1">
      {/* Prey (green circles) */}
      <circle cx={20} cy={20} r={3.5} fill="#4ade80" opacity={0.7} />
      <circle cx={40} cy={35} r={3} fill="#4ade80" opacity={0.6} />
      <circle cx={55} cy={15} r={4} fill="#4ade80" opacity={0.7} />
      <circle cx={75} cy={30} r={3} fill="#4ade80" opacity={0.5} />
      <circle cx={90} cy={18} r={3.5} fill="#4ade80" opacity={0.6} />
      <circle cx={105} cy={38} r={2.5} fill="#4ade80" opacity={0.5} />
      {/* Predators (red triangles) */}
      <polygon points="32,28 38,20 35,32" fill="#f87171" opacity={0.7} />
      <polygon points="68,22 74,14 71,26" fill="#f87171" opacity={0.6} />
      <polygon points="95,32 101,24 98,36" fill="#f87171" opacity={0.5} />
      {/* Food (tiny green dots) */}
      <circle cx={10} cy={40} r={1.5} fill="#22c55e" opacity={0.3} />
      <circle cx={48} cy={42} r={1.5} fill="#22c55e" opacity={0.3} />
      <circle cx={82} cy={10} r={1.5} fill="#22c55e" opacity={0.3} />
      <circle cx={112} cy={25} r={1.5} fill="#22c55e" opacity={0.3} />
    </svg>
  );
}

function BrainfuckVisual() {
  // Stylized BF tape: instruction stream above, memory cells below, with a
  // moving "data pointer" indicator.
  const instrs = ['+', '+', '[', '>', '+', '+', '<', '-', ']', '>', '.', '<', '+', '.'];
  return (
    <svg viewBox="0 0 200 60" className="w-full h-14 mt-1">
      {instrs.map((c, i) => (
        <g key={i} transform={`translate(${i * 13 + 4}, 0)`}>
          <rect width={11} height={14} rx={1.5} fill="hsl(290,80%,60%)" fillOpacity={0.08} stroke="hsl(290,80%,65%)" strokeOpacity={0.25} strokeWidth={0.5} />
          <text x={5.5} y={11} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={700} fill="hsl(290,80%,80%)" fillOpacity={0.85}>{c}</text>
        </g>
      ))}
      {/* Memory cells */}
      {Array.from({ length: 8 }).map((_, i) => {
        const val = [3, 6, 0, 1, 4, 0, 0, 0][i];
        const active = i === 1;
        return (
          <g key={i} transform={`translate(${i * 22 + 8}, 28)`}>
            <rect width={18} height={20} rx={2}
              fill={active ? 'hsl(290,80%,55%)' : 'white'}
              fillOpacity={active ? 0.25 : 0.05}
              stroke={active ? 'hsl(290,80%,70%)' : 'white'}
              strokeOpacity={active ? 0.7 : 0.15}
              strokeWidth={active ? 1 : 0.5} />
            <text x={9} y={14} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={700}
              fill={active ? 'hsl(290,90%,90%)' : 'white'}
              fillOpacity={active ? 0.95 : 0.4}>{val}</text>
          </g>
        );
      })}
      {/* pointer triangle */}
      <polygon points="22,52 30,52 26,57" fill="hsl(290,90%,70%)" fillOpacity={0.9}>
        <animate attributeName="points"
          values="22,52 30,52 26,57; 44,52 52,52 48,57; 88,52 96,52 92,57; 22,52 30,52 26,57"
          dur="6s" repeatCount="indefinite" />
      </polygon>
    </svg>
  );
}

function NeuroevolutionVisual() {
  return (
    <svg viewBox="0 0 160 80" className="w-48 h-20 shrink-0">
      {/* Track outline */}
      <path d="M 30 60 Q 20 20, 60 15 Q 100 10, 120 30 Q 140 50, 110 65 Q 80 80, 30 60 Z"
        fill="none" stroke="white" strokeOpacity={0.1} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 30 60 Q 20 20, 60 15 Q 100 10, 120 30 Q 140 50, 110 65 Q 80 80, 30 60 Z"
        fill="none" stroke="white" strokeOpacity={0.06} strokeWidth={6} strokeDasharray="3 4" />
      {/* Car */}
      <polygon points="58,16 64,12 64,20" fill="#facc15" opacity={0.8} />
      {/* Sensor rays */}
      <line x1={64} y1={16} x2={80} y2={8} stroke="#facc15" strokeOpacity={0.3} strokeWidth={0.7} />
      <line x1={64} y1={14} x2={82} y2={14} stroke="#facc15" strokeOpacity={0.3} strokeWidth={0.7} />
      <line x1={64} y1={18} x2={78} y2={24} stroke="#facc15" strokeOpacity={0.3} strokeWidth={0.7} />
      {/* Other cars (faded) */}
      <polygon points="100,28 106,24 106,32" fill="#60a5fa" opacity={0.3} />
      <polygon points="118,48 124,44 124,52" fill="#60a5fa" opacity={0.2} />
      <polygon points="45,55 51,51 51,59" fill="#60a5fa" opacity={0.25} />
    </svg>
  );
}

// ── Card wrapper ──

function ProjectCard({
  href, children, className = '', featured = false, delay = 0,
}: {
  href: string; children: React.ReactNode; className?: string; featured?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={featured ? 'col-span-1 md:col-span-2' : ''}
    >
      <Link href={href} className="block group">
        <motion.div
          whileHover={{ y: -3, scale: 1.005 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className={`relative overflow-hidden rounded-2xl border border-white/[0.06] p-6 transition-all duration-300 group-hover:border-white/[0.12] group-hover:shadow-xl ${className}`}
          style={{ minHeight: featured ? 180 : 160 }}
        >
          {children}
          <ArrowRight className="absolute bottom-5 right-5 h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-1 transition-all duration-300" />
        </motion.div>
      </Link>
    </motion.div>
  );
}

// ── Page ──

export default function ProjectsPage() {
  return (
    <PageTransition>
      <div className="p-6 md:p-8">
        <div className="container mx-auto max-w-5xl">
          <FadeIn>
            <h1 className="text-3xl font-bold mb-2">Projects</h1>
            <p className="text-muted-foreground mb-8">Interactive experiments and creative tools.</p>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* ── Polar Clock (featured) ── */}
            <ProjectCard href="/projects/polar-clock" featured delay={0.05}
              className="bg-gradient-to-br from-indigo-950/80 via-indigo-900/50 to-teal-950/60">
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-indigo-300" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-indigo-300/70 font-medium">Visualization</span>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Polar Clock</h2>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Real-time clock with animated concentric rings for seconds, minutes, hours, and more. Multiple palettes, 13 animated backgrounds, and wallpaper export.
                  </p>
                </div>
                <PolarClockVisual />
              </div>
            </ProjectCard>

            {/* ── Game of Life ── */}
            <ProjectCard href="/projects/gol" delay={0.1}
              className="bg-gradient-to-br from-emerald-950/70 to-green-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Grid3X3 className="h-4 w-4 text-emerald-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/60 font-medium">Simulation</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Conway&#39;s Game of Life</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-4">
                Interactive cellular automaton with preset patterns, speed controls, and a generation counter.
              </p>
              <GOLVisual />
            </ProjectCard>

            {/* ── Room Planner ── */}
            <ProjectCard href="/projects/house" delay={0.15}
              className="bg-gradient-to-br from-amber-950/60 to-orange-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Home className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-amber-400/60 font-medium">Tool</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Room Planner</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-3">
                Drag-and-drop layout tool for planning rooms with custom furniture dimensions on a precision grid.
              </p>
              <RoomPlannerVisual />
            </ProjectCard>

            {/* ── BarFoo (featured) ── */}
            <ProjectCard href="/projects/barfoo" featured delay={0.2}
              className="bg-gradient-to-br from-violet-950/80 via-purple-900/50 to-fuchsia-950/50">
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Music className="h-4 w-4 text-violet-300" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300/70 font-medium">Music</span>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">BarFoo</h2>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Browse your music library, play tracks in the browser, manage playlists, and explore detailed listening analytics with charts and heatmaps.
                  </p>
                </div>
                <BarFooVisual />
              </div>
            </ProjectCard>

            {/* ── LoL Challenges ── */}
            <ProjectCard href="/projects/challenges" delay={0.25}
              className="bg-gradient-to-br from-yellow-950/60 to-amber-950/30" >
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-[#C8AA6E]" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#C8AA6E]/60 font-medium">Gaming</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">LoL Challenges</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-4">
                Track League of Legends challenge progress with tier badges, percentile rankings, and per-champion completion.
              </p>
              <LOLVisual />
            </ProjectCard>

            {/* ── Server Dashboard ── */}
            <ProjectCard href="/projects/server" delay={0.3}
              className="bg-gradient-to-br from-cyan-950/70 to-sky-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Server className="h-4 w-4 text-cyan-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 font-medium">System</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Server Dashboard</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-2">
                Monitor CPU, memory, disk, and network metrics. Manage services and view real-time logs.
              </p>
              <ServerVisual />
            </ProjectCard>

            {/* ── SplitWiser ── */}
            <ProjectCard href="/projects/splitwiser" delay={0.31}
              className="bg-gradient-to-br from-amber-950/70 to-yellow-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-amber-400/60 font-medium">Money</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">SplitWiser</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-2">
                Self-hosted Splitwise. Track who paid for what across groups, with magic-link auth and ghost users for friends who don&#39;t want to log in.
              </p>
              <SplitWiserVisual />
            </ProjectCard>

            {/* ── Jellyfin Fetcher ── */}
            <ProjectCard href="/projects/jellyfin" delay={0.33}
              className="bg-gradient-to-br from-sky-950/70 to-cyan-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Film className="h-4 w-4 text-sky-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-sky-400/60 font-medium">Media</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Jellyfin Fetcher</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-2">
                Drop in a magnet or .torrent and it&#39;s downloaded, cleaned, and filed into Jellyfin&#39;s movie/TV layout automatically.
              </p>
              <JellyfinVisual />
            </ProjectCard>

            {/* ── Soulseek ── */}
            <ProjectCard href="/projects/soulseek" delay={0.35}
              className="bg-gradient-to-br from-violet-950/70 to-purple-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Share2 className="h-4 w-4 text-violet-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-400/60 font-medium">P2P Network</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Soulseek</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-2">
                Search, download, and share music on the Soulseek P2P network. Track transfers and manage library ingestion.
              </p>
              <SoulseekVisual />
            </ProjectCard>

            {/* ── Genetic Algorithms section divider ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="col-span-1 md:col-span-2 mt-4 mb-1"
            >
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-white/30 font-medium flex items-center gap-2">
                  <Atom className="h-3 w-3" />
                  Genetic Algorithms
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
            </motion.div>

            {/* ── Image Evolver ── */}
            <ProjectCard href="/projects/image-evolver" delay={0.4}
              className="bg-gradient-to-br from-rose-950/70 to-pink-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="h-4 w-4 text-rose-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-rose-400/60 font-medium">Genetic Algorithm</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Image Evolver</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-3">
                Evolve semi-transparent polygons to approximate a target image. Watch abstract shapes converge into recognizable art.
              </p>
              <ImageEvolverVisual />
            </ProjectCard>

            {/* ── BrainFuck Genetic ── */}
            <ProjectCard href="/projects/brainfuck" delay={0.42}
              className="bg-gradient-to-br from-fuchsia-950/70 to-purple-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Code2 className="h-4 w-4 text-fuchsia-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-400/60 font-medium">Genetic Algorithm</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">BrainFuck Genetic</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-2">
                Evolve a BrainFuck program that prints a target string. Naive baseline implementation — slow but honest, ready to be optimized.
              </p>
              <BrainfuckVisual />
            </ProjectCard>

            {/* ── Ecosystem Sim ── */}
            <ProjectCard href="/projects/ecosystem" delay={0.45}
              className="bg-gradient-to-br from-lime-950/60 to-teal-950/40">
              <div className="flex items-center gap-2 mb-3">
                <Bug className="h-4 w-4 text-lime-400" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-lime-400/60 font-medium">Genetic Algorithm</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1.5">Ecosystem Sim</h2>
              <p className="text-sm text-white/45 leading-relaxed mb-3">
                Predator-prey co-evolution in a 2D world. Observe emergent behaviors as species adapt competing survival strategies.
              </p>
              <EcosystemVisual />
            </ProjectCard>

            {/* ── Neuroevolution (featured) ── */}
            <ProjectCard href="/projects/neuroevolution" featured delay={0.5}
              className="bg-gradient-to-br from-blue-950/70 via-blue-900/50 to-indigo-950/40">
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="h-4 w-4 text-blue-300" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-blue-300/70 font-medium">Genetic Algorithm</span>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Neuroevolution</h2>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Evolve neural networks to drive cars around a procedural track. Watch populations of agents learn to navigate through natural selection, with real-time sensor visualization.
                  </p>
                </div>
                <NeuroevolutionVisual />
              </div>
            </ProjectCard>

          </div>
        </div>
      </div>
    </PageTransition>
  );
}
