/**
 * Cache Ontario's OIWMS aerial orthophoto tiles for a park's bbox so the
 * imagery layer is self-hosted like everything else on the table.
 *
 *   npm run import-imagery-tiles -- --park temagami [--max-zoom 15]
 *
 * Source: Ontario Imagery Web Map Service (GEOspatial Ontario), an open
 * WMTS whose GoogleMapsCompatible matrix is the standard web-mercator XYZ
 * pyramid — note the row/col (y-before-x) order in the URL. Zooms
 * 4..IMAGERY_MAX_ZOOM clipped to the park bbox land in
 * `.cache/paddle/<slug>/imagery/{z}/{x}/{y}.jpg` (`.png` where the service
 * needs alpha for nodata). Idempotent — existing tiles are skipped.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PARKS } from '../src/lib/paddle/parks';
import { IMAGERY_MAX_ZOOM, imageryTileDir } from '../src/lib/paddle/imagerytiles';

const MIN_ZOOM = 4;
const CONCURRENCY = 8;
const SOURCE =
  'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/WMTS/tile/1.0.0/LIO_Imagery_Ontario_Imagery_Web_Map_Service/default/GoogleMapsCompatible';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = arg('--park');
const park = slug ? PARKS[slug] : undefined;
if (!slug || !park) {
  console.error('usage: npm run import-imagery-tiles -- --park <slug> [--max-zoom N]');
  console.error(`parks: ${Object.keys(PARKS).join(', ')}`);
  process.exit(1);
}
const maxZoom = Number(arg('--max-zoom') ?? IMAGERY_MAX_ZOOM);

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

async function main() {
  const [w, s, e, n] = park!.bbox;
  const jobs: { z: number; x: number; y: number }[] = [];
  for (let z = MIN_ZOOM; z <= maxZoom; z++) {
    const x0 = tileX(w, z);
    const x1 = tileX(e, z);
    const y0 = tileY(n, z);
    const y1 = tileY(s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
  }
  // Work top-down so wide zooms are usable while the deep levels stream in.
  jobs.sort((a, b) => b.z - a.z);
  const total = jobs.length;
  console.log(`${slug}: ${total} tiles (z${MIN_ZOOM}–${maxZoom})`);

  const dir = imageryTileDir(slug!);
  let done = 0;
  let fetched = 0;
  let failed = 0;
  let voids = 0;
  const worker = async () => {
    for (;;) {
      const job = jobs.pop();
      if (!job) return;
      const { z, x, y } = job;
      const stem = path.join(dir, String(z), String(x), String(y));
      done++;
      try {
        await fs.access(`${stem}.jpg`);
        continue; // already cached
      } catch {
        /* fetch it */
      }
      try {
        await fs.access(`${stem}.png`);
        continue;
      } catch {
        /* fetch it */
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`${SOURCE}/${z}/${y}/${x}`);
          const type = res.headers.get('content-type') ?? '';
          if (res.ok && type.startsWith('image/')) {
            const buf = Buffer.from(await res.arrayBuffer());
            await fs.mkdir(path.dirname(stem), { recursive: true });
            await fs.writeFile(type.includes('png') ? `${stem}.png` : `${stem}.jpg`, buf);
            fetched++;
            break;
          }
          if (res.status === 400) {
            // "Invalid URL": the cache is clipped to Ontario's boundary, so
            // bbox corners that poke into Quebec / Lake Timiskaming have no
            // tile at all. A permanent void, not a failure.
            voids++;
            break;
          }
          throw new Error(`HTTP ${res.status} ${type}`);
        } catch (err) {
          if (attempt >= 4) {
            failed++;
            console.error(`  tile ${z}/${x}/${y} failed: ${err}`);
            break;
          }
          // 429 = the province asking us to slow down — give it real room.
          const throttled = String(err).includes('HTTP 429');
          await new Promise((r) => setTimeout(r, (throttled ? 3000 : 500) * (attempt + 1)));
        }
      }
      if (done % 500 === 0) console.log(`  ${done}/${total} (${fetched} fetched)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `done — ${fetched} fetched, ${voids} void (outside Ontario), ${failed} failed, rest already cached.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
