'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import PolarClock from '../components/PolarClock';
import GSMOL from '@/components/GSMOL';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { motion } from 'motion/react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Server, Cpu, MemoryStick, HardDrive, Clock, Activity,
  Music, Trophy, Home, ArrowRight, Thermometer, Circle,
  Grid3X3, Gamepad2, TrendingUp, Disc3, Swords,
} from 'lucide-react';

// ── Types ──

interface ServerStats {
  hostname: string;
  os: string;
  kernel: string;
  cpuCount: number;
  cpuTemp: number | null;
  loadAverage: { '1m': number; '5m': number; '15m': number };
  memory: { total: number; used: number; available: number; percentUsed: number };
  disks: { total: number; used: number; percentUsed: number; mountPoint: string }[];
  uptimeSeconds: number;
}

interface ServiceInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
}

interface MusicStats {
  topSongs: { artist: string; song: string; play_count: number }[];
  recentPlays: { artist: string; song: string; album: string; played_at: string }[];
}

interface ChallengeData {
  totalPoints: { level: string; current: number; max: number; percentile: number } | null;
  categoryPoints: Record<string, { level: string; current: number; max: number }> | null;
}

interface GameData {
  champion: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  points_gained: number;
  tier_ups: number;
  game_mode: string;
  game_creation: number;
}

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1) + ' TB';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function timeAgo(ts: number | string): string {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : (ts > 1e12 ? ts : ts * 1000);
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TIER_COLORS: Record<string, { color: string; bg: string }> = {
  NONE:         { color: '#5B5A56', bg: '#5B5A5618' },
  IRON:         { color: '#8C7B70', bg: '#8C7B7018' },
  BRONZE:       { color: '#B08D57', bg: '#B08D5718' },
  SILVER:       { color: '#A0ACBA', bg: '#A0ACBA18' },
  GOLD:         { color: '#C8AA6E', bg: '#C8AA6E20' },
  PLATINUM:     { color: '#4E9996', bg: '#4E999618' },
  DIAMOND:      { color: '#576BCE', bg: '#576BCE18' },
  MASTER:       { color: '#9D48E0', bg: '#9D48E018' },
  GRANDMASTER:  { color: '#EF4444', bg: '#EF444418' },
  CHALLENGER:   { color: '#F4E171', bg: '#F4E17118' },
};

const CATEGORY_LABELS: Record<string, string> = {
  IMAGINATION: 'Imagination',
  EXPERTISE: 'Expertise',
  VETERANCY: 'Veterancy',
  TEAMWORK: 'Teamwork',
  COLLECTION: 'Collection',
};

const CATEGORY_COLORS = ['#818cf8', '#38bdf8', '#4ade80', '#fbbf24', '#f472b6'];

// ── Activity Feed Item ──

interface FeedItem {
  type: 'music' | 'game';
  timestamp: number;
  // music
  song?: string;
  artist?: string;
  // game
  champion?: string;
  win?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  pointsGained?: number;
  tierUps?: number;
}

// ── Data Hook ──

function useHomepageData() {
  const [server, setServer] = useState<ServerStats | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [music, setMusic] = useState<MusicStats | null>(null);
  const [challenges, setChallenges] = useState<ChallengeData | null>(null);
  const [games, setGames] = useState<GameData[]>([]);

  const fetchServer = useCallback(async () => {
    try {
      const [statsRes, svcRes] = await Promise.all([
        fetch('/api/server'),
        fetch('/api/server/services'),
      ]);
      const stats = await statsRes.json();
      const svcs = await svcRes.json();
      if (stats.hostname) setServer(stats);
      if (svcs.services) setServices(svcs.services);
    } catch { /* graceful */ }
  }, []);

  useEffect(() => {
    fetchServer();
    const interval = setInterval(fetchServer, 30000);
    return () => clearInterval(interval);
  }, [fetchServer]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/music/stats');
        const data = await res.json();
        if (data.topSongs) setMusic(data);
      } catch { /* graceful */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [chalRes, gamesRes] = await Promise.all([
          fetch('/api/challenges'),
          fetch('/api/challenges/games'),
        ]);
        const chalData = await chalRes.json();
        const gamesData = await gamesRes.json();
        if (chalData.totalPoints) setChallenges({ totalPoints: chalData.totalPoints, categoryPoints: chalData.categoryPoints });
        if (Array.isArray(gamesData)) setGames(gamesData);
      } catch { /* graceful */ }
    })();
  }, []);

  return { server, services, music, challenges, games };
}

