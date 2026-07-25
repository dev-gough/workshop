import type { Pool } from 'pg';
import type { RiotConfig } from './config';
import {
  getAccountByRiotId,
  getChallengeConfigs,
  getPlayerChallengeData,
  getChallengePercentiles,
  getChallengeLeaderboardFloor,
  type ChallengeConfig,
  type PercentileMap,
  type PlayerChallengeData,
} from './riot';
import { fetchChallengeMeta } from './cdragon';

// Category mapping from challenge ID prefix
const CATEGORY_MAP: Record<string, string> = {
  '1': 'IMAGINATION', '2': 'EXPERTISE', '3': 'VETERANCY',
  '4': 'TEAMWORK', '5': 'COLLECTION', '6': 'IMAGINATION',
};

export function deriveCategory(id: number): string {
  if (id < 10) return 'OVERALL'; // parent category challenges (0-5)
  const prefix = String(id).charAt(0);
  return CATEGORY_MAP[prefix] || 'OTHER';
}

// Upsert challenge configs; returns the number of configs written.
// `percentiles` is the per-challenge 9-point rarity curve keyed by tier — the
// same endpoint that backs challenge_progress.percentile, kept whole this time.
export async function upsertChallengeConfigs(
  pool: Pool,
  configs: ChallengeConfig[],
  percentiles: PercentileMap = {}
): Promise<number> {
  let configCount = 0;
  for (const cfg of configs) {
    const en = cfg.localizedNames?.en_US;
    const name = en?.name || `Challenge ${cfg.id}`;
    const description = en?.description || '';
    const shortDescription = en?.shortDescription || '';

    // Thresholds come as { TIER: value } directly
    const thresholds = cfg.thresholds || {};

    // Extract tags
    const tags = cfg.tags ? Object.values(cfg.tags).flat() : [];
    const category = deriveCategory(cfg.id);

    await pool.query(
      `INSERT INTO challenge_configs (challenge_id, name, description, short_description, category, state,
                                      thresholds, tags, percentiles, leaderboard, end_timestamp, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (challenge_id) DO UPDATE SET
         name = $2, description = $3, short_description = $4, category = $5, state = $6, thresholds = $7,
         tags = $8, percentiles = $9, leaderboard = $10, end_timestamp = $11, updated_at = now()`,
      [
        cfg.id, name, description, shortDescription, category, cfg.state,
        JSON.stringify(thresholds), JSON.stringify(tags),
        JSON.stringify(percentiles[String(cfg.id)] ?? {}),
        cfg.leaderboard ?? null,
        cfg.endTimestamp ?? null,
      ]
    );
    configCount++;
  }
  return configCount;
}

// Upsert player challenge progress; returns the number of entries written.
export async function upsertChallengeProgress(
  pool: Pool,
  challenges: PlayerChallengeData['challenges']
): Promise<number> {
  let progressCount = 0;
  for (const ch of challenges) {
    await pool.query(
      `INSERT INTO challenge_progress (challenge_id, level, value, percentile, achieved_time, position, players_in_level, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (challenge_id) DO UPDATE SET
         level = $2, value = $3, percentile = $4, achieved_time = $5, position = $6, players_in_level = $7, updated_at = now()`,
      [ch.challengeId, ch.level, ch.value, ch.percentile, ch.achievedTime || null, ch.position || null, ch.playersInLevel || null]
    );
    progressCount++;
  }
  return progressCount;
}

// Update dynamic GM/Challenger thresholds for MASTER+ leaderboard challenges;
// returns the number of configs whose thresholds changed.
export async function updateLeaderboardThresholds(
  pool: Pool,
  configs: ChallengeConfig[],
  playerData: PlayerChallengeData,
  riotApiKey: string,
  riotRegion: string
): Promise<number> {
  const leaderboardConfigIds = new Set(configs.filter(c => c.leaderboard).map(c => c.id));
  const masterPlusChallenges = playerData.challenges.filter(
    ch => ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(ch.level) && leaderboardConfigIds.has(ch.challengeId)
  );

  let thresholdUpdates = 0;
  for (const ch of masterPlusChallenges) {
    const cfg = configs.find(c => c.id === ch.challengeId);
    if (!cfg) continue;
    const thresholds = { ...(cfg.thresholds || {}) };
    let updated = false;

    const gmFloor = await getChallengeLeaderboardFloor(riotApiKey, riotRegion, ch.challengeId, 'GRANDMASTER');
    if (gmFloor !== null && gmFloor !== thresholds.GRANDMASTER) {
      thresholds.GRANDMASTER = gmFloor;
      updated = true;
    }

    const chalFloor = await getChallengeLeaderboardFloor(riotApiKey, riotRegion, ch.challengeId, 'CHALLENGER');
    if (chalFloor !== null && chalFloor !== thresholds.CHALLENGER) {
      thresholds.CHALLENGER = chalFloor;
      updated = true;
    }

    if (updated) {
      await pool.query(
        'UPDATE challenge_configs SET thresholds = $1, updated_at = now() WHERE challenge_id = $2',
        [JSON.stringify(thresholds), ch.challengeId]
      );
      thresholdUpdates++;
    }
  }
  return thresholdUpdates;
}

