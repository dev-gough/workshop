/**
 * CommunityDragon / Data Dragon metadata for LoL challenges.
 *
 * Riot's own `/lol/challenges/v1/challenges/config` returns only
 * `{ id, localizedNames, state, leaderboard, thresholds, endTimestamp }` — no
 * icons, no category, and crucially no parent link. The capstone → group →
 * challenge tree the client UI is built around exists only in CommunityDragon's
 * manifest, under `tags`.
 *
 * Data Dragon is consulted for one narrow purpose: its challenge list is the
 * authority on which challenges still *score*. See `isScoring` below.
 *
 * Both are third-party/undocumented surfaces, so every consumer must tolerate a
 * failed fetch — `fetchChallengeMeta()` returns null rather than throwing, and
 * the sync falls back to leaving existing hierarchy columns untouched.
 */

const CDRAGON_MANIFEST =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/challenges.json';
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CHALLENGES = (v: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/challenges.json`;

export const TIERS = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Points a challenge contributes to its parent at each tier.
 *
 * Not documented by Riot and not present in any manifest — solved from the data
 * itself. Every capstone/group node's `value` is the sum of the points of all
 * its descendants, which yields ~46 independent equations over 9 unknowns; the
 * unique monotonic integer solution below satisfies 44 of them outright, and the
 * two stragglers are exactly the delisted challenges handled by `is_scoring`.
 * With those excluded the rollup reproduces all five category totals and the
 * grand total (12,165) exactly.
 *
 * Independently corroborated by the client UI: the MIGHT capstone sits at
 * PLATINUM showing a "40" badge, with "NEXT LEVEL REWARDS: 60 Capstone
 * Progress" for DIAMOND.
 *
 * Note the cap — MASTER, GRANDMASTER and CHALLENGER are all worth 100.
 */
export const TIER_POINTS: Record<string, number> = {
  NONE: 0, IRON: 5, BRONZE: 10, SILVER: 15, GOLD: 25,
  PLATINUM: 40, DIAMOND: 60, MASTER: 100, GRANDMASTER: 100, CHALLENGER: 100,
};

export function tierPoints(level: string | null | undefined): number {
  return TIER_POINTS[level ?? 'NONE'] ?? 0;
}

export interface ChallengeMeta {
  challengeId: number;
  parentId: number | null;
  isCapstone: boolean;
  isCategory: boolean;
  /** False for challenges Riot still reports but that no longer award points. */
  isScoring: boolean;
  source: string | null;
  queueIds: number[];
  /** TIER -> reward descriptors (titles, capstone progress) for the detail card. */
  rewards: Record<string, unknown[]>;
}

interface CDragonEntry {
  name?: string;
  source?: string;
  queueIds?: number[];
  tags?: Record<string, string>;
  thresholds?: Record<string, { value?: number; rewards?: unknown[] }>;
}

async function getJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return res.json() as Promise<T>;
}

/**
 * The set of challenge ids Data Dragon still lists. Absence from this list is
 * how a delisted-but-still-reported challenge is detected: such a challenge
 * keeps its stored progress but must not count toward any parent's total.
 * Returns null if ddragon is unreachable, in which case callers should treat
 * every challenge as scoring rather than silently zeroing them out.
 */
async function fetchScoringIds(): Promise<Set<number> | null> {
  try {
    const versions = await getJson<string[]>(DDRAGON_VERSIONS);
    const latest = versions[0];
    if (!latest) return null;
    const doc = await getJson<Record<string, unknown> | unknown[]>(DDRAGON_CHALLENGES(latest));
    const entries = Array.isArray(doc) ? doc : Object.values(doc);
    const ids = new Set<number>();
    for (const e of entries) {
      const id = Number((e as { id?: unknown }).id);
      if (Number.isFinite(id)) ids.add(id);
    }
    return ids.size > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and flatten the challenge hierarchy. Returns null on any failure so the
 * caller can carry on with whatever it already has in the DB.
 */
export async function fetchChallengeMeta(): Promise<ChallengeMeta[] | null> {
  let manifest: { challenges?: Record<string, CDragonEntry> };
  try {
    manifest = await getJson<{ challenges?: Record<string, CDragonEntry> }>(CDRAGON_MANIFEST);
  } catch (err) {
    console.error('  CommunityDragon manifest fetch failed:', (err as Error).message);
    return null;
  }

  const challenges = manifest.challenges;
  if (!challenges || typeof challenges !== 'object') {
    console.error('  CommunityDragon manifest has no `challenges` object');
    return null;
  }

  const scoringIds = await fetchScoringIds();
  if (!scoringIds) {
    console.warn('  Data Dragon challenge list unavailable — treating all challenges as scoring');
  }

  const out: ChallengeMeta[] = [];
  for (const [key, entry] of Object.entries(challenges)) {
    const challengeId = Number(key);
    if (!Number.isFinite(challengeId)) continue;

    const tags = entry.tags ?? {};
    const parentRaw = tags.parent;
    const parentId = parentRaw !== undefined && Number.isFinite(Number(parentRaw))
      ? Number(parentRaw)
      : null;

    const rewards: Record<string, unknown[]> = {};
    for (const [tier, th] of Object.entries(entry.thresholds ?? {})) {
      if (th?.rewards?.length) rewards[tier] = th.rewards;
    }

    out.push({
      challengeId,
      parentId,
      isCapstone: tags.isCapstone === 'Y',
      isCategory: tags.isCategory === 'true',
      isScoring: scoringIds ? scoringIds.has(challengeId) : true,
      source: entry.source ?? null,
      queueIds: Array.isArray(entry.queueIds) ? entry.queueIds : [],
      rewards,
    });
  }
  return out;
}

/**
 * Shared fallback token. 83 (challenge, tier) pairs are dead upstream and 404 on
 * every mirror, so image consumers should fall back to this on error. It lives
 * outside the gitignored mirror directory because it is authored, not fetched.
 */
export const TOKEN_PLACEHOLDER = '/lol/challenge-token-placeholder.png';

/** The six category roots. Slugs are ours; the mirror normalises upstream names. */
export const CATEGORY_SLUGS: Record<number, string> = {
  0: 'crystal', 1: 'imagination', 2: 'expertise',
  3: 'veterancy', 4: 'teamwork', 5: 'collection',
};

/**
 * Category glyph. `svg` is the flat monochrome rail icon (currentColor-friendly
 * once its hardcoded fill is overridden); `png` is the 80x80 white fill used
 * beside the section heading, which recolors cleanly via mask-image.
 * Note CRYSTAL (id 0) has no category glyph — use `crystalPath` instead.
 */
export function categoryIconPath(id: number, ext: 'svg' | 'png' = 'svg'): string | null {
  const slug = CATEGORY_SLUGS[id];
  if (!slug || slug === 'crystal') return null;
  return `/lol/challenge-shared/categories/${slug}.${ext}`;
}

/** The overall CRYSTAL gem — the only category art with per-tier variants. */
export function crystalPath(level: string, mini = false): string {
  // `none` has no mini variant upstream; iron is its visual twin (the full-size
  // none/iron crystals are byte-identical), so it stands in.
  const tier = String(level || 'NONE').toLowerCase();
  if (mini) return `/lol/challenge-shared/crystal/mini-${tier === 'none' ? 'iron' : tier}.svg`;
  return `/lol/challenge-shared/crystal/${tier}.png`;
}

/** Generic tier token, for nodes with no per-challenge art (e.g. ids 0-5). */
export function tokenFallbackPath(level: string): string {
  return `/lol/challenge-shared/token-fallback/${String(level || 'NONE').toLowerCase()}.png`;
}

/**
 * Local path for a challenge's tier token, as written by
 * `scripts/mirror-challenge-icons.ts`. A pure string builder — existence is not
 * checked here; render with an onError fallback to TOKEN_PLACEHOLDER.
 */
export function tokenIconPath(challengeId: number | string, level: string): string {
  const tier = String(level || 'NONE').toLowerCase();
  return `/lol/challenge-tokens/${challengeId}/${tier}.png`;
}
