/**
 * Park registry for the Paddle Planner (RM 18). Adding a park here (plus a
 * `sync-paddle --park <slug>` run) is all it takes to bring a new region
 * online — the Ontario Trail Network carries ~128 named paddling networks,
 * so most Ontario destinations are one registry entry away.
 */
export interface ParkDef {
  slug: string;
  name: string;
  /** [w, s, e, n] lon/lat fetch window for OHN water data. */
  bbox: [number, number, number, number];
  /** OTN TRAIL_NAME values whose polylines form this park's route network. */
  otnTrailNames: string[];
}

export const PARKS: Record<string, ParkDef> = {
  temagami: {
    slug: 'temagami',
    name: 'Temagami',
    bbox: [-80.9, 46.55, -79.4, 47.6],
    otnTrailNames: ['Temagami Canoe Route'],
  },
  // Staged for the first post-MVP ingest — 2,173 km in OTN, same accuracy.
  algonquin: {
    slug: 'algonquin',
    name: 'Algonquin',
    bbox: [-79.1, 45.05, -76.9, 46.25],
    otnTrailNames: ['Algonquin Provincial Park Canoe Routes'],
  },
};
