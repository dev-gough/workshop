/**
 * Client-side view of the challenge tree.
 *
 * Mirrors the `ChallengeNode` shape returned by `/api/challenges`. The server
 * already derives everything structural (kind, rail bucket, next tier, points),
 * so nothing here re-walks the tree — these are display helpers only.
 */

export interface ChallengeNode {
  challengeId: number;
  name: string;
  description: string;
  shortDescription: string;
  kind: 'category' | 'capstone' | 'group' | 'challenge';
  parentId: number | null;
  categoryId: number;
  childIds: number[];
  state: string;
  level: string;
  value: number | null;
  nextThreshold: number | null;
  nextLevel: string | null;
  thresholds: Record<string, number>;
  percentiles: Record<string, number>;
  percentile: number | null;
  points: number;
  nextPoints: number | null;
  isScoring: boolean;
  leaderboard: boolean;
  endTimestamp: number | null;
  source: string | null;
  queueIds: number[];
  rewards: Record<string, RewardEntry[]>;
  icon: string;
  achievedTime: number | null;
  position: number | null;
  playersInLevel: number | null;
}

/** A threshold reward as CommunityDragon describes it (title, capstone points…). */
export interface RewardEntry {
  category?: string;
  quantity?: number;
  title?: string;
  name?: string;
}

export interface CategoryPoints {
  max: number;
  level: string;
  current: number;
  percentile: number;
}

export interface ChallengeData {
  lastSyncedAt: string | null;
  totalPoints: CategoryPoints | null;
  categoryPoints: Record<string, CategoryPoints> | null;
  challenges: ChallengeNode[];
}

export const TIERS = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
] as const;

/** Every tier including the un-started one, in ramp order. */
export const ALL_TIERS = ['NONE', ...TIERS] as const;

/**
 * Tier colour, read straight from the `.lol-theme` ramp in globals.css. There
 * is deliberately no tier→hex map in TSX any more: the palette lives in one
 * place so a theme tweak doesn't have to be chased through components.
 */
export function tierVar(level: string | null | undefined): string {
  return `var(--lol-tier-${(level || 'NONE').toLowerCase()})`;
}

/** Riot ships descriptions with markup in them; the client renders them flat. */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fraction of the way to the next tier, as the client draws it: current value
 * over the *next threshold*, not over the category maximum. Maxed nodes read
 * as full rather than as a division by nothing.
 */
export function progressFraction(c: Pick<ChallengeNode, 'value' | 'nextThreshold'>): number {
  if (c.nextThreshold === null) return 1;
  if (!c.nextThreshold) return 0;
  return Math.max(0, Math.min(1, (c.value ?? 0) / c.nextThreshold));
}

/**
 * "2910 / 3200", or just the value once there is no tier left to chase.
 * Unseparated on purpose — the client writes bar values bare and reserves the
 * thousands comma for the crystal total ("12,165").
 */
export function progressLabel(c: Pick<ChallengeNode, 'value' | 'nextThreshold'>): string {
  const v = Math.round(c.value ?? 0);
  return c.nextThreshold === null ? String(v) : `${v} / ${c.nextThreshold}`;
}

/**
 * Share of players who reached exactly this tier. Riot gives percentiles as a
 * fraction; the client prints one decimal ("6.5% of players earned").
 */
export function pctLabel(fraction: number | null | undefined): string | null {
  if (fraction === null || fraction === undefined) return null;
  const pct = fraction * 100;
  if (pct <= 0) return null;
  return `${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

/** Capitalised tier for prose ("Platinum"), vs the SHOUTED display form. */
export function titleTier(level: string): string {
  return level.charAt(0) + level.slice(1).toLowerCase();
}
