import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { scanAllAlbums } from '../src/lib/musicScanner';

const pool = new Pool({
  user: 'server',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
  const musicDir = config.musicDirectory;

  console.log(`Scanning ${musicDir}...`);
  const count = await scanAllAlbums(pool, musicDir);
  console.log(`\nDone! Scanned ${count} albums.`);
  await pool.end();
}

main().catch(err => {
  console.error('Scan failed:', err);
  process.exit(1);
});
