import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { tierPoints, tokenIconPath, categoryIconPath, crystalPath, TIERS } from '@/lib/cdragon';

export const dynamic = 'force-dynamic';

export interface ChallengeNode {
  challengeId: number;
  name: string;
  description: string;
  shortDescription: string;
  /** 'category' (the 6 roots) | 'capstone' (a group) | 'challenge' (a leaf). */
  kind: 'category' | 'capstone' | 'challenge';
  parentId: number | null;
  childIds: number[];
  state: string;
  level: string;
  value: number | null;
  /** Threshold for the next tier up, or null once maxed. */
  nextThreshold: number | null;
  nextLevel: string | null;
  thresholds: Record<string, number>;
  /** Fraction of players at or above each tier — the 9-point rarity curve. */
  percentiles: Record<string, number>;
  /** Fraction of players who reached exactly the player's current tier. */
  percentile: number | null;
  /** Points this node contributes to its parent at its current tier. */
  points: number;
  /** Points it would contribute at the next tier, for "next level rewards". */
  nextPoints: number | null;
  /** False for delisted challenges that keep progress but no longer score. */
  isScoring: boolean;
  leaderboard: boolean;
  endTimestamp: number | null;
  source: string | null;
  queueIds: number[];
  rewards: Record<string, unknown[]>;
  icon: string;
  achievedTime: number | null;
  position: number | null;
  playersInLevel: number | null;

  // ── Deprecated snake_case aliases ────────────────────────────────────────
  // The current challenges page still reads these. Kept so the data layer can
  // land without blanking the page; delete them once the page is rewritten
  // against the fields above.
  /** @deprecated use `challengeId` */
  challenge_id: string;
  /** @deprecated use `shortDescription` */
  short_description: string;
  /** @deprecated derived from the real hierarchy now — use `parentId`/`kind` */
  category: string;
  /** @deprecated always [] upstream; the real data is `source`/`queueIds` */
  tags: string[];
}

interface Row {
  challenge_id: string;
  name: string | null;
  description: string | null;
  short_description: string | null;
  state: string | null;
  category: string | null;
  thresholds: Record<string, number> | null;
  percentiles: Record<string, number> | null;
  parent_id: string | null;
  is_capstone: boolean;
  is_category: boolean;
  is_scoring: boolean;
  leaderboard: boolean | null;
  end_timestamp: string | null;
  source: string | null;
  queue_ids: number[] | null;
  rewards: Record<string, unknown[]> | null;
  level: string | null;
  value: number | null;
  percentile: number | null;
  achieved_time: string | null;
  position: number | null;
  players_in_level: string | null;
}

// pg returns bigint as a string to avoid precision loss; every id in this
// domain is far below 2^53, so normalising to number at the API edge is safe
// and spares the client from string/number id comparisons.
const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Art for a node. The six category roots have an empty levelToIconPath upstream
 * and no tokens of their own, so they fall back to the static-assets glyphs:
 * the tiered CRYSTAL gem for id 0, the flat category glyph for 1-5.
 */
function iconFor(id: number, kind: string, level: string): string {
  if (id === 0) return crystalPath(level);
  if (kind === 'category') return categoryIconPath(id, 'png') ?? crystalPath(level);
  return tokenIconPath(id, level === 'NONE' ? 'iron' : level);
}

/** Next tier above `level` that this challenge actually defines a threshold for. */
function nextTier(level: string, thresholds: Record<string, number>) {
  const start = level === 'NONE' ? 0 : TIERS.indexOf(level as (typeof TIERS)[number]) + 1;
  for (let i = start; i < TIERS.length; i++) {
    const t = TIERS[i];
    if (thresholds[t] !== undefined) return { level: t, threshold: thresholds[t] };
  }
  return null;
}

export async function GET() {
  try {
    const { rows } = await pool.query<Row>(
      `SELECT c.challenge_id, c.name, c.description, c.short_description, c.state, c.category,
              c.thresholds, c.percentiles, c.parent_id, c.is_capstone, c.is_category,
              c.is_scoring, c.leaderboard, c.end_timestamp, c.source, c.queue_ids, c.rewards,
              p.level, p.value, p.percentile, p.achieved_time, p.position, p.players_in_level
         FROM challenge_configs c
         LEFT JOIN challenge_progress p ON p.challenge_id = c.challenge_id
        WHERE c.state = 'ENABLED'
        ORDER BY c.name`
    );

    const syncRow = await pool.query(
      `SELECT last_synced_at, details FROM sync_metadata WHERE key = 'challenges'`
    );
    const meta = syncRow.rows[0] || { last_synced_at: null, details: {} };

    const childIds = new Map<number, number[]>();
    for (const r of rows) {
      const pid = num(r.parent_id);
      if (pid === null) continue;
      const list = childIds.get(pid);
      if (list) list.push(Number(r.challenge_id));
      else childIds.set(pid, [Number(r.challenge_id)]);
    }

    const challenges: ChallengeNode[] = rows.map((r) => {
      const id = Number(r.challenge_id);
      const level = r.level ?? 'NONE';
      const thresholds = r.thresholds ?? {};
      const next = nextTier(level, thresholds);
      const kind = r.is_category ? 'category' : r.is_capstone ? 'capstone' : 'challenge';
      return {
        challengeId: id,
        name: r.name ?? `Challenge ${id}`,
        description: r.description ?? '',
        shortDescription: r.short_description ?? '',
        kind,
        parentId: num(r.parent_id),
        childIds: childIds.get(id) ?? [],
        state: r.state ?? 'ENABLED',
        level,
        value: r.value,
        nextThreshold: next?.threshold ?? null,
        nextLevel: next?.level ?? null,
        thresholds,
        percentiles: r.percentiles ?? {},
        percentile: r.percentile,
        points: r.is_scoring ? tierPoints(level) : 0,
        nextPoints: next && r.is_scoring ? tierPoints(next.level) : null,
        isScoring: r.is_scoring,
        leaderboard: r.leaderboard ?? false,
        endTimestamp: num(r.end_timestamp),
        source: r.source,
        queueIds: r.queue_ids ?? [],
        rewards: r.rewards ?? {},
        icon: iconFor(id, kind, level),
        achievedTime: num(r.achieved_time),
        position: r.position,
        playersInLevel: num(r.players_in_level),

        challenge_id: r.challenge_id,
        short_description: r.short_description ?? '',
        category: r.category ?? 'OTHER',
        tags: [],
      };
    });

    return NextResponse.json({
      lastSyncedAt: meta.last_synced_at,
      totalPoints: meta.details?.totalPoints || null,
      categoryPoints: meta.details?.categoryPoints || null,
      challenges,
    });
  } catch (error) {
    console.error('Error fetching challenges:', error);
    return NextResponse.json({ error: 'Failed to fetch challenges' }, { status: 500 });
  }
}
