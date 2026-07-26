'use client';

/**
 * RM 04 — Match History.
 *
 * Self-contained tab for the challenges room: the last 50 tracked games, each
 * one carrying the challenge deltas that were attributed to it by the poller.
 * That attribution is the reason this view exists — expanding a game shows
 * exactly which challenges moved, by how much, and whether the move crossed a
 * tier boundary.
 *
 * Fetches its own games, but takes the challenge tree as a prop: the page has
 * already loaded it, and re-fetching ~450 nodes on every tab switch bought
 * nothing. Renders only the tab body, never the page header or tab bar.
 *
 * Palette comes from the `.lol-theme` scope on the page shell — utilities only
 * (bg-card, text-muted-foreground, text-accent, …). The single exception is the
 * tier ramp, which is a CSS variable ramp read through `tierVar()`.
 */

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ChallengeNode } from './types';
import { MatchHistorySkeleton } from './skeleton';

// ── Types ──────────────────────────────────────────────

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

/** Only the slice of the challenge record the deltas need. */
// The challenge tree comes in as a prop from the page, which has already
// fetched it — see the note on the component below.

type DeltaSort = 'default' | 'nearest' | 'rarest' | 'tier';

// ── Constants ──────────────────────────────────────────

const TIER_ORDER = ['NONE', 'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

const MODE_LABELS: Record<string, string> = {
  ALL: 'All',
  CLASSIC: "Summoner's Rift",
  ARAM: 'ARAM',
  URF: 'URF',
  CHERRY: 'Arena',
};

const DELTA_SORTS: [DeltaSort, string][] = [
  ['default', 'Default'],
  ['nearest', 'Nearest'],
  ['rarest', 'Rarest'],
  ['tier', 'Tier ↓'],
];

const SPRING = { type: 'spring' as const, stiffness: 320, damping: 26 };

// ── Helpers ────────────────────────────────────────────

/** The tier ramp lives in `.lol-theme`; no hex map belongs in TSX. */
const tierVar = (level: string) => `var(--lol-tier-${(level || 'NONE').toLowerCase()})`;

function stripHtml(str: string) {
  return str.replace(/<[^>]*>/g, '');
}

/** Clock-style game length (`m:ss`) — distinct from the compact `fmtDuration`. */
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

/**
 * Progress WITHIN the current tier, unlike the room's bars which show value
 * over the next threshold. That is deliberate here: the "nearest" sort is
 * asking which challenges are closest to levelling up, and a challenge sitting
 * just past a tier boundary is not close to the next one.
 */
function getProgress(challenge: ChallengeNode): { percent: number; currentThreshold: number; nextThreshold: number; nextTier: string } | null {
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

// ── Pieces ─────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const c = tierVar(tier);
  return (
    <span
      className="inline-flex items-center rounded-sm border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
      }}
    >
      {tier}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors ${
        active
          ? 'border-primary/60 bg-muted text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ── Component ──────────────────────────────────────────

export default function MatchHistory({ challenges }: { challenges: ChallengeNode[] }) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameModeFilter, setGameModeFilter] = useState('ALL');
  const [deltaSortBy, setDeltaSortBy] = useState<DeltaSort>('default');
  const [expandedGame, setExpandedGame] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/challenges/games')
      .then(r => r.json())
      .then((rows: Game[]) => setGames(Array.isArray(rows) ? rows : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  /** Challenge lookup by id — powers the delta tooltips and the rarity sorts. */
  const challengeMap = useMemo(() => {
    const map: Record<string, ChallengeNode> = {};
    for (const c of challenges) map[String(c.challengeId)] = c;
    return map;
  }, [challenges]);

  const modes = useMemo(() => ['ALL', ...Array.from(new Set(games.map(g => g.game_mode)))], [games]);

  const visible = useMemo(
    () => games.filter(g => gameModeFilter === 'ALL' || g.game_mode === gameModeFilter),
    [games, gameModeFilter],
  );

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

  if (loading) return <MatchHistorySkeleton />;

  if (games.length === 0) {
    return <p className="py-12 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">No games tracked yet.</p>;
  }

  return (
    <div>
      {/* ── Mode filter ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Mode</span>
        <div className="flex flex-wrap gap-1">
          {modes.map(mode => {
            const count = mode === 'ALL' ? games.length : games.filter(g => g.game_mode === mode).length;
            return (
              <Chip key={mode} active={gameModeFilter === mode} onClick={() => setGameModeFilter(mode)}>
                {MODE_LABELS[mode] || mode}
                <span className={`ml-1.5 font-mono tabular-nums ${gameModeFilter === mode ? 'text-primary' : 'text-muted-foreground/60'}`}>
                  {count}
                </span>
              </Chip>
            );
          })}
        </div>
        <span className="lol-rule ml-1 hidden sm:block" />
      </div>

      {/* ── Match rows ── */}
      <div className="space-y-1">
        {visible.map((game, gi) => {
          const expanded = expandedGame === game.id;
          const tierUps = game.deltas.filter(d => d.old_level !== d.new_level);
          const ts = Number(game.game_creation);
          const kda = game.deaths === 0 ? 'Perfect' : ((game.kills + game.assists) / game.deaths).toFixed(1);
          const hasDeltas = game.deltas.length > 0;
          return (
            <motion.div
              key={game.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(gi * 0.03, 0.4) }}
            >
              <motion.div
                whileHover={{ y: -2 }}
                transition={SPRING}
                className={`lol-plate flex items-stretch ${expanded ? 'lol-plate-gold' : ''} ${hasDeltas ? 'cursor-pointer' : ''}`}
                onClick={() => hasDeltas && setExpandedGame(expanded ? null : game.id)}
              >
                {/* Result rail */}
                <span className={`w-[3px] flex-shrink-0 ${game.win ? 'bg-accent' : 'bg-destructive'}`} />

                <div className="flex flex-1 items-center gap-4 px-4 py-3 min-w-0">
                  {/* Result */}
                  <div className="w-14 flex-shrink-0 text-center">
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${game.win ? 'text-accent' : 'text-destructive'}`}>
                      {game.win ? 'Win' : 'Loss'}
                    </span>
                  </div>

                  {/* Champion */}
                  <div className="w-28 flex-shrink-0">
                    <p className="truncate text-sm font-semibold text-foreground">{game.champion}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {MODE_LABELS[game.game_mode] || game.game_mode}
                    </p>
                  </div>

                  {/* KDA */}
                  <div className="w-28 flex-shrink-0">
                    <p className="font-mono text-sm tabular-nums text-foreground">
                      <span>{game.kills}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-destructive">{game.deaths}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span>{game.assists}</span>
                    </p>
                    <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{kda} KDA</p>
                  </div>

                  {/* Duration */}
                  <div className="w-14 flex-shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDuration(game.game_duration)}
                  </div>

                  {/* Attribution badges */}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {hasDeltas && (
                      <span className="rounded-sm border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                        {game.deltas.length} Updated
                      </span>
                    )}
                    {tierUps.length > 0 && (
                      <span className="flex items-center gap-0.5 rounded-sm border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                        <ArrowUp className="h-2.5 w-2.5" />
                        {tierUps.length} Tier-up{tierUps.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Time */}
                  <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {timeAgo(ts)}
                  </span>

                  {hasDeltas && (
                    <ChevronDown
                      className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  )}
                </div>
              </motion.div>

              {/* ── Expanded delta attribution ── */}
              <AnimatePresence initial={false}>
                {expanded && hasDeltas && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className={`border-l-[3px] px-4 pt-2 pb-3 ${game.win ? 'border-accent/20' : 'border-destructive/20'}`}>
                      {/* Sort controls */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Sort</span>
                        <div className="flex flex-wrap gap-1">
                          {DELTA_SORTS.map(([key, label]) => (
                            <Chip
                              key={key}
                              active={deltaSortBy === key}
                              onClick={e => { e.stopPropagation(); setDeltaSortBy(key); }}
                            >
                              {label}
                            </Chip>
                          ))}
                        </div>
                        <span className="lol-rule hidden sm:block" />
                      </div>

                      <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
                        {sortDeltas(game.deltas).map((d, di) => {
                          const tierChanged = d.old_level !== d.new_level;
                          const delta = d.new_value - d.old_value;
                          const fullChallenge = challengeMap[d.challenge_id];
                          const progress = fullChallenge ? getProgress(fullChallenge) : null;
                          const c = tierVar(d.new_level);
                          const showBelow = di < 6;
                          return (
                            <div
                              key={d.challenge_id}
                              className="group relative flex items-center gap-3 rounded-sm border border-border/60 bg-card/50 px-3 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-muted-foreground">{d.name}</p>
                                <p className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                                  {d.old_value.toLocaleString()} → {d.new_value.toLocaleString()}
                                  <span className="text-accent"> +{delta.toLocaleString()}</span>
                                </p>
                              </div>
                              {tierChanged ? (
                                <div className="flex flex-shrink-0 items-center gap-1">
                                  <TierBadge tier={d.old_level} />
                                  <span className="text-muted-foreground">→</span>
                                  <TierBadge tier={d.new_level} />
                                </div>
                              ) : (
                                <TierBadge tier={d.new_level} />
                              )}

                              {/* Hover detail */}
                              {fullChallenge && (
                                <div
                                  className={`lol-plate lol-plate-gold pointer-events-none absolute left-0 z-50 w-72 p-3 opacity-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-opacity duration-150 group-hover:opacity-100 ${
                                    showBelow ? 'top-full mt-1' : 'bottom-full mb-1'
                                  }`}
                                >
                                  <p className="mb-1 text-xs font-medium text-foreground">{fullChallenge.name}</p>
                                  <p className="mb-2 text-[10px] text-muted-foreground">
                                    {stripHtml(fullChallenge.description || fullChallenge.shortDescription)}
                                  </p>
                                  {progress && progress.nextTier !== 'MAX' && (
                                    <div className="mb-2">
                                      <div className="mb-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                                        <span>{d.new_value.toLocaleString()} / {progress.nextThreshold.toLocaleString()}</span>
                                        <span>{progress.nextTier}</span>
                                      </div>
                                      <div className="lol-bar-track h-1 overflow-hidden">
                                        <div
                                          className="h-full"
                                          style={{
                                            width: `${progress.percent}%`,
                                            background: `linear-gradient(90deg, color-mix(in srgb, ${c} 55%, transparent), ${c})`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  )}
                                  {progress?.nextTier === 'MAX' && (
                                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Max tier</p>
                                  )}
                                  <div className="flex items-center justify-between">
                                    <TierBadge tier={d.new_level} />
                                    {fullChallenge.percentile != null && (
                                      <span className="font-mono text-[10px] tabular-nums text-primary/80">
                                        Top {(fullChallenge.percentile * 100).toFixed(1)}%
                                      </span>
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

      {visible.length === 0 && (
        <p className="py-12 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
          No games in this mode.
        </p>
      )}
    </div>
  );
}
