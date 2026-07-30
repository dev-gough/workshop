/**
 * Weekly GCAT mirror for RM 03's world-history section (planet4589.org,
 * CC-BY J. McDowell). Two bulk downloads, truncate-and-reload, then adopts
 * GCAT payload masses into the SpaceX table where launches match.
 */
import pool from '../src/lib/db';
import { syncGcat } from '../src/lib/spaceflight/gcat';

async function main() {
  try {
    const { ingested, spacexAdopted } = await syncGcat(pool);
    console.log(`gcat: mirrored ${ingested} orbital/deep-space launches, adopted masses for ${spacexAdopted} SpaceX flights`);
  } catch (err) {
    console.error('gcat sync failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