// ── Components ──

function GaugeRing({ percent, color, size = 40, stroke = 4, children }: {
  percent: number; color: string; size?: number; stroke?: number; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted/60" />
        <motion.circle
          cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          initial={{ strokeDasharray: circ, strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - Math.min(percent, 100) / 100) }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}

function StatusBar({ server, services }: { server: ServerStats | null; services: ServiceInfo[] }) {
  const running = services.filter(s => s.status === 'running').length;

  if (!server) {
    return (
      <div className="flex items-center gap-4 px-5 py-3 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm">
        <Skeleton className="h-5 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold text-sm tracking-tight">{server.hostname}</span>
        <span className="text-xs text-muted-foreground font-mono">{server.os}</span>
      </div>

      <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span className="font-mono">up {formatUptime(server.uptimeSeconds)}</span>
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span>{running}/{services.length} services</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" />
          <div className="w-14 h-1.5 rounded-full overflow-hidden bg-muted/60">
            <motion.div
              className="h-full rounded-full"
              animate={{
                width: `${Math.min((server.loadAverage['1m'] / server.cpuCount) * 100, 100)}%`,
                backgroundColor: server.loadAverage['1m'] / server.cpuCount > 0.8 ? '#ef4444' : '#22c55e',
              }}
              transition={{ duration: 0.8 }}
            />
          </div>
          <span className="font-mono w-8">{server.loadAverage['1m'].toFixed(1)}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MemoryStick className="h-3.5 w-3.5" />
          <div className="w-14 h-1.5 rounded-full overflow-hidden bg-muted/60">
            <motion.div
              className="h-full rounded-full"
              animate={{
                width: `${server.memory.percentUsed}%`,
                backgroundColor: server.memory.percentUsed > 80 ? '#ef4444' : '#3b82f6',
              }}
              transition={{ duration: 0.8 }}
            />
          </div>
          <span className="font-mono w-8">{server.memory.percentUsed}%</span>
        </div>

        {server.cpuTemp !== null && (
          <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
            <Thermometer className="h-3.5 w-3.5" />
            <span className="font-mono">{server.cpuTemp.toFixed(0)}&deg;</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──

export default function HomePage() {
  const { server, services, music, challenges, games } = useHomepageData();

  // Merge music + games into a unified activity feed
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    if (music?.recentPlays) {
      for (const p of music.recentPlays.slice(0, 15)) {
        items.push({
          type: 'music',
          timestamp: new Date(p.played_at).getTime(),
          song: p.song,
          artist: p.artist,
        });
      }
    }

    for (const g of games.slice(0, 10)) {
      const ts = g.game_creation > 1e12 ? g.game_creation : g.game_creation * 1000;
      items.push({
        type: 'game',
        timestamp: ts,
        champion: g.champion,
        win: g.win,
        kills: g.kills,
        deaths: g.deaths,
        assists: g.assists,
        pointsGained: g.points_gained,
        tierUps: g.tier_ups,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items.slice(0, 12);
  }, [music, games]);

  const tp = challenges?.totalPoints;
  const tier = tp?.level || 'NONE';
  const tc = TIER_COLORS[tier] || TIER_COLORS.NONE;
  const categories = challenges?.categoryPoints
    ? Object.entries(challenges.categoryPoints).filter(([k]) => CATEGORY_LABELS[k])
    : [];

  const disk = server?.disks[0];
  const running = services.filter(s => s.status === 'running').length;

  const projects = [
    { href: '/projects/polar-clock', icon: Clock, label: 'Polar Clock', color: '#818cf8' },
    { href: '/projects/gol', icon: Grid3X3, label: 'Game of Life', color: '#4ade80' },
    { href: '/projects/house', icon: Home, label: 'Room Planner', color: '#fbbf24' },
    { href: '/projects/barfoo', icon: Music, label: 'BarFoo', color: '#38bdf8' },
    { href: '/projects/challenges', icon: Trophy, label: 'Challenges', color: '#f472b6' },
    { href: '/projects/server', icon: Server, label: 'Server', color: '#a78bfa' },
  ];

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="container mx-auto max-w-6xl space-y-5">

          {/* ── Status Bar ── */}
          <FadeIn>
            <StatusBar server={server} services={services} />
          </FadeIn>

          {/* ── Visualizations: two equal panels ── */}
          <FadeIn delay={0.05}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Link href="/projects/polar-clock" className="block group">
                <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
                  <div className="relative rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
                    <div className="flex items-center justify-center py-8 pointer-events-none">
                      <PolarClock width={260} height={260} />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 px-5 py-3 flex items-center justify-between bg-gradient-to-t from-card via-card/80 to-transparent">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Polar Clock</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </motion.div>
              </Link>

              <Link href="/projects/gol" className="block group">
                <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
                  <div className="relative rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
                    <div className="flex items-center justify-center py-8 pointer-events-none">
                      <GSMOL width={260} height={260} cellSize={8} minimal />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 px-5 py-3 flex items-center justify-between bg-gradient-to-t from-card via-card/80 to-transparent">
                      <div className="flex items-center gap-2">
                        <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Game of Life</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </motion.div>
              </Link>
            </div>
          </FadeIn>

          {/* ── Three-column data row: Server | Activity Feed | Challenges ── */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

              {/* Left: Server Health */}
              <div className="lg:col-span-3">
                <Link href="/projects/server" className="block group h-full">
                  <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }} className="h-full">
                    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-5 h-full space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">System</span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      {!server ? (
                        <div className="space-y-4">
                          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10" />)}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* CPU gauge */}
                          <div className="flex items-center gap-3">
                            <GaugeRing percent={Math.min((server.loadAverage['1m'] / server.cpuCount) * 100, 100)} color="#818cf8">
                              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                            </GaugeRing>
                            <div>
                              <p className="text-sm font-bold font-mono leading-none">{server.loadAverage['1m'].toFixed(2)}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{server.cpuCount} cores</p>
                            </div>
                          </div>

                          {/* Memory gauge */}
                          <div className="flex items-center gap-3">
                            <GaugeRing percent={server.memory.percentUsed} color="#38bdf8">
                              <MemoryStick className="h-3.5 w-3.5 text-muted-foreground" />
                            </GaugeRing>
                            <div>
                              <p className="text-sm font-bold font-mono leading-none">{server.memory.percentUsed}%</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{formatBytes(server.memory.used)}</p>
                            </div>
                          </div>

                          {/* Disk gauge */}
                          <div className="flex items-center gap-3">
                            <GaugeRing percent={disk?.percentUsed ?? 0} color="#4ade80">
                              <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                            </GaugeRing>
                            <div>
                              <p className="text-sm font-bold font-mono leading-none">{disk?.percentUsed ?? 0}%</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{disk ? formatBytes(disk.used) : ''}</p>
                            </div>
                          </div>

                          {/* Services */}
                          <div className="pt-2 border-t border-border/40">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Services</p>
                            <div className="flex flex-wrap gap-1.5">
                              {services.map(s => (
                                <div key={s.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Circle className={`h-1.5 w-1.5 fill-current ${
                                    s.status === 'running' ? 'text-emerald-400' :
                                    s.status === 'failed' ? 'text-red-400' : 'text-zinc-500'
                                  }`} />
                                  <span className="truncate max-w-[70px]">{s.name.replace(/@.*/, '')}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {server.cpuTemp !== null && (
                            <div className="flex items-center gap-3">
                              <GaugeRing percent={Math.min(server.cpuTemp / 80 * 100, 100)} color={server.cpuTemp > 60 ? '#ef4444' : '#fbbf24'}>
                                <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                              </GaugeRing>
                              <div>
                                <p className="text-sm font-bold font-mono leading-none">{server.cpuTemp.toFixed(0)}&deg;C</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">CPU temp</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </Link>
              </div>

              {/* Center: Unified Activity Feed */}
              <div className="lg:col-span-5">
                <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-5 h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Activity</span>
                  </div>

                  {feed.length === 0 ? (
                    <div className="space-y-3">
                      {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {feed.map((item, i) => (
                        <motion.div
                          key={`${item.type}-${item.timestamp}-${i}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.3 }}
                          className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          {item.type === 'music' ? (
                            <>
                              <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-sky-500/10">
                                <Disc3 className="h-3.5 w-3.5 text-sky-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{item.song}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{item.artist}</p>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center ${
                                item.win ? 'bg-emerald-500/10' : 'bg-red-500/10'
                              }`}>
                                <Swords className={`h-3.5 w-3.5 ${item.win ? 'text-emerald-400' : 'text-red-400'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  <span className={item.win ? 'text-emerald-400' : 'text-red-400'}>{item.win ? 'W' : 'L'}</span>
                                  {' '}{item.champion}
                                  <span className="text-muted-foreground font-mono text-xs ml-1.5">
                                    {item.kills}/{item.deaths}/{item.assists}
                                  </span>
                                </p>
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  {(item.pointsGained ?? 0) > 0 && (
                                    <span className="text-emerald-400 font-mono">+{item.pointsGained}pts</span>
                                  )}
                                  {(item.tierUps ?? 0) > 0 && (
                                    <span className="text-amber-400">{item.tierUps} tier-up{item.tierUps! > 1 ? 's' : ''}</span>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{timeAgo(item.timestamp)}</span>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Challenge Progress */}
              <div className="lg:col-span-4">
                <Link href="/projects/challenges" className="block group h-full">
                  <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }} className="h-full">
                    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-5 h-full space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Trophy className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Challenges</span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      {!challenges ? (
                        <div className="space-y-3">
                          <Skeleton className="h-10 w-32" />
                          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-4" />)}
                        </div>
                      ) : (
                        <>
                          {/* Total points */}
                          {tp && (
                            <div className="space-y-2">
                              <div className="flex items-end gap-3">
                                <p className="text-3xl font-bold font-mono leading-none tracking-tight">{tp.current.toLocaleString()}</p>
                                <span
                                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-0.5"
                                  style={{ color: tc.color, background: tc.bg, border: `1px solid ${tc.color}25` }}
                                >
                                  {tier}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted/60">
                                  <motion.div
                                    className="h-full rounded-full"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(tp.current / tp.max) * 100}%` }}
                                    transition={{ duration: 1, ease: 'easeOut' }}
                                    style={{ backgroundColor: tc.color }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono">{tp.max.toLocaleString()}</span>
                              </div>
                            </div>
                          )}

                          {/* Category bars */}
                          {categories.length > 0 && (
                            <div className="space-y-2.5 pt-2">
                              {categories.map(([key, cat], i) => (
                                <div key={key}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[key]}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground">{cat.current}/{cat.max}</span>
                                  </div>
                                  <div className="h-1 rounded-full overflow-hidden bg-muted/60">
                                    <motion.div
                                      className="h-full rounded-full"
                                      initial={{ width: 0 }}
                                      animate={{ width: `${(cat.current / cat.max) * 100}%` }}
                                      transition={{ duration: 1, delay: i * 0.1, ease: 'easeOut' }}
                                      style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Latest game */}
                          {games.length > 0 && (() => {
                            const g = games[0];
                            return (
                              <div className="flex items-center gap-2 pt-3 border-t border-border/40 text-xs">
                                <Gamepad2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="font-medium">{g.champion}</span>
                                <span className={g.win ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{g.win ? 'Victory' : 'Defeat'}</span>
                                <span className="font-mono text-muted-foreground">{g.kills}/{g.deaths}/{g.assists}</span>
                                {g.tier_ups > 0 && (
                                  <span className="ml-auto flex items-center gap-0.5 text-amber-400">
                                    <TrendingUp className="h-3 w-3" />
                                    {g.tier_ups}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </motion.div>
                </Link>
              </div>
            </div>
          </FadeIn>

          {/* ── Project Quick Links: 6 equal cards ── */}
          <FadeIn delay={0.15}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {projects.map((p) => (
                <Link key={p.href} href={p.href} className="block group">
                  <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm px-3 py-3 flex flex-col items-center gap-2 text-center hover:border-primary/30 transition-colors">
                      <div className="p-2 rounded-lg" style={{ backgroundColor: `${p.color}15` }}>
                        <p.icon className="h-4 w-4" style={{ color: p.color }} />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">{p.label}</span>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </FadeIn>

        </div>
      </div>
    </PageTransition>
  );
}
