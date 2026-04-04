import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  getAccountByRiotId,
  getChallengeConfigs,
  getPlayerChallengeData,
  getChallengePercentiles,
  getChallengeLeaderboardFloor,
} from '@/lib/riot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export async function POST() {
  try {
    // Check cooldown
    const syncRow = await pool.query(
      `SELECT last_synced_at FROM sync_metadata WHERE key = 'challenges'`
    );
    if (syncRow.rows.length > 0) {
      const lastSynced = new Date(syncRow.rows[0].last_synced_at).getTime();
      const elapsed = Date.now() - lastSynced;
      if (elapsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json({
          synced: false,
          reason: 'cooldown',
          remainingSeconds: remaining,
          lastSyncedAt: syncRow.rows[0].last_synced_at,
        });
      }
    }

    const config = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
    const { riotApiKey, riotGameName, riotTagLine, riotRegion } = config;

    if (!riotApiKey || !riotGameName || !riotTagLine) {
      return NextResponse.json({ error: 'Riot API not configured' }, { status: 500 });
    }

    const account = await getAccountByRiotId(riotApiKey, riotGameName, riotTagLine);

    const [configs, playerData, percentiles] = await Promise.all([
      getChallengeConfigs(riotApiKey, riotRegion),
      getPlayerChallengeData(riotApiKey, riotRegion, account.puuid),
      getChallengePercentiles(riotApiKey, riotRegion),
    ]);

    // Category mapping from challenge ID prefix
    const CATEGORY_MAP: Record<string, string> = {
      '1': 'IMAGINATION', '2': 'EXPERTISE', '3': 'VETERANCY',
      '4': 'TEAMWORK', '5': 'COLLECTION', '6': 'IMAGINATION',
    };
    function deriveCategory(id: number): string {
      if (id < 10) return 'OVERALL';
      const prefix = String(id).charAt(0);
      return CATEGORY_MAP[prefix] || 'OTHER';
    }

    // Upsert configs
    for (const cfg of configs) {
      const en = cfg.localizedNames?.en_US;
      const name = en?.name || `Challenge ${cfg.id}`;
      const description = en?.description || '';
      const shortDescription = en?.shortDescription || '';
      const thresholds = cfg.thresholds || {};
      const tags = cfg.tags ? Object.values(cfg.tags).flat() : [];
      const category = deriveCategory(cfg.id);

      await pool.query(
        `INSERT INTO challenge_configs (challenge_id, name, description, short_description, category, state, thresholds, tags, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (challenge_id) DO UPDATE SET
           name = $2, description = $3, short_description = $4, category = $5, state = $6, thresholds = $7, tags = $8, updated_at = now()`,
        [cfg.id, name, description, shortDescription, category, cfg.state, JSON.stringify(thresholds), JSON.stringify(tags)]
      );
    }

    // Upsert progress
    for (const ch of playerData.challenges) {
      await pool.query(
        `INSERT INTO challenge_progress (challenge_id, level, value, percentile, achieved_time, position, players_in_level, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (challenge_id) DO UPDATE SET
           level = $2, value = $3, percentile = $4, achieved_time = $5, position = $6, players_in_level = $7, updated_at = now()`,
        [ch.challengeId, ch.level, ch.value, ch.percentile, ch.achievedTime || null, ch.position || null, ch.playersInLevel || null]
      );
    }

    // Update dynamic GM/Challenger thresholds for MASTER+ challenges with leaderboards
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

    // Update sync metadata
    await pool.query(
      `INSERT INTO sync_metadata (key, last_synced_at, details)
       VALUES ('challenges', now(), $1)
       ON CONFLICT (key) DO UPDATE SET last_synced_at = now(), details = $1`,
      [JSON.stringify({
        puuid: account.puuid,
        totalPoints: playerData.totalPoints,
        categoryPoints: playerData.categoryPoints,
        configCount: configs.length,
        progressCount: playerData.challenges.length,
        thresholdUpdates,
      })]
    );

    return NextResponse.json({
      synced: true,
      configCount: configs.length,
      progressCount: playerData.challenges.length,
      thresholdUpdates,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
