// Launch Library 2 → Postgres sync for RM 17 (Mission Control).
//
// LL2's free tier allows 15 requests/hour, so this is strictly cache-through:
// the browser only ever reads our tables. A full backfill of ~710 SpaceX
// launches is 8 paginated calls; the routine incremental sync is 2 (recent
// previous + upcoming) and runs from a systemd timer every 6 hours, far under
// the limit even with the odd manual refresh on top.

import type { Pool } from 'pg';
import { estimateMass, groupVehicle } from './estimate';

const BASE = 'https://ll.thespacedevs.com/2.3.0';
const PAGE_SIZE = 100;

interface LL2Launch {
  id: string;
  name: string;
  net: string;
  last_updated: string;
  status: { abbrev: string };
  rocket: { configuration: { name: string; full_name: string | null } };
  mission: {
    name: string;
    description: string | null;
    orbit: { name: string; abbrev: string } | null;
  } | null;
  pad: { name: string; location: { name: string } | null };
  image: { image_url: string } | null;
}

interface LL2Page {
  count: number;
  next: string | null;
  results: LL2Launch[];
}

async function fetchPage(url: string): Promise<LL2Page> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Launch Library ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as LL2Page;
}

// Starhopper and the SN-series hops are launches in LL2's book but not in
// ours: they'd inflate Starship's flight count (and wreck t/flight) with
// water-tower-altitude tests. Integrated flights (V1/V2/V3…) stay.
function isPrototype(launch: LL2Launch): boolean {
  return /Prototype|Starhopper/i.test(
    launch.rocket.configuration.full_name ?? launch.rocket.configuration.name
  );
}

async function upsert(pool: Pool, launch: LL2Launch, isUpcoming: boolean): Promise<void> {
  const configName = launch.rocket.configuration.full_name ?? launch.rocket.configuration.name;
  const vehicle = groupVehicle(launch.rocket.configuration.name);
  const mission = launch.mission;
  const net = new Date(launch.net);
  const mass = estimateMass({
    missionName: mission?.name ?? launch.name,
    description: mission?.description ?? '',
    vehicle,
    net,
    orbitAbbrev: mission?.orbit?.abbrev ?? null,
  });

  await pool.query(
    `INSERT INTO spaceflight_launches
       (ll2_id, name, mission_name, vehicle, config_name, net, status, is_upcoming,
        orbit_abbrev, orbit_name, pad_name, pad_location, description, image_url,
        mass_kg, mass_source, mass_note, last_updated, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     ON CONFLICT (ll2_id) DO UPDATE SET
       name = EXCLUDED.name, mission_name = EXCLUDED.mission_name,
       vehicle = EXCLUDED.vehicle, config_name = EXCLUDED.config_name,
       net = EXCLUDED.net, status = EXCLUDED.status, is_upcoming = EXCLUDED.is_upcoming,
       orbit_abbrev = EXCLUDED.orbit_abbrev, orbit_name = EXCLUDED.orbit_name,
       pad_name = EXCLUDED.pad_name, pad_location = EXCLUDED.pad_location,
       description = EXCLUDED.description, image_url = EXCLUDED.image_url,
       mass_kg = EXCLUDED.mass_kg, mass_source = EXCLUDED.mass_source,
       mass_note = EXCLUDED.mass_note, last_updated = EXCLUDED.last_updated,
       synced_at = now()`,
    [
      launch.id, launch.name, mission?.name ?? null, vehicle, configName,
      net.toISOString(), launch.status.abbrev, isUpcoming,
      mission?.orbit?.abbrev ?? null, mission?.orbit?.name ?? null,
      launch.pad.name, launch.pad.location?.name ?? null,
      mission?.description ?? null, launch.image?.image_url ?? null,
      mass.kg, mass.source, mass.note, launch.last_updated,
    ]
  );
}

async function setMeta(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO spaceflight_meta (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

export interface SyncResult {
  past: number;
  upcoming: number;
  requests: number;
}

/**
 * Sync SpaceX launches. `full` walks the entire history (backfill / re-run
 * after changing estimation rules); otherwise only the most recent page of
 * past launches is refreshed — plenty at SpaceX's cadence for a 6-hour timer.
 */
export async function syncSpaceflight(pool: Pool, opts: { full?: boolean } = {}): Promise<SyncResult> {
  let requests = 0;
  let past = 0;

  let url: string | null = opts.full
    ? `${BASE}/launches/previous/?lsp__name=SpaceX&mode=normal&ordering=net&limit=${PAGE_SIZE}`
    : `${BASE}/launches/previous/?lsp__name=SpaceX&mode=normal&ordering=-net&limit=30`;
  while (url) {
    const page: LL2Page = await fetchPage(url);
    requests += 1;
    for (const launch of page.results) {
      if (isPrototype(launch)) continue;
      await upsert(pool, launch, false);
      past += 1;
    }
    url = opts.full ? page.next : null;
  }

  const upcomingPage = await fetchPage(
    `${BASE}/launches/upcoming/?lsp__name=SpaceX&mode=normal&ordering=net&limit=10`
  );
  requests += 1;
  for (const launch of upcomingPage.results) {
    await upsert(pool, launch, true);
  }
  // A launch that just flew is upserted above with is_upcoming = false; this
  // sweeps out upcoming rows that slipped off the 10-launch window entirely.
  const ids = upcomingPage.results.map((l) => l.id);
  await pool.query(
    `DELETE FROM spaceflight_launches WHERE is_upcoming AND NOT (ll2_id = ANY($1))`,
    [ids]
  );

  await setMeta(pool, 'last_sync', new Date().toISOString());
  if (opts.full) await setMeta(pool, 'last_full_sync', new Date().toISOString());

  return { past, upcoming: upcomingPage.results.length, requests };
}

/**
 * Re-run the mass rules over every stored launch without touching the API —
 * the cheap way to apply estimate.ts edits to history (Launch Library's free
 * tier is 15 requests/hour, so a full refetch is not a casual operation).
 * Also sweeps out any rows an older sync ingested that current rules exclude.
 */
export async function reEstimate(pool: Pool): Promise<number> {
  await pool.query(
    `DELETE FROM spaceflight_launches WHERE config_name ~* 'Prototype|Starhopper'`
  );
  const { rows } = await pool.query(
    `SELECT ll2_id, mission_name, name, description, vehicle, net, orbit_abbrev
       FROM spaceflight_launches`
  );
  for (const row of rows) {
    const mass = estimateMass({
      missionName: row.mission_name ?? row.name,
      description: row.description ?? '',
      vehicle: row.vehicle,
      net: new Date(row.net),
      orbitAbbrev: row.orbit_abbrev,
    });
    await pool.query(
      `UPDATE spaceflight_launches
          SET mass_kg = $2, mass_source = $3, mass_note = $4
        WHERE ll2_id = $1`,
      [row.ll2_id, mass.kg, mass.source, mass.note]
    );
  }
  return rows.length;
}
