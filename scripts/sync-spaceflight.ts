/**
 * SpaceX launch sync for RM 17 (Mission Control). Runs every 6h via a systemd
 * timer; `--full` walks the entire launch history instead of just the latest
 * page — used for the initial backfill and after editing the mass-estimation
 * rules in src/lib/spaceflight/estimate.ts (re-estimating is how corrections
 * reach old launches).
 */
import pool from '../src/lib/db';
import { reEstimate, syncSpaceflight } from '../src/lib/spaceflight/sync';

async function main() {
  const full = process.argv.includes('--full');
  try {
    if (process.argv.includes('--re-estimate')) {
      const n = await reEstimate(pool);
      console.log(`re-estimated masses for ${n} stored launches (no API calls)`);
      return;
    }
    const { past, upcoming, requests } = await syncSpaceflight(pool, { full });
    console.log(
      `synced ${past} past + ${upcoming} upcoming launches` +
        ` (${requests} Launch Library requests${full ? ', full backfill' : ''})`
    );
  } catch (err) {
    console.error('spaceflight sync failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
