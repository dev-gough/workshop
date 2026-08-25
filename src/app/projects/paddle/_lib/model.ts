/** Resume the last park on the radar / chart. Shared by home and map. */
export const LAST_PARK_KEY = 'pd-last-park';

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

/** Neon silhouette for a home-screen park card. */
export interface ParkOutline {
  slug: string;
  name: string;
  outline: [number, number][];
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
  /** OIWMS aerial orthophoto pyramid, present when imported to disk. */
  imagery: { maxZoom: number; attribution: string } | null;
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

/** Panel views. Future field features (GPS, leg timing, photos) join as new
 *  entries here + a component — the shell doesn't care how many there are. */
export type View = 'map' | 'trips' | 'trip' | 'review';

/** A kind-change proposal from the imagery flagger (paddle_kind_overrides). */
export interface ReviewItem {
  id: number;
  seg_hint: number | null;
  before_kind: 'paddle' | 'portage';
  coords: [number, number][];
  pieces: { coords: [number, number][]; kind: 'paddle' | 'portage' | 'track' }[];
  evidence: { waterFrac: number; nullFrac: number; samples: number; lengthM: number; confidence: number };
  status: 'proposed' | 'approved' | 'rejected' | 'unclear';
  created_at: string;
  decided_at: string | null;
}

export interface TripStats {
  paddleM: number;
  portageM: number;
  trackM: number;
  carries: number;
  timeH: number;
  days: number;
}

export interface TripSummary {
  park: string;
  slug: string;
  name: string;
  waypoints: number;
  stats: TripStats | null;
  updated_at: string;
}

/** Persisted trip: geometry only — waypoints re-snap to the current network
 *  on load, so saved trips survive re-ingests. */
export interface TripData {
  park: string;
  slug: string;
  name: string;
  waypoints: [number, number, number][];
  cost: Record<string, unknown>;
}

export function fmtKm(m: number): string {
  return m >= 9950 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
