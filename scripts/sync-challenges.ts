import { getConfig } from '../src/lib/config';
import { makePool } from '../src/lib/db';
import { syncChallenges } from '../src/lib/challenges-sync';

const pool = makePool('workshop');

async function main() {
  const riot = getConfig().riot;
  if (!riot) {
    console.error('riot section is not configured in config.json');
    process.exit(1);
  }

  console.log(`Syncing challenges for ${riot.gameName}#${riot.tagLine} on ${riot.region}...`);

  const { configCount, progressCount, thresholdUpdates, metaUpdates } = await syncChallenges(pool, riot);

  console.log(`\nDone! Synced ${configCount} configs, ${progressCount} progress entries, ${thresholdUpdates} dynamic thresholds.`);
  console.log(
    metaUpdates === null
      ? '  Hierarchy still fresh (or upstream unreachable) — left as-is.'
      : `  Hierarchy refreshed from CommunityDragon: ${metaUpdates} rows.`
  );
  await pool.end();
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
