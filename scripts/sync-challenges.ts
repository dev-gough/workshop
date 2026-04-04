import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  getAccountByRiotId,
  getChallengeConfigs,
  getPlayerChallengeData,
  getChallengePercentiles,
  getChallengeLeaderboardFloor,
} from '../src/lib/riot';

const pool = new Pool({
  user: 'server',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

async function syncChallenges() {
  const config = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
  const { riotApiKey, riotGameName, riotTagLine, riotRegion } = config;

  if (!riotApiKey || !riotGameName || !riotTagLine) {
    console.error('Missing Riot API config. Set riotApiKey, riotGameName, and riotTagLine in config.json');
    process.exit(1);
  }

  console.log(`Syncing challenges for ${riotGameName}#${riotTagLine} on ${riotRegion}...`);

  // Step 1: Resolve PUUID
  const account = await getAccountByRiotId(riotApiKey, riotGameName, riotTagLine);
  console.log(`  Resolved PUUID: ${account.puuid.substring(0, 12)}...`);

  // Step 2: Fetch all data in parallel
  const [configs, playerData, percentiles] = await Promise.all([
    getChallengeConfigs(riotApiKey, riotRegion),
    getPlayerChallengeData(riotApiKey, riotRegion, account.puuid),
    getChallengePercentiles(riotApiKey, riotRegion),
  ]);

  console.log(`  Fetched ${configs.length} challenge configs`);
  console.log(`  Fetched ${playerData.challenges.length} player challenge entries`);
  console.log(`  Total points: ${playerData.totalPoints.current}/${playerData.totalPoints.max}`);

  // Category mapping from challenge ID prefix
  const CATEGORY_MAP: Record<string, string> = {
    '1': 'IMAGINATION', '2': 'EXPERTISE', '3': 'VETERANCY',
    '4': 'TEAMWORK', '5': 'COLLECTION', '6': 'IMAGINATION',
  };
  function deriveCategory(id: number): string {
    if (id < 10) return 'OVERALL'; // parent category challenges (0-5)
    const prefix = String(id).charAt(0);
    return CATEGORY_MAP[prefix] || 'OTHER';
  }

  // Step 3: Upsert challenge configs
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
      `INSERT INTO challenge_configs (challenge_id, name, description, short_description, category, state, thresholds, tags, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (challenge_id) DO UPDATE SET
         name = $2, description = $3, short_description = $4, category = $5, state = $6, thresholds = $7, tags = $8, updated_at = now()`,
      [cfg.id, name, description, shortDescription, category, cfg.state, JSON.stringify(thresholds), JSON.stringify(tags)]
    );
    configCount++;
  }
  console.log(`  Upserted ${configCount} configs`);

  // Step 4: Upsert player progress
  let progressCount = 0;
  for (const ch of playerData.challenges) {
    // Get percentile from the percentiles endpoint (more granular)
    const challengePercentiles = percentiles[String(ch.challengeId)];
    const percentile = ch.percentile;

    await pool.query(
      `INSERT INTO challenge_progress (challenge_id, level, value, percentile, achieved_time, position, players_in_level, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (challenge_id) DO UPDATE SET
         level = $2, value = $3, percentile = $4, achieved_time = $5, position = $6, players_in_level = $7, updated_at = now()`,
      [ch.challengeId, ch.level, ch.value, percentile, ch.achievedTime || null, ch.position || null, ch.playersInLevel || null]
    );
    progressCount++;
  }
  console.log(`  Upserted ${progressCount} progress entries`);

  // Step 5: Update dynamic GM/Challenger thresholds for MASTER+ leaderboard challenges
  const leaderboardConfigIds = new Set(configs.filter((c: { id: number; leaderboard?: boolean }) => c.leaderboard).map((c: { id: number }) => c.id));
  const masterPlusChallenges = playerData.challenges.filter(
    ch => ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(ch.level) && leaderboardConfigIds.has(ch.challengeId)
  );

  console.log(`  Updating dynamic thresholds for ${masterPlusChallenges.length} MASTER+ leaderboard challenges...`);
  let thresholdUpdates = 0;
  for (const ch of masterPlusChallenges) {
    const cfg = configs.find((c: { id: number }) => c.id === ch.challengeId);
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
  console.log(`  Updated ${thresholdUpdates} dynamic thresholds`);

  // Step 6: Update sync metadata
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

  console.log(`\nDone! Synced ${configCount} configs, ${progressCount} progress entries, ${thresholdUpdates} dynamic thresholds.`);
  await pool.end();
}

syncChallenges().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