// The CommunityDragon manifest is ~635KB and only changes on patch, so it is
// refetched at most this often rather than on every 5-minute poll.
const META_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Refresh the capstone/group hierarchy and the delisted-challenge flags from
 * CommunityDragon + Data Dragon. Returns the number of rows updated, or null if
 * the refresh was skipped (still fresh) or upstream was unreachable — in both
 * cases the existing columns are left exactly as they are.
 */
export async function syncChallengeMeta(pool: Pool, force = false): Promise<number | null> {
  if (!force) {
    const { rows } = await pool.query<{ fresh: boolean }>(
      `SELECT last_synced_at > now() - $1::interval AS fresh
         FROM sync_metadata WHERE key = 'challenges_meta'`,
      [`${Math.round(META_TTL_MS / 1000)} seconds`]
    );
    if (rows[0]?.fresh) return null;
  }

  const meta = await fetchChallengeMeta();
  if (!meta) return null;

  let updated = 0;
  for (const m of meta) {
    const { rowCount } = await pool.query(
      `UPDATE challenge_configs
          SET parent_id = $2, is_capstone = $3, is_category = $4, is_scoring = $5,
              source = $6, queue_ids = $7, rewards = $8
        WHERE challenge_id = $1`,
      [
        m.challengeId, m.parentId, m.isCapstone, m.isCategory, m.isScoring,
        m.source, JSON.stringify(m.queueIds), JSON.stringify(m.rewards),
      ]
    );
    updated += rowCount ?? 0;
  }

  await pool.query(
    `INSERT INTO sync_metadata (key, last_synced_at, details)
     VALUES ('challenges_meta', now(), $1)
     ON CONFLICT (key) DO UPDATE SET last_synced_at = now(), details = $1`,
    [JSON.stringify({ manifestEntries: meta.length, rowsUpdated: updated })]
  );
  return updated;
}

export interface SyncChallengesResult {
  puuid: string;
  configCount: number;
  progressCount: number;
  thresholdUpdates: number;
  metaUpdates: number | null;
}

// Full challenge sync: resolve PUUID, fetch configs/progress, upsert everything,
// refresh dynamic leaderboard thresholds, and record sync metadata.
export async function syncChallenges(pool: Pool, riot: RiotConfig): Promise<SyncChallengesResult> {
  const { apiKey: riotApiKey, gameName: riotGameName, tagLine: riotTagLine, region: riotRegion } = riot;

  const account = await getAccountByRiotId(riotApiKey, riotGameName, riotTagLine);

  const [configs, playerData, percentiles] = await Promise.all([
    getChallengeConfigs(riotApiKey, riotRegion),
    getPlayerChallengeData(riotApiKey, riotRegion, account.puuid),
    getChallengePercentiles(riotApiKey, riotRegion),
  ]);

  const configCount = await upsertChallengeConfigs(pool, configs, percentiles);
  const progressCount = await upsertChallengeProgress(pool, playerData.challenges);
  const thresholdUpdates = await updateLeaderboardThresholds(pool, configs, playerData, riotApiKey, riotRegion);
  const metaUpdates = await syncChallengeMeta(pool);

  await pool.query(
    `INSERT INTO sync_metadata (key, last_synced_at, details)
     VALUES ('challenges', now(), $1)
     ON CONFLICT (key) DO UPDATE SET last_synced_at = now(), details = $1`,
    [JSON.stringify({
      puuid: account.puuid,
      totalPoints: playerData.totalPoints,
      categoryPoints: playerData.categoryPoints,
      configCount,
      progressCount,
      thresholdUpdates,
    })]
  );

  return { puuid: account.puuid, configCount, progressCount, thresholdUpdates, metaUpdates };
}
