'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, ChevronDown, ChevronRight, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ── Types ──────────────────────────────────────────────

interface Challenge {
  challenge_id: number;
  name: string;
  description: string;
  short_description: string;
  category: string;
  thresholds: Record<string, number>;
  level: string | null;
  value: number | null;
  percentile: number | null;
}

interface ChallengeData {
  lastSyncedAt: string | null;
  totalPoints: { level: string; current: number; max: number; percentile: number } | null;
  categoryPoints: Record<string, { level: string; current: number; max: number; percentile: number }> | null;
  challenges: Challenge[];
}

interface GameDelta {
  challenge_id: string;
  name: string;
  old_value: number;
  new_value: number;
  old_level: string;
  new_level: string;
}

interface Game {
  id: number;
  detected_at: string;
  match_id: string;
  champion: string;
  win: boolean;
  game_mode: string;
  kills: number;
  deaths: number;
  assists: number;
  game_duration: number;
  game_creation: number;
  deltas: GameDelta[];
  tier_ups: number;
  points_gained: number;
}

// ── Constants ──────────────────────────────────────────

const TIER_ORDER = ['NONE', 'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

const TIER_HEX: Record<string, { color: string; bg: string; glow: string }> = {
  NONE:         { color: '#5B5A56', bg: '#5B5A5620', glow: '#5B5A5640' },
  IRON:         { color: '#8C7B70', bg: '#8C7B7020', glow: '#8C7B7040' },
  BRONZE:       { color: '#B08D57', bg: '#B08D5720', glow: '#B08D5740' },
  SILVER:       { color: '#A0ACBA', bg: '#A0ACBA20', glow: '#A0ACBA40' },
  GOLD:         { color: '#C8AA6E', bg: '#C8AA6E25', glow: '#C8AA6E50' },
  PLATINUM:     { color: '#3FC9C9', bg: '#3FC9C920', glow: '#3FC9C940' },
  DIAMOND:      { color: '#6C8EBF', bg: '#6C8EBF20', glow: '#6C8EBF40' },
  MASTER:       { color: '#9D48E0', bg: '#9D48E020', glow: '#9D48E040' },
  GRANDMASTER:  { color: '#EF4444', bg: '#EF444420', glow: '#EF444440' },
  CHALLENGER:   { color: '#F0E6D2', bg: '#F0E6D220', glow: '#F0E6D260' },
};

const CATEGORY_LABELS: Record<string, string> = {
  IMAGINATION: 'Imagination',
  EXPERTISE: 'Expertise',
  VETERANCY: 'Veterancy',
  TEAMWORK: 'Teamwork & Strategy',
  COLLECTION: 'Collection',
  OTHER: 'Other',
};

const CATEGORY_ORDER = ['IMAGINATION', 'EXPERTISE', 'VETERANCY', 'TEAMWORK', 'COLLECTION', 'OTHER'];

const GAME_MODE_LABELS: Record<string, { label: string; color: string }> = {
  ARAM:   { label: 'ARAM', color: '#4FC3F7' },
  SR:     { label: 'SR', color: '#66BB6A' },
  'CO-OP': { label: 'Co-op', color: '#FFB74D' },
  ARENA:  { label: 'Arena', color: '#CE93D8' },
  SWARM:  { label: 'Swarm', color: '#EF5350' },
};

function getGameMode(challengeId: number, description: string): string | null {
  const id = String(challengeId);
  if (id.startsWith('101')) return 'ARAM';
  if (id.startsWith('120') || id.startsWith('121')) return 'CO-OP';
  if (id.startsWith('603')) return 'SWARM';
  if (id.startsWith('600') || id.startsWith('601') || id.startsWith('602')) return 'ARENA';
  // Overall/collection challenges have no specific mode
  if (challengeId < 10 || id.startsWith('50') || id.startsWith('51')) return null;
  // Check descriptions for ARAM keywords (catches seasonal ARAM challenges)
  if (/aram|snowball|poro/i.test(description)) return 'ARAM';
  return 'SR';
}

// ── Helpers ────────────────────────────────────────────

function stripHtml(str: string) {
  return str.replace(/<[^>]*>/g, '');
}

function getProgress(challenge: Challenge): { percent: number; currentThreshold: number; nextThreshold: number; nextTier: string } | null {
  const level = challenge.level || 'NONE';
  const value = challenge.value ?? 0;
  const thresholds = challenge.thresholds;
  if (!thresholds || Object.keys(thresholds).length === 0) return null;

  const tierIdx = TIER_ORDER.indexOf(level);
  if (tierIdx === TIER_ORDER.length - 1) return { percent: 100, currentThreshold: 0, nextThreshold: 0, nextTier: 'MAX' };

  let nextTier = '';
  let nextThreshold = 0;
  for (let i = tierIdx + 1; i < TIER_ORDER.length; i++) {
    if (thresholds[TIER_ORDER[i]] !== undefined) {
      nextTier = TIER_ORDER[i];
      nextThreshold = thresholds[TIER_ORDER[i]];
      break;
    }
  }
  if (!nextTier) return null;

  let currentThreshold = 0;
  if (level !== 'NONE' && thresholds[level] !== undefined) {
    currentThreshold = thresholds[level];
  }

  const range = nextThreshold - currentThreshold;
  if (range <= 0) return { percent: 100, currentThreshold, nextThreshold, nextTier };
  const percent = Math.min(100, Math.max(0, ((value - currentThreshold) / range) * 100));
  return { percent, currentThreshold, nextThreshold, nextTier };
}

function TierBadge({ tier, size = 'sm' }: { tier: string; size?: 'sm' | 'md' }) {
  const t = TIER_HEX[tier] || TIER_HEX.NONE;
  return (
    <span
      className={`inline-flex items-center font-semibold tracking-wider uppercase ${size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'}`}
      style={{ color: t.color, background: t.bg, border: `1px solid ${t.glow}`, borderRadius: 2 }}
    >
      {tier}
    </span>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(timestamp: number) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Component ──────────────────────────────────────────

export default function ChallengesPage() {
  const [data, setData] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [gameModeFilterChallenges, setGameModeFilterChallenges] = useState('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'percentile' | 'progress'>('name');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'challenges' | 'games'>('challenges');
  const [games, setGames] = useState<Game[]>([]);
  const [totalChampions, setTotalChampions] = useState(172);
  const [allChampionNames, setAllChampionNames] = useState<string[]>([]);
  const [expandedChallenge, setExpandedChallenge] = useState<number | null>(null);
  const [championProgress, setChampionProgress] = useState<Record<string, { completed_count: number; champions: string[] }>>({});
  const [expandedGame, setExpandedGame] = useState<number | null>(null);
  const [gameModeFilter, setGameModeFilter] = useState('ALL');
  const [deltaSortBy, setDeltaSortBy] = useState<'default' | 'nearest' | 'rarest' | 'tier'>('default');

  useEffect(() => {
    fetch('/api/challenges/games').then(r => r.json()).then(setGames).catch(console.error);
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(versions => fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`))
      .then(r => r.json())
      .then(d => {
        const names = Object.values(d.data).map((c: unknown) => (c as { name: string }).name).sort() as string[];
        setTotalChampions(names.length);
        setAllChampionNames(names);
      })
      .catch(() => {});
    fetch('/api/challenges/champions')
      .then(r => r.json())
      .then((rows: { challenge_id: number; completed_count: number; champions: string[] }[]) => {
        const map: Record<string, { completed_count: number; champions: string[] }> = {};
        for (const r of rows) map[String(r.challenge_id)] = { completed_count: r.completed_count, champions: r.champions };
        setChampionProgress(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/challenges')
      .then(r => r.json())
      .then(d => {
        setData(d);
        const cats = new Set<string>(d.challenges?.map((c: Challenge) => c.category).filter((c: string) => c !== 'OVERALL'));
        setExpandedCategories(cats);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/challenges/sync', { method: 'POST' });
      const result = await res.json();
      if (result.synced) {
        const r = await fetch('/api/challenges');
        setData(await r.json());
      } else if (result.reason === 'cooldown') {
        alert(`Sync on cooldown. ${result.remainingSeconds}s remaining.`);
      }
    } catch (e) { console.error('Sync failed:', e); }
    finally { setSyncing(false); }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!data?.challenges) return [];
    return data.challenges
      .filter(c => c.category !== 'OVERALL')
      .filter(c => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.description.toLowerCase().includes(search.toLowerCase())) return false;
        if (tierFilter !== 'ALL' && (c.level || 'NONE') !== tierFilter) return false;
        if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
        if (gameModeFilterChallenges !== 'ALL') {
          const mode = getGameMode(c.challenge_id, c.description + ' ' + c.short_description);
          if (mode !== gameModeFilterChallenges) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'percentile') return (a.percentile ?? 1) - (b.percentile ?? 1);
        if (sortBy === 'progress') return (getProgress(b)?.percent ?? -1) - (getProgress(a)?.percent ?? -1);
        return a.name.localeCompare(b.name);
      });
  }, [data, search, tierFilter, categoryFilter, gameModeFilterChallenges, sortBy]);

  const grouped = useMemo(() => {
    const groups: Record<string, Challenge[]> = {};
    for (const c of filtered) { if (!groups[c.category]) groups[c.category] = []; groups[c.category].push(c); }
    return groups;
  }, [filtered]);

  // Lookup map for challenge data by ID
  const challengeMap = useMemo(() => {
    const map: Record<string, Challenge> = {};
    if (data?.challenges) for (const c of data.challenges) map[String(c.challenge_id)] = c;
    return map;
  }, [data]);

  // Sort deltas for expanded game view
  const sortDeltas = (deltas: GameDelta[]) => {
    if (deltaSortBy === 'default') return deltas;
    return [...deltas].sort((a, b) => {
      if (deltaSortBy === 'tier') {
        return TIER_ORDER.indexOf(b.new_level) - TIER_ORDER.indexOf(a.new_level);
      }
      if (deltaSortBy === 'rarest') {
        const ap = challengeMap[a.challenge_id]?.percentile ?? 1;
        const bp = challengeMap[b.challenge_id]?.percentile ?? 1;
        return ap - bp;
      }
      if (deltaSortBy === 'nearest') {
        const progA = challengeMap[a.challenge_id] ? getProgress(challengeMap[a.challenge_id]) : null;
        const progB = challengeMap[b.challenge_id] ? getProgress(challengeMap[b.challenge_id]) : null;
        return (progB?.percent ?? -1) - (progA?.percent ?? -1);
      }
      return 0;
    });
  };

  // Stats for hero
  const totalCompleted = useMemo(() => data?.challenges?.filter(c => c.category !== 'OVERALL' && c.level && c.level !== 'NONE').length ?? 0, [data]);
  const totalChallenges = useMemo(() => data?.challenges?.filter(c => c.category !== 'OVERALL').length ?? 0, [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--lol-bg-deep)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--lol-gold)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--lol-text-secondary)' }}>Loading challenges...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lol-theme" style={{ background: 'var(--lol-bg-deep)', color: 'var(--lol-text-secondary)' }}>

      {/* ── Hero Section ── */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(180deg, var(--lol-gradient-start) 0%, var(--lol-gradient-end) 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, var(--lol-gold) 0%, transparent 50%)' }} />
        <div className="container mx-auto px-4 pt-10 pb-8 relative">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>

            {/* Title row */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <h1 className="text-sm font-semibold tracking-[0.3em] uppercase mb-2" style={{ color: 'var(--lol-gold)' }}>
                  Challenge Tracker
                </h1>
                {data?.totalPoints && (
                  <div className="flex items-end gap-4">
                    <span className="text-5xl font-bold tabular-nums" style={{ color: 'var(--lol-text-primary)' }}>
                      {data.totalPoints.current.toLocaleString()}
                    </span>
                    <div className="pb-1.5">
                      <span className="text-lg" style={{ color: 'var(--lol-text-muted)' }}>/ {data.totalPoints.max.toLocaleString()}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <TierBadge tier={data.totalPoints.level} size="md" />
                        <span className="text-xs" style={{ color: 'var(--lol-gold-dark)' }}>Top {(data.totalPoints.percentile * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {data?.lastSyncedAt && (
                  <span className="text-xs" style={{ color: 'var(--lol-text-muted)' }}>
                    {timeAgo(new Date(data.lastSyncedAt).getTime())}
                  </span>
                )}
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition-all"
                  style={{ color: 'var(--lol-gold)', border: '1px solid var(--lol-border-gold)', background: 'color-mix(in srgb, var(--lol-gold-dark) 8%, transparent)', borderRadius: 2 }}
                >
                  <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing' : 'Sync'}
                </button>
              </div>
            </div>

            {/* Overall progress bar */}
            {data?.totalPoints && (
              <div className="mb-8">
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--lol-bg-elevated)' }}>
                  <motion.div
                    className="h-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(data.totalPoints.current / data.totalPoints.max) * 100}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                    style={{ background: 'linear-gradient(90deg, var(--lol-gold-dark), var(--lol-gold))' }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--lol-text-muted)' }}>
                  <span>{totalCompleted} / {totalChallenges} completed</span>
                  <span>{((data.totalPoints.current / data.totalPoints.max) * 100).toFixed(1)}%</span>
                </div>
              </div>
            )}

            {/* Category cards */}
            {data?.categoryPoints && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {CATEGORY_ORDER.filter(c => data.categoryPoints?.[c]).map(cat => {
                  const cp = data.categoryPoints![cat];
                  const pct = cp.max > 0 ? (cp.current / cp.max) * 100 : 0;
                  const t = TIER_HEX[cp.level] || TIER_HEX.NONE;
                  return (
                    <motion.div
                      key={cat}
                      whileHover={{ y: -2 }}
                      className="p-3 relative overflow-hidden"
                      style={{ background: 'var(--lol-bg-surface)', border: `1px solid var(--lol-border)`, borderRadius: 2 }}
                    >
                      <div className="absolute bottom-0 left-0 h-0.5" style={{ width: `${pct}%`, background: t.color, opacity: 0.6 }} />
                      <p className="text-[10px] tracking-widest uppercase mb-1" style={{ color: 'var(--lol-text-muted)' }}>
                        {CATEGORY_LABELS[cat]}
                      </p>
                      <div className="flex items-end justify-between">
                        <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--lol-text-primary)' }}>
                          {cp.current.toLocaleString()}
                        </span>
                        <TierBadge tier={cp.level} />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="sticky top-0 z-30" style={{ background: 'var(--lol-bg-surface)', borderBottom: '1px solid var(--lol-border)' }}>
        <div className="container mx-auto px-4 flex items-center gap-0">
          {[
            { key: 'challenges' as const, label: 'Challenges', count: filtered.length },
            { key: 'games' as const, label: 'Match History', count: games.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative px-5 py-3 text-xs font-semibold tracking-widest uppercase transition-colors"
              style={{ color: tab === t.key ? 'var(--lol-text-primary)' : 'var(--lol-text-muted)' }}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums" style={{ color: tab === t.key ? 'var(--lol-gold)' : 'var(--lol-text-dim)' }}>
                {t.count}
              </span>
              {tab === t.key && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'var(--lol-gold)' }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="container mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {tab === 'games' ? (
            <motion.div key="games" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

              {games.length === 0 ? (
                <p className="text-center py-12" style={{ color: 'var(--lol-text-muted)' }}>No games tracked yet.</p>
              ) : (
                <div>
                  {/* Game mode sub-tabs */}
                  {(() => {
                    const modes = ['ALL', ...Array.from(new Set(games.map(g => g.game_mode)))];
                    const MODE_LABELS: Record<string, string> = { ALL: 'All', CLASSIC: "Summoner's Rift", ARAM: 'ARAM', URF: 'URF', CHERRY: 'Arena' };
                    return (
                      <div className="flex gap-1 mb-4">
                        {modes.map(mode => {
                          const count = mode === 'ALL' ? games.length : games.filter(g => g.game_mode === mode).length;
                          const active = gameModeFilter === mode;
                          return (
                            <button
                              key={mode}
                              onClick={() => setGameModeFilter(mode)}
                              className="relative px-3 py-1.5 text-[10px] font-semibold tracking-widest uppercase transition-colors"
                              style={{
                                color: active ? 'var(--lol-text-primary)' : 'var(--lol-text-muted)',
                                background: active ? 'var(--lol-bg-elevated)' : 'transparent',
                                border: `1px solid ${active ? 'var(--lol-border-gold)' : 'transparent'}`,
                                borderRadius: 2,
                              }}
                            >
                              {MODE_LABELS[mode] || mode}
                              <span className="ml-1 tabular-nums" style={{ color: active ? 'var(--lol-gold)' : 'var(--lol-text-dim)' }}>{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                <div className="space-y-1">
                  {games.filter(g => gameModeFilter === 'ALL' || g.game_mode === gameModeFilter).map((game, gi) => {
                    const expanded = expandedGame === game.id;
                    const tierUps = game.deltas.filter(d => d.old_level !== d.new_level);
                    const ts = Number(game.game_creation);
                    const kda = game.deaths === 0 ? 'Perfect' : ((game.kills + game.assists) / game.deaths).toFixed(1);
                    return (
                      <motion.div
                        key={game.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: gi * 0.03 }}
                      >
                        <div
                          className="flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors"
                          style={{
                            background: expanded ? 'var(--lol-bg-surface)' : 'transparent',
                            borderLeft: `3px solid ${game.win ? 'var(--lol-blue)' : 'var(--lol-red)'}`,
                          }}
                          onClick={() => setExpandedGame(expanded ? null : game.id)}
                        >
                          {/* Result pip */}
                          <div className="w-14 flex-shrink-0 text-center">
                            <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: game.win ? 'var(--lol-blue)' : 'var(--lol-red)' }}>
                              {game.win ? 'WIN' : 'LOSS'}
                            </span>
                          </div>

                          {/* Champion */}
                          <div className="w-28 flex-shrink-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--lol-text-primary)' }}>{game.champion}</p>
                            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--lol-text-muted)' }}>
                              {game.game_mode === 'ARAM' ? 'ARAM' : game.game_mode === 'CLASSIC' ? 'Summoner\'s Rift' : game.game_mode}
                            </p>
                          </div>

                          {/* KDA */}
                          <div className="w-28 flex-shrink-0">
                            <p className="text-sm tabular-nums" style={{ color: 'var(--lol-text-primary)' }}>
                              <span>{game.kills}</span>
                              <span style={{ color: 'var(--lol-text-muted)' }}> / </span>
                              <span style={{ color: 'var(--lol-red)' }}>{game.deaths}</span>
                              <span style={{ color: 'var(--lol-text-muted)' }}> / </span>
                              <span>{game.assists}</span>
                            </p>
                            <p className="text-[10px] tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                              {kda} KDA
                            </p>
                          </div>

                          {/* Duration */}
                          <div className="w-14 flex-shrink-0 text-xs tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                            {formatDuration(game.game_duration)}
                          </div>

                          {/* Challenge badges */}
                          <div className="flex-1 flex items-center gap-2">
                            {game.deltas.length > 0 && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: 'var(--lol-blue)', background: 'color-mix(in srgb, var(--lol-blue) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--lol-blue) 19%, transparent)', borderRadius: 2 }}>
                                {game.deltas.length} UPDATED
                              </span>
                            )}
                            {tierUps.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: 'var(--lol-gold)', background: 'color-mix(in srgb, var(--lol-gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--lol-gold) 19%, transparent)', borderRadius: 2 }}>
                                <ArrowUp className="h-2.5 w-2.5" />
                                {tierUps.length} TIER-UP{tierUps.length !== 1 ? 'S' : ''}
                              </span>
                            )}
                          </div>

                          {/* Time */}
                          <span className="text-[10px] flex-shrink-0 tabular-nums" style={{ color: 'var(--lol-text-dim)' }}>
                            {timeAgo(ts)}
                          </span>

                          {game.deltas.length > 0 && (
                            <ChevronDown
                              className="h-3.5 w-3.5 transition-transform flex-shrink-0"
                              style={{ color: 'var(--lol-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            />
                          )}
                        </div>

                        {/* Expanded deltas */}
                        <AnimatePresence>
                          {expanded && game.deltas.length > 0 && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-3 pt-1 ml-[3px]" style={{ borderLeft: `3px solid ${game.win ? 'color-mix(in srgb, var(--lol-blue) 13%, transparent)' : 'color-mix(in srgb, var(--lol-red) 13%, transparent)'}` }}>
                                <div className="flex gap-1 mb-2">
                                  {([['default', 'Default'], ['nearest', 'Nearest'], ['rarest', 'Rarest'], ['tier', 'Tier ↓']] as const).map(([key, label]) => (
                                    <button
                                      key={key}
                                      onClick={e => { e.stopPropagation(); setDeltaSortBy(key); }}
                                      className="px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors"
                                      style={{
                                        color: deltaSortBy === key ? 'var(--lol-text-primary)' : 'var(--lol-text-muted)',
                                        background: deltaSortBy === key ? 'var(--lol-bg-elevated)' : 'transparent',
                                        border: `1px solid ${deltaSortBy === key ? 'var(--lol-border-gold)' : 'transparent'}`,
                                        borderRadius: 2,
                                      }}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-1">
                                  {sortDeltas(game.deltas).map((d, di) => {
                                    const tierChanged = d.old_level !== d.new_level;
                                    const delta = d.new_value - d.old_value;
                                    const fullChallenge = challengeMap[d.challenge_id];
                                    const progress = fullChallenge ? getProgress(fullChallenge) : null;
                                    const t = TIER_HEX[d.new_level] || TIER_HEX.NONE;
                                    const showBelow = di < 6;
                                    return (
                                      <div
                                        key={d.challenge_id}
                                        className="relative group flex items-center gap-3 px-3 py-2"
                                        style={{ background: 'color-mix(in srgb, var(--lol-bg-surface) 50%, transparent)', borderRadius: 2 }}
                                      >
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs truncate" style={{ color: 'var(--lol-text-secondary)' }}>{d.name}</p>
                                          <p className="text-[10px] tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                                            {d.old_value.toLocaleString()} → {d.new_value.toLocaleString()}
                                            <span style={{ color: 'var(--lol-blue)' }}> +{delta.toLocaleString()}</span>
                                          </p>
                                        </div>
                                        {tierChanged ? (
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            <TierBadge tier={d.old_level} />
                                            <span style={{ color: 'var(--lol-text-muted)' }}>→</span>
                                            <TierBadge tier={d.new_level} />
                                          </div>
                                        ) : (
                                          <TierBadge tier={d.new_level} />
                                        )}
                                        {/* Hover tooltip */}
                                        {fullChallenge && (
                                          <div
                                            className={`absolute left-0 z-50 w-72 p-3 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 ${showBelow ? 'top-full mt-1' : 'bottom-full mb-1'}`}
                                            style={{ background: 'var(--lol-bg-surface)', border: `1px solid var(--lol-border-gold)`, borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                                          >
                                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--lol-text-primary)' }}>{fullChallenge.name}</p>
                                            <p className="text-[10px] mb-2" style={{ color: 'var(--lol-text-secondary)' }}>
                                              {stripHtml(fullChallenge.description || fullChallenge.short_description)}
                                            </p>
                                            {progress && progress.nextTier !== 'MAX' && (
                                              <div className="mb-2">
                                                <div className="flex justify-between text-[10px] mb-1 tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                                                  <span>{d.new_value.toLocaleString()} / {progress.nextThreshold.toLocaleString()}</span>
                                                  <span>{progress.nextTier}</span>
                                                </div>
                                                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--lol-bg-elevated)' }}>
                                                  <div className="h-full" style={{ width: `${progress.percent}%`, background: `linear-gradient(90deg, ${t.color}80, ${t.color})`, borderRadius: 999 }} />
                                                </div>
                                              </div>
                                            )}
                                            {progress?.nextTier === 'MAX' && (
                                              <p className="text-[10px] font-semibold mb-2" style={{ color: 'var(--lol-gold)' }}>MAX TIER</p>
                                            )}
                                            <div className="flex items-center justify-between">
                                              <TierBadge tier={d.new_level} />
                                              {fullChallenge.percentile != null && (
                                                <span className="text-[10px]" style={{ color: 'var(--lol-gold-dark)' }}>Top {(fullChallenge.percentile * 100).toFixed(1)}%</span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="challenges" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 mb-6">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--lol-text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search challenges..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs outline-none"
                    style={{ background: 'var(--lol-bg-surface)', border: '1px solid var(--lol-border)', color: 'var(--lol-text-secondary)', borderRadius: 2 }}
                  />
                </div>
                {[
                  { value: tierFilter, set: setTierFilter, options: [['ALL', 'All Tiers'], ...TIER_ORDER.map(t => [t, t])] },
                  { value: categoryFilter, set: setCategoryFilter, options: [['ALL', 'All Categories'], ...CATEGORY_ORDER.map(c => [c, CATEGORY_LABELS[c] || c])] },
                  { value: gameModeFilterChallenges, set: setGameModeFilterChallenges, options: [['ALL', 'All Modes'], ['SR', "Summoner's Rift"], ['ARAM', 'ARAM'], ['ARENA', 'Arena'], ['CO-OP', 'Co-op vs AI'], ['SWARM', 'Swarm']] },
                  { value: sortBy, set: (v: string) => setSortBy(v as typeof sortBy), options: [['name', 'Name'], ['percentile', 'Rarest'], ['progress', 'Nearest']] },
                ].map((sel, i) => (
                  <select
                    key={i}
                    value={sel.value}
                    onChange={e => sel.set(e.target.value)}
                    className="px-3 py-2 text-xs outline-none cursor-pointer"
                    style={{ background: 'var(--lol-bg-surface)', border: '1px solid var(--lol-border)', color: 'var(--lol-text-secondary)', borderRadius: 2 }}
                  >
                    {sel.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                ))}
              </div>

              {/* Category Groups */}
              {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => {
                const challenges = grouped[cat];
                const isExpanded = expandedCategories.has(cat);
                const completed = challenges.filter(c => c.level && c.level !== 'NONE').length;
                const pct = challenges.length > 0 ? Math.round((completed / challenges.length) * 100) : 0;
                return (
                  <div key={cat} className="mb-3">
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="flex items-center gap-3 w-full text-left py-2.5 px-3 transition-colors"
                      style={{ background: isExpanded ? 'var(--lol-bg-surface)' : 'transparent', borderRadius: 2 }}
                    >
                      <ChevronRight
                        className="h-3.5 w-3.5 transition-transform"
                        style={{ color: 'var(--lol-gold)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      />
                      <span className="text-xs font-semibold tracking-widest uppercase flex-1" style={{ color: 'var(--lol-text-primary)' }}>
                        {CATEGORY_LABELS[cat] || cat}
                      </span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                        {completed}/{challenges.length}
                      </span>
                      <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: 'var(--lol-bg-elevated)' }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: 'var(--lol-gold)' }} />
                      </div>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 pb-2 px-1">
                            {challenges.map(c => {
                              const level = c.level || 'NONE';
                              const progress = getProgress(c);
                              const t = TIER_HEX[level] || TIER_HEX.NONE;
                              const isPerChamp = /different champions/i.test(c.description || c.short_description || '');
                              const isDetailExpanded = expandedChallenge === c.challenge_id;
                              const gameMode = getGameMode(c.challenge_id, (c.description || '') + ' ' + (c.short_description || ''));
                              const gmStyle = gameMode && gameMode !== 'SR' ? GAME_MODE_LABELS[gameMode] : null;
                              return (
                                <div key={c.challenge_id} className="flex flex-col" style={{ minHeight: 0 }}>
                                  <div
                                    className={`p-3 flex flex-col justify-between flex-1 transition-colors ${isPerChamp ? 'cursor-pointer' : ''}`}
                                    style={{ background: 'var(--lol-bg-surface)', border: `1px solid ${isDetailExpanded ? t.glow : 'var(--lol-border)'}`, borderRadius: 2, minHeight: 120, gap: 8 }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = t.glow; }}
                                    onMouseLeave={e => { if (!isDetailExpanded) (e.currentTarget as HTMLElement).style.borderColor = 'var(--lol-border)'; }}
                                    onClick={() => isPerChamp && setExpandedChallenge(isDetailExpanded ? null : c.challenge_id)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium truncate" style={{ color: 'var(--lol-text-primary)' }}>{c.name}</p>
                                        <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: 'var(--lol-text-secondary)' }}>
                                          {stripHtml(c.short_description || c.description)}
                                        </p>
                                      </div>
                                      <TierBadge tier={level} />
                                    </div>
                                    {progress && (
                                      <div>
                                        <div className="flex justify-between text-[10px] mb-1 tabular-nums" style={{ color: 'var(--lol-text-muted)' }}>
                                          <span>{c.value?.toLocaleString() ?? 0}{isPerChamp ? ` / ${totalChampions} champs` : ''}</span>
                                          <span>{progress.nextTier !== 'MAX' ? `${progress.nextThreshold.toLocaleString()} (${progress.nextTier})` : 'MAX'}</span>
                                        </div>
                                        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--lol-bg-elevated)' }}>
                                          <div
                                            className="h-full transition-all"
                                            style={{ width: `${progress.percent}%`, background: `linear-gradient(90deg, ${t.color}80, ${t.color})`, borderRadius: 999 }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {c.percentile !== null && c.percentile !== undefined && (
                                          <p className="text-[10px]" style={{ color: 'var(--lol-gold-dark)' }}>Top {(c.percentile * 100).toFixed(1)}%</p>
                                        )}
                                        {gmStyle && (
                                          <span
                                            className="text-[9px] font-semibold tracking-wider uppercase px-1.5 py-px"
                                            style={{ color: gmStyle.color, background: `${gmStyle.color}15`, border: `1px solid ${gmStyle.color}30`, borderRadius: 2 }}
                                          >
                                            {gmStyle.label}
                                          </span>
                                        )}
                                      </div>
                                      {isPerChamp && (
                                        <p className="text-[10px]" style={{ color: 'var(--lol-text-muted)' }}>
                                          {isDetailExpanded ? '▾ collapse' : '▸ champion detail'}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <AnimatePresence>
                                    {isPerChamp && isDetailExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                      >
                                        {(() => {
                                          const cp = championProgress[String(c.challenge_id)];
                                          const completedNames = cp?.champions || [];
                                          const remaining = allChampionNames.filter(n => !completedNames.includes(n));
                                          const hasData = completedNames.length > 0;
                                          return (
                                            <div className="p-3 mt-px" style={{ background: 'color-mix(in srgb, var(--lol-bg-surface) 50%, transparent)', border: '1px solid var(--lol-border)', borderTop: 'none', borderRadius: '0 0 2px 2px' }}>
                                              <div className="flex items-center gap-3 mb-2">
                                                <div className="flex-1">
                                                  <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--lol-text-muted)' }}>
                                                    <span>Champion progress</span>
                                                    <span className="tabular-nums">{Math.round(c.value ?? 0)} / {totalChampions}</span>
                                                  </div>
                                                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--lol-bg-elevated)' }}>
                                                    <motion.div
                                                      className="h-full"
                                                      initial={{ width: 0 }}
                                                      animate={{ width: `${((c.value ?? 0) / totalChampions) * 100}%` }}
                                                      transition={{ duration: 0.6 }}
                                                      style={{ background: `linear-gradient(90deg, ${t.color}80, ${t.color})`, borderRadius: 999 }}
                                                    />
                                                  </div>
                                                </div>
                                              </div>
                                              {hasData ? (
                                                <>
                                                  {remaining.length > 0 && (
                                                    <div className="mb-2">
                                                      <p className="text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--lol-red)' }}>
                                                        Remaining ({remaining.length})
                                                      </p>
                                                      <div className="flex flex-wrap gap-1">
                                                        {remaining.map(name => (
                                                          <span key={name} className="text-[10px] px-1.5 py-0.5" style={{ color: 'var(--lol-text-secondary)', background: 'var(--lol-bg-elevated)', borderRadius: 2 }}>
                                                            {name}
                                                          </span>
                                                        ))}
                                                      </div>
                                                    </div>
                                                  )}
                                                  <div>
                                                    <p className="text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--lol-blue)' }}>
                                                      Completed ({completedNames.length})
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                      {completedNames.map(name => (
                                                        <span key={name} className="text-[10px] px-1.5 py-0.5" style={{ color: 'var(--lol-blue)', background: 'color-mix(in srgb, var(--lol-blue) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--lol-blue) 19%, transparent)', borderRadius: 2 }}>
                                                          {name}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                </>
                                              ) : (
                                                <>
                                                  <p className="text-[10px] mb-1" style={{ color: 'var(--lol-text-muted)' }}>
                                                    {totalChampions - Math.round(c.value ?? 0)} champions remaining
                                                  </p>
                                                  <p className="text-[10px]" style={{ color: 'var(--lol-text-dim)' }}>
                                                    Per-champion data will sync from the overlay app once connected. The public Riot API does not expose which specific champions have been completed.
                                                  </p>
                                                </>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <p className="text-center py-12" style={{ color: 'var(--lol-text-muted)' }}>No challenges match your filters.</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
