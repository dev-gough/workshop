import { getConfig } from '../src/lib/config';
import { makePool } from '../src/lib/db';
import { scanAllAlbums } from '../src/lib/musicScanner';

const pool = makePool('workshop');

async function main() {
  const musicDir = getConfig().paths.musicDirectory;
  if (!musicDir) {
    console.error('paths.musicDirectory is not configured in config.json');
    process.exit(1);
  }

  console.log(`Scanning ${musicDir}...`);
  const count = await scanAllAlbums(pool, musicDir);
  console.log(`\nDone! Scanned ${count} albums.`);
  await pool.end();
}

main().catch(err => {
  console.error('Scan failed:', err);
  process.exit(1);
});
