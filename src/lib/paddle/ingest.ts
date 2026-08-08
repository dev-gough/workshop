/**
 * Full ingest for one park: fetch Ontario open data (disk-cached — the OHN
 * pulls are ~80k features and 20 min of polite paging), classify the route
 * into paddle/portage segments, recover graph topology, and swap the park's
 * rows in Postgres atomically. Campsites are curated by hand in the room's
 * UI and live in their own table, so re-ingest never touches them.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { fetchLayer, LAYERS, type EsriFeature } from './arcgis';
import { alignPortagesToChart } from './chartalign';
import { classifyPaths } from './classify';
import { buildGraph } from './graph';
import { PARKS } from './parks';

const CACHE_ROOT = path.join(process.cwd(), '.cache/paddle');
// ~5 m generalization on water geometry; both sources are only 10 m accurate.
const WATER_OFFSET_DEG = 0.00005;

async function cached(
  park: string,
  name: string,
  refetch: boolean,
  fetcher: () => Promise<EsriFeature[]>,
): Promise<EsriFeature[]> {
  const file = path.join(CACHE_ROOT, park, `${name}.json`);
  if (!refetch) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
      /* miss */
    }
  }
  const features = await fetcher();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(features));
  return features;
}

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

async function batchInsert(
  pool: Queryable,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await pool.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}`,
      params,
    );
  }
}

export interface IngestResult {
  paddleKm: number;
  portageKm: number;
  portages: number;
  nodes: number;
  segments: number;
  lakes: number;
  accessPoints: number;
  componentCount: number;
  largestComponentShare: number;
}

export async function ingestPark(
  pool: Pool,
  slug: string,
  opts: { refetch?: boolean; log?: (msg: string) => void } = {},
): Promise<IngestResult> {
  const park = PARKS[slug];
  if (!park) throw new Error(`unknown park '${slug}' — add it to src/lib/paddle/parks.ts`);
  const log = opts.log ?? (() => {});
  const refetch = opts.refetch ?? false;

  log(`fetching OTN route lines for ${park.name}...`);
  const route = await cached(slug, 'route', refetch, () =>
    fetchLayer({
      layerUrl: LAYERS.otnSegment,
      where: park.otnTrailNames.map((n) => `TRAIL_NAME='${n.replace(/'/g, "''")}'`).join(' OR '),
      outFields: 'OGF_ID,TRAIL_NAME,TRAIL_LENGTH_KM',
      log,
    }),
  );
  const paths = route.flatMap((f) => f.geometry?.paths ?? []);
  if (paths.length === 0) throw new Error(`no OTN geometry found for ${park.otnTrailNames.join(', ')}`);

  log('fetching OHN waterbodies...');
  const waterbodies = await cached(slug, 'waterbodies', refetch, () =>
    fetchLayer({
      layerUrl: LAYERS.ohnWaterbody,
      bbox: park.bbox,
      outFields: 'OGF_ID,WATERBODY_TYPE,OFFICIAL_NAME_LABEL,SYSTEM_CALCULATED_AREA',
      maxAllowableOffset: WATER_OFFSET_DEG,
      log,
    }),
  );

  log('fetching OHN watercourses...');
  const watercourses = await cached(slug, 'watercourses', refetch, () =>
    fetchLayer({
      layerUrl: LAYERS.ohnWatercourse,
      bbox: park.bbox,
      outFields: 'OGF_ID,WATERCOURSE_TYPE,PERMANENCY',
      maxAllowableOffset: WATER_OFFSET_DEG,
      log,
    }),
  );
  const streams = watercourses.filter((f) => f.attributes.WATERCOURSE_TYPE === 'Stream');

  log('fetching OTN access points...');
  const access = await cached(slug, 'access', refetch, () =>
    fetchLayer({
      layerUrl: LAYERS.otnAccessPoint,
      bbox: park.bbox,
      outFields: 'OGF_ID', // the layer carries no name field — points only
      log,
    }),
  );

  log(`classifying ${paths.length} route paths...`);
  const { segments: classified, touchedWaterbodies } = classifyPaths(paths, waterbodies, streams, log);

  const midLat = (park.bbox[1] + park.bbox[3]) / 2;
  log('building graph topology...');
  const graph = buildGraph(classified, midLat);

  // With a purchased chart on disk, its GPS-derived portage lines replace
  // OTN's frequently schematic ones (and correct the lengths with them).
  const align = await alignPortagesToChart(graph.segments, slug, log);
  if (align) {
    log(
      `chart alignment: ${align.aligned} portages traced from the chart — ` +
        `${align.noSnap} no-snap, ${align.noPath} no-path, ` +
        `${align.rejected} failed sanity, ${align.offChart} off-chart`,
    );
  }

  const paddleKm = graph.segments.filter((s) => s.kind === 'paddle').reduce((t, s) => t + s.lengthM, 0) / 1000;
  const portageSegs = graph.segments.filter((s) => s.kind === 'portage');
  const portageKm = portageSegs.reduce((t, s) => t + s.lengthM, 0) / 1000;

  const result: IngestResult = {
    paddleKm: Math.round(paddleKm * 10) / 10,
    portageKm: Math.round(portageKm * 10) / 10,
    portages: portageSegs.length,
    nodes: graph.nodes.length,
    segments: graph.segments.length,
    lakes: waterbodies.length,
    accessPoints: access.length,
    componentCount: graph.componentCount,
    largestComponentShare: Math.round(graph.largestComponentShare * 1000) / 1000,
  };

  log('writing to Postgres...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO paddle_parks (slug, name, bbox, built_at, stats)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (slug) DO UPDATE SET name = $2, bbox = $3, built_at = now(), stats = $4`,
      [slug, park.name, JSON.stringify(park.bbox), JSON.stringify(result)],
    );
    for (const table of ['paddle_nodes', 'paddle_segments', 'paddle_lakes', 'paddle_access_points']) {
      await client.query(`DELETE FROM ${table} WHERE park = $1`, [slug]);
    }

    await batchInsert(client, 'paddle_nodes', ['park', 'id', 'lon', 'lat'],
      graph.nodes.map((n) => [slug, n.id, n.lon, n.lat]));

    await batchInsert(client, 'paddle_segments',
      ['park', 'id', 'kind', 'node_a', 'node_b', 'length_m', 'coords'],
      graph.segments.map((s) => [slug, s.id, s.kind, s.a, s.b, s.lengthM, JSON.stringify(s.coords)]));

    await batchInsert(client, 'paddle_lakes',
      ['park', 'ogf_id', 'name', 'area_m2', 'on_network', 'rings'],
      waterbodies.map((f, i) => [
        slug,
        f.attributes.OGF_ID,
        f.attributes.OFFICIAL_NAME_LABEL ?? null,
        f.attributes.SYSTEM_CALCULATED_AREA ?? 0,
        touchedWaterbodies.has(i),
        JSON.stringify(f.geometry?.rings ?? []),
      ]));

    await batchInsert(client, 'paddle_access_points', ['park', 'ogf_id', 'name', 'lon', 'lat'],
      access
        .filter((f) => f.geometry?.x !== undefined)
        .map((f) => [slug, f.attributes.OGF_ID, null, f.geometry!.x, f.geometry!.y]));

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return result;
}
