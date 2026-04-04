import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  getAccountByRiotId,
  getPlayerChallengeData,
  getMatchIds,
  getMatch,
} from '../src/lib/riot';

const pool = new Pool({
  user: 'server',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function loadConfig() {
  const config = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
  if (!config.riotApiKey || !config.riotGameName || !config.riotTagLine) {
    throw new Error('Missing Riot API config');
  }
  return config;
}

// Build a snapshot map from player challenge data: { challengeId: { value, level } }
function buildSnapshot(challenges: { challengeId: number; value: number; level: string }[]): Record<string, { value: number; level: string }> {
  const snap: Record<string, { value: number; level: string }> = {};
  for (const c of challenges) {
    snap[String(c.challengeId)] = { value: c.value, level: c.level };
  }
  return snap;
}

// Load challenge names from DB
async function loadChallengeNames(): Promise<Record<string, string>> {
  const { rows } = await pool.query('SELECT challenge_id, name FROM challenge_configs');
  const names: Record<string, string> = {};
  for (const r of rows) names[String(r.challenge_id)] = r.name;
  return names;
}

// Compute deltas between old and new snapshots
function computeDeltas(
  oldSnap: Record<string, { value: number; level: string }>,
  newSnap: Record<string, { value: number; level: string }>,
  names: Record<string, string>
) {
  const deltas: {
    challenge_id: string;
    name: string;
    old_value: number;
    new_value: number;
    old_level: string;
    new_level: string;
  }[] = [];

  for (const [id, newData] of Object.entries(newSnap)) {
    const oldData = oldSnap[id];
    if (!oldData) {
      // New challenge appeared
      if (newData.value > 0) {
        deltas.push({
          challenge_id: id,
          name: names[id] || `Challenge ${id}`,
          old_value: 0,
          new_value: newData.value,
          old_level: 'NONE',
          new_level: newData.level,
        });
      }
      continue;
    }
    if (newData.value !== oldData.value || newData.level !== oldData.level) {
      deltas.push({
        challenge_id: id,
        name: names[id] || `Challenge ${id}`,
        old_value: oldData.value,
        new_value: newData.value,
        old_level: oldData.level,
        new_level: newData.level,
      });
    }
  }

  return deltas;
}

async function poll() {
  const config = await loadConfig();
  const { riotApiKey, riotGameName, riotTagLine, riotRegion } = config;

  // Resolve PUUID
  const account = await getAccountByRiotId(riotApiKey, riotGameName, riotTagLine);
  const puuid = account.puuid;
  const names = await loadChallengeNames();

  console.log(`Polling challenges for ${riotGameName}#${riotTagLine}...`);

  // Get current snapshot from DB
  const snapRow = await pool.query('SELECT data FROM challenge_snapshot WHERE id = 1');
  const oldSnap: Record<string, { value: number; level: string }> = snapRow.rows[0]?.data || {};

  // Fetch current challenge progress
  const playerData = await getPlayerChallengeData(riotApiKey, riotRegion, puuid);
  const newSnap = buildSnapshot(playerData.challenges);

  // Check for new matches
  const matchIds = await getMatchIds(riotApiKey, puuid, 10);

  // Find matches we haven't tracked yet
  const existingMatches = await pool.query(
    'SELECT match_id FROM challenge_games WHERE match_id = ANY($1)',
    [matchIds]
  );
  const existingSet = new Set(existingMatches.rows.map((r: { match_id: string }) => r.match_id));
  const newMatchIds = matchIds.filter((id: string) => !existingSet.has(id));

  if (newMatchIds.length === 0 && Object.keys(oldSnap).length > 0) {
    console.log(`  No new matches detected. Skipping.`);
    return;
  }

  // Compute overall deltas
  const deltas = Object.keys(oldSnap).length > 0 ? computeDeltas(oldSnap, newSnap, names) : [];
  const tierUps = deltas.filter(d => d.old_level !== d.new_level).length;

  if (newMatchIds.length > 0) {
    console.log(`  Found ${newMatchIds.length} new match(es)`);

    // If we have deltas and multiple new matches, we attribute all deltas to the batch
    // Process each new match (oldest first)
    const sortedNewMatches = [...newMatchIds].reverse();

    for (let i = 0; i < sortedNewMatches.length; i++) {
      const matchId = sortedNewMatches[i];
      try {
        const match = await getMatch(riotApiKey, matchId);
        const participant = match.info.participants.find((p: { puuid: string }) => p.puuid === puuid);
        if (!participant) continue;

        // Attribute deltas to the last match in the batch (most recent)
        const isLast = i === sortedNewMatches.length - 1;
        const gameDeltas = isLast ? deltas : [];
        const gameTierUps = isLast ? tierUps : 0;

        await pool.query(
          `INSERT INTO challenge_games (match_id, champion, win, game_mode, kills, deaths, assists, game_duration, game_creation, deltas, tier_ups, points_gained)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (match_id) DO NOTHING`,
          [
            matchId,
            participant.championName,
            participant.win,
            match.info.gameMode,
            participant.kills,
            participant.deaths,
            participant.assists,
            match.info.gameDuration,
            match.info.gameCreation,
            JSON.stringify(gameDeltas),
            gameTierUps,
            gameDeltas.reduce((sum, d) => sum + (d.new_value - d.old_value), 0),
          ]
        );

        const result = participant.win ? 'W' : 'L';
        console.log(`  [${result}] ${participant.championName} (${participant.kills}/${participant.deaths}/${participant.assists}) - ${matchId}${isLast && deltas.length > 0 ? ` [${deltas.length} challenge updates, ${gameTierUps} tier-ups]` : ''}`);
      } catch (err) {
        console.error(`  Error processing match ${matchId}:`, err);
      }
    }
  } else if (deltas.length > 0) {
    console.log(`  Challenge progress changed but no new matches found (manual progress?)`);
  }

  // Update snapshot
  await pool.query(
    `INSERT INTO challenge_snapshot (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
    [JSON.stringify(newSnap)]
  );

  // Also update challenge_progress table
  for (const ch of playerData.challenges) {
    await pool.query(
      `INSERT INTO challenge_progress (challenge_id, level, value, percentile, achieved_time, position, players_in_level, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (challenge_id) DO UPDATE SET
         level = $2, value = $3, percentile = $4, achieved_time = $5, position = $6, players_in_level = $7, updated_at = now()`,
      [ch.challengeId, ch.level, ch.value, ch.percentile, ch.achievedTime || null, ch.position || null, ch.playersInLevel || null]
    );
  }

  console.log(`  Snapshot updated.`);
}

async function main() {
  console.log('Challenge poller started. Polling every 5 minutes.\n');

  // Initial poll
  try {
    await poll();
  } catch (err) {
    console.error('Poll error:', err);
  }

  // Schedule recurring polls
  setInterval(async () => {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] Polling...`);
      await poll();
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, POLL_INTERVAL);
}

main();
