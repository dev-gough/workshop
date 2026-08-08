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
}

export interface NetworkSegment {
  id: number;
  kind: 'paddle' | 'portage';
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

/** What the cursor is over on the map — feeds the surveyor's readout. */
export type HoverInfo =
  | { type: 'segment'; kind: 'paddle' | 'portage'; lengthM: number }
  | { type: 'lake'; name: string | null; areaM2: number };

export function fmtKm(m: number): string {
  return m >= 9950 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
