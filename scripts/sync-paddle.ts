/**
 * Paddle Planner (RM 18) network build. `--park <slug>` picks the region
 * (see src/lib/paddle/parks.ts), `--refetch` bypasses the .cache/paddle disk
 * cache to re-pull Ontario open data. Safe to re-run: the park's network
 * rows are replaced atomically and hand-curated campsites are untouched.
 */
import pool from '../src/lib/db';
import { ingestPark } from '../src/lib/paddle/ingest';

async function main() {
  const args = process.argv.slice(2);
  const parkFlag = args.indexOf('--park');
  const slug = parkFlag >= 0 ? args[parkFlag + 1] : 'temagami';
  const refetch = args.includes('--refetch');

  try {
    const stats = await ingestPark(pool, slug, { refetch, log: (m) => console.log(m) });
    console.log(
      `built ${slug}: ${stats.segments} segments / ${stats.nodes} nodes — ` +
        `${stats.paddleKm} km paddling, ${stats.portageKm} km over ${stats.portages} portages, ` +
        `${stats.lakes} lakes, ${stats.accessPoints} access points ` +
        `(${stats.componentCount} components, ${Math.round(stats.largestComponentShare * 100)}% in largest)`,
    );
  } catch (err) {
    console.error('paddle sync failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
