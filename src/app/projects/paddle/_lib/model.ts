export interface ParkStats {
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

export interface ParkInfo {
  slug: string;
  name: string;
  bbox: [number, number, number, number];
  built_at: string | null;
  stats: ParkStats | null;
  campsites: number;
  /** Purchased paper chart (Maps by Jeff), present when its tiles are on disk. */
  chart: { attribution: string; maxZoom: number } | null;
  /** Cached elevation tiles (terrarium DEM), present when imported to disk.
   *  `bounds` is the padded import window (wider than the park bbox). */
  dem: { maxZoom: number; bounds: [number, number, number, number] } | null;
}

export interface NetworkSegment {
  id: number;
  kind: 'paddle' | 'portage' | 'track';
  a: number;
  b: number;
  length_m: number;
  coords: [number, number][];
}

export interface Network {
  nodes: { id: number; lon: number; lat: number }[];
  segments: NetworkSegment[];
  campsites: { id: number; name: string | null; lon: number; lat: number; notes: string | null; status: string }[];
  accessPoints: { ogf_id: number; name: string | null; lon: number; lat: number }[];
}

/** What the cursor is over on the map — feeds the surveyor's readout.
 *  `elevM` is ground elevation under the cursor, present when relief is on;
 *  `lngLat` is always the cursor position (the readout prints it lat-first). */
export type HoverInfo =
  | { type: 'segment'; kind: 'paddle' | 'portage' | 'track'; lengthM: number; elevM?: number | null; lngLat: [number, number] }
  | { type: 'lake'; name: string | null; areaM2: number; elevM?: number | null; lngLat: [number, number] }
  | { type: 'campsite'; name: string | null; lngLat: [number, number] }
  | { type: 'ground'; elevM: number | null; lngLat: [number, number] };

/** "lat, lon" at ~1 m precision — the paste-friendly report format. */
export function fmtLatLon(lngLat: [number, number]): string {
  return `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
}

export function fmtKm(m: number): string {
  return m >= 9950 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
