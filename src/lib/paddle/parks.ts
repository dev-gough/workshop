/**
 * Park registry for the Paddle Planner (RM 18). Adding a park here (plus a
 * `sync-paddle --park <slug>` run) is all it takes to bring a new region
 * online — the Ontario Trail Network carries ~128 named paddling networks,
 * so most Ontario destinations are one registry entry away.
 */
export interface ParkChart {
  /** Credit line for the purchased paper chart the tiles came from. */
  attribution: string;
  /** Highest zoom the tile package carries; MapLibre overzooms past it. */
  maxZoom: number;
}

export interface ParkDef {
  slug: string;
  name: string;
  /** [w, s, e, n] lon/lat fetch window for OHN water data. */
  bbox: [number, number, number, number];
  /** OTN TRAIL_NAME values whose polylines form this park's route network. */
  otnTrailNames: string[];
  /**
   * Purchased raster chart (Maps by Jeff tile package), if Devon owns one.
   * Tiles are served straight out of the Esri bundles in
   * `.cache/paddle/<slug>/jeff/tile` (import with `npm run import-jeff-tiles`);
   * personal-use only, never committed. The parks API only advertises the
   * chart when the tiles are actually present on disk.
   */
  chart?: ParkChart;
}

export const PARKS: Record<string, ParkDef> = {
  temagami: {
    slug: 'temagami',
    name: 'Temagami',
    bbox: [-80.9, 46.55, -79.4, 47.6],
    otnTrailNames: ['Temagami Canoe Route'],
    // Chart purchase planned — same package as Algonquin's. Once the tpkx is
    // imported this entry lights up automatically.
    chart: {
      attribution: 'Paper chart © Maps by Jeff (personal copy)',
      maxZoom: 15,
    },
  },
  algonquin: {
    slug: 'algonquin',
    name: 'Algonquin',
    bbox: [-79.1, 45.05, -76.9, 46.25],
    otnTrailNames: ['Algonquin Provincial Park Canoe Routes'],
    chart: {
      attribution: 'Paper chart: Algonquin Paddling Map v6.0 © Maps by Jeff (personal copy)',
      maxZoom: 15,
    },
  },
};
