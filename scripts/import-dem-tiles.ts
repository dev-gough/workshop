/**
 * Cache elevation tiles for a park's bbox so the room's terrain is
 * self-hosted like everything else on the table.
 *
 *   npm run import-dem-tiles -- --park algonquin
 *
 * Source: the AWS Open Data terrain tileset (Mapzen "terrarium" PNGs,
 * s3://elevation-tiles-prod — public, no key; Ontario coverage derives from
 * NRCan's CDEM). Zooms 4..DEM_MAX_ZOOM clipped to the park bbox land in
 * `.cache/paddle/<slug>/dem/{z}/{x}/{y}.png`. Idempotent — existing tiles
 * are skipped, so re-runs only fill gaps.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PARKS } from '../src/lib/paddle/parks';
import { DEM_MAX_ZOOM, DEM_PAD_DEG, demTileDir } from '../src/lib/paddle/demtiles';

const MIN_ZOOM = 4;
const CONCURRENCY = 8;
const SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = arg('--park');
const park = slug ? PARKS[slug] : undefined;
if (!slug || !park) {
  console.error('usage: npm run import-dem-tiles -- --park <slug>');
  console.error(`parks: ${Object.keys(PARKS).join(', ')}`);
  process.exit(1);
}

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

async function main() {
  const [w, s, e, n] = [
    park!.bbox[0] - DEM_PAD_DEG,
    park!.bbox[1] - DEM_PAD_DEG,
    park!.bbox[2] + DEM_PAD_DEG,
    park!.bbox[3] + DEM_PAD_DEG,
  ];
  const jobs: { z: number; x: number; y: number }[] = [];
  for (let z = MIN_ZOOM; z <= DEM_MAX_ZOOM; z++) {
    const x0 = tileX(w, z);
    const x1 = tileX(e, z);
    const y0 = tileY(n, z);
    const y1 = tileY(s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
  }
  console.log(`${slug}: ${jobs.length} tiles (z${MIN_ZOOM}–${DEM_MAX_ZOOM})`);

  const dir = demTileDir(slug!);
  let done = 0;
  let fetched = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const job = jobs.pop();
      if (!job) return;
      const { z, x, y } = job;
      const file = path.join(dir, String(z), String(x), `${y}.png`);
      done++;
      try {
        await fs.access(file);
        continue; // already cached
      } catch {
        /* fetch it */
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`${SOURCE}/${z}/${x}/${y}.png`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, buf);
          fetched++;
          break;
        } catch (err) {
          if (attempt >= 2) {
            failed++;
            console.error(`  tile ${z}/${x}/${y} failed: ${err}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (done % 200 === 0) console.log(`  ${done}/${jobs.length + done} (${fetched} fetched)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done — ${fetched} fetched, ${failed} failed, rest already cached.`);
  if (failed > 0) process.exitCode = 1;
}

main();
