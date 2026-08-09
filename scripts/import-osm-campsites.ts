/**
 * Import campsites from OpenStreetMap (ODbL) — the only open campsite
 * source for these parks (Ontario publishes no campsite layer; verified
 * against all ten LIO open services + GeoHub, 2026-08). Algonquin's
 * interior is essentially fully mapped by the paddling community (~2.4k
 * sites); Temagami is partial (~90) and grows via the room's editable
 * layer on top.
 *
 *   npm run import-osm-campsites -- --park temagami [--refetch]
 *
 * Overpass pulls are cached in .cache/paddle/<slug>/osm-campsites.json.
 * Relevance: within NEAR_NET_M of the route network OR within NEAR_SHORE_M
 * of an on-network lake's shoreline — the route polyline runs down the
 * middle of big lakes, so shoreline sites sit far from it (car campgrounds
 * along highways still drop; backcountry tags are too sparse to filter
 * on). Upserts key on (park, source_ref) — re-imports refresh
 * name/position, never status/notes, so curation survives.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pool from '../src/lib/db';
import { PARKS } from '../src/lib/paddle/parks';
import { haversineM } from '../src/lib/paddle/classify';

const NEAR_NET_M = 300;
const NEAR_SHORE_M = 150; // campsites hug the waterline; generous for GPS slop
const GRID_DEG = 0.005; // ~400-550 m cells: one-ring lookup covers both radii
const OVERPASS = 'https://overpass-api.de/api/interpreter';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const slug = arg('--park');
const park = slug ? PARKS[slug] : undefined;
if (!slug || !park) {
  console.error('usage: npm run import-osm-campsites -- --park <slug> [--refetch]');
  process.exit(1);
}
const refetch = process.argv.includes('--refetch');

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchElements(): Promise<OsmElement[]> {
  const file = path.join(process.cwd(), '.cache', 'paddle', slug!, 'osm-campsites.json');
  if (!refetch) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')).elements;
    } catch {
      /* miss */
    }
  }
  const [w, s, e, n] = park!.bbox;
  const q = `[out:json][timeout:120];(node["tourism"="camp_site"](${s},${w},${n},${e});way["tourism"="camp_site"](${s},${w},${n},${e}););out center tags;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
  });
  if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
  const body = await res.text();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return JSON.parse(body).elements;
}

type Grid = Map<string, [number, number][]>;

function gridPut(grid: Grid, p: [number, number]): void {
  const key = `${Math.floor(p[0] / GRID_DEG)}/${Math.floor(p[1] / GRID_DEG)}`;
  const cell = grid.get(key);
  if (cell) cell.push(p);
  else grid.set(key, [p]);
}

/** Sample a polyline every ~100 m into the grid (vertices included). */
function gridLine(grid: Grid, coords: [number, number][]): void {
  for (let i = 0; i < coords.length; i++) {
    gridPut(grid, coords[i]);
    if (i === 0) continue;
    const d = haversineM(coords[i - 1], coords[i]);
    for (let k = 1; k * 100 < d; k++) {
      const t = (k * 100) / d;
      gridPut(grid, [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ]);
    }
  }
}

/** Grid of the route network + the shorelines of every on-network lake. */
async function relevanceGrids(): Promise<{ net: Grid; shore: Grid }> {
  const net: Grid = new Map();
  const { rows: segs } = (await pool.query(
    `SELECT coords FROM paddle_segments WHERE park = $1`,
    [slug],
  )) as { rows: { coords: [number, number][] }[] };
  for (const { coords } of segs) gridLine(net, coords);

  const shore: Grid = new Map();
  const { rows: lakes } = (await pool.query(
    `SELECT rings FROM paddle_lakes WHERE park = $1 AND on_network`,
    [slug],
  )) as { rows: { rings: [number, number][][] }[] };
  for (const { rings } of lakes) for (const ring of rings) gridLine(shore, ring);
  return { net, shore };
}

function nearGrid(grid: Grid, p: [number, number], maxM: number): boolean {
  const cx = Math.floor(p[0] / GRID_DEG);
  const cy = Math.floor(p[1] / GRID_DEG);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cell = grid.get(`${cx + dx}/${cy + dy}`);
      if (cell?.some((q) => haversineM(p, q) <= maxM)) return true;
    }
  }
  return false;
}

async function main() {
  const elements = await fetchElements();
  const { net, shore } = await relevanceGrids();

  let kept = 0;
  let inserted = 0;
  let updated = 0;
  let far = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const p: [number, number] = [lon, lat];
    if (!nearGrid(net, p, NEAR_NET_M) && !nearGrid(shore, p, NEAR_SHORE_M)) {
      far++;
      continue;
    }
    kept++;
    const tags = el.tags ?? {};
    // Useful context on first import only — notes are curated afterwards.
    const notes =
      ['capacity', 'backcountry', 'drinking_water', 'fee', 'description']
        .filter((k) => tags[k])
        .map((k) => `${k}: ${tags[k]}`)
        .join(' · ') || null;
    const res = await pool.query(
      `INSERT INTO paddle_campsites (park, name, lon, lat, notes, source, source_ref, status)
       VALUES ($1, $2, $3, $4, $5, 'osm', $6, 'unverified')
       ON CONFLICT (park, source_ref) WHERE source_ref IS NOT NULL
       DO UPDATE SET name = COALESCE(EXCLUDED.name, paddle_campsites.name),
                     lon = EXCLUDED.lon, lat = EXCLUDED.lat, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [slug, tags.name ?? null, lon, lat, notes, `${el.type}/${el.id}`],
    );
    if ((res.rows[0] as { inserted: boolean }).inserted) inserted++;
    else updated++;
  }
  console.log(
    `${slug}: ${elements.length} OSM camp_sites, ${far} dropped (far from network AND on-network shores), ` +
      `${kept} kept — ${inserted} new, ${updated} refreshed.`,
  );
  await pool.end();
}

main();
