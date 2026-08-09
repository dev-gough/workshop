/**
 * Cache Ontario's OIWMS aerial orthophoto tiles for a park's bbox so the
 * imagery layer is self-hosted like everything else on the table.
 *
 *   npm run import-imagery-tiles -- --park temagami [--max-zoom 15]
 *   npm run import-imagery-tiles -- --park temagami --corridor 500
 *
 * `--corridor <metres>` is the deep pass: z16–17 only within that buffer of
 * the park's network segments (read from Postgres) — full native sharpness
 * where the crew actually paddles and carries, without the ~400k-tile cost
 * of taking the whole bbox that deep. Off-corridor requests are synthesized
 * from the z15 pyramid at serve time, so run the bbox import first.
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
import { CORRIDOR_MAX_ZOOM, IMAGERY_MAX_ZOOM, imageryTileDir } from '../src/lib/paddle/imagerytiles';

const MIN_ZOOM = 4;
// Bbox-mode pad: imagery runs a little past the park window so zoomed-in
// views near the boundary don't end on a hard data edge (the client's
// source bounds extend further still; Quebec-side tiles are voids anyway).
const BBOX_PAD_DEG = 0.15;
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
// 8 workers drew occasional 429s from the province — default gentler.
const concurrency = Number(arg('--concurrency') ?? 4);
const corridorM = arg('--corridor') ? Number(arg('--corridor')) : null;

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

type Job = { z: number; x: number; y: number };

function bboxJobs(): Job[] {
  const [w, s, e, n] = [
    park!.bbox[0] - BBOX_PAD_DEG,
    park!.bbox[1] - BBOX_PAD_DEG,
    park!.bbox[2] + BBOX_PAD_DEG,
    park!.bbox[3] + BBOX_PAD_DEG,
  ];
  const jobs: Job[] = [];
  for (let z = MIN_ZOOM; z <= maxZoom; z++) {
    const x0 = tileX(w, z);
    const x1 = tileX(e, z);
    const y0 = tileY(n, z);
    const y1 = tileY(s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
  }
  return jobs;
}

/** z16–17 tiles within `corridorM` metres of any network segment. */
async function corridorJobs(): Promise<Job[]> {
  const { default: pool } = await import('../src/lib/db');
  const { rows } = await pool.query('SELECT coords FROM paddle_segments WHERE park = $1', [slug]);
  await pool.end();
  if (!rows.length) throw new Error(`no segments in Postgres for ${slug} — ingest first`);

  const keys = new Set<string>();
  const stamp = (lon: number, lat: number) => {
    const dLat = corridorM! / 111_320;
    const dLon = corridorM! / (111_320 * Math.cos((lat * Math.PI) / 180));
    for (let z = IMAGERY_MAX_ZOOM + 1; z <= CORRIDOR_MAX_ZOOM; z++) {
      const x0 = tileX(lon - dLon, z);
      const x1 = tileX(lon + dLon, z);
      const y0 = tileY(lat + dLat, z);
      const y1 = tileY(lat - dLat, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.add(`${z}/${x}/${y}`);
    }
  };
  for (const row of rows) {
    const coords: [number, number][] =
      typeof row.coords === 'string' ? JSON.parse(row.coords) : row.coords;
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = coords[i];
      stamp(lon, lat);
      if (i === 0) continue;
      // Long straight reaches (big-lake crossings) have sparse vertices —
      // sample between them so the stamps overlap.
      const [plon, plat] = coords[i - 1];
      const stepM = Math.max(50, corridorM! / 2);
      const distM = Math.hypot(
        (lon - plon) * 111_320 * Math.cos((lat * Math.PI) / 180),
        (lat - plat) * 110_540,
      );
      for (let k = 1; k * stepM < distM; k++) {
        const t = (k * stepM) / distM;
        stamp(plon + (lon - plon) * t, plat + (lat - plat) * t);
      }
    }
  }
  return [...keys].map((k) => {
    const [z, x, y] = k.split('/').map(Number);
    return { z, x, y };
  });
}

async function main() {
  const jobs = corridorM ? await corridorJobs() : bboxJobs();
  // Work top-down so wide zooms are usable while the deep levels stream in.
  jobs.sort((a, b) => b.z - a.z);
  const total = jobs.length;
  console.log(
    corridorM
      ? `${slug}: ${total} corridor tiles (z${IMAGERY_MAX_ZOOM + 1}–${CORRIDOR_MAX_ZOOM}, ±${corridorM} m of the network)`
      : `${slug}: ${total} tiles (z${MIN_ZOOM}–${maxZoom})`,
  );

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
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(
    `done — ${fetched} fetched, ${voids} void (outside Ontario), ${failed} failed, rest already cached.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
