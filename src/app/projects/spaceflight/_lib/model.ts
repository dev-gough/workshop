// Client-side aggregation for RM 17. The API hands over every past launch;
// everything the room displays — per-vehicle consoles, both charts, the log —
// derives from that one list so the delivered/launched toggle is instant.

export interface Launch {
  ll2_id: string;
  name: string;
  mission_name: string | null;
  vehicle: string;
  config_name: string;
  net: string;
  status: string;
  orbit_abbrev: string | null;
  orbit_name: string | null;
  pad_name: string | null;
  pad_location: string | null;
  mass_kg: number | null;
  mass_source: 'lookup' | 'starlink' | 'dragon' | 'coarse' | 'none';
  mass_note: string | null;
}

export interface UpcomingLaunch {
  ll2_id: string;
  name: string;
  mission_name: string | null;
  vehicle: string;
  net: string;
  status: string;
  pad_name: string | null;
  pad_location: string | null;
  description: string | null;
}

/** Fixed categorical order — legend, stacks and consoles never re-sort. */
export const VEHICLES = ['Falcon 1', 'Falcon 9', 'Falcon Heavy', 'Starship'] as const;
export type Vehicle = (typeof VEHICLES)[number];

export const VEHICLE_COLOR: Record<Vehicle, string> = {
  'Falcon 1': 'var(--sf-f1)',
  'Falcon 9': 'var(--sf-f9)',
  'Falcon Heavy': 'var(--sf-fh)',
  Starship: 'var(--sf-ss)',
};

export type Mode = 'delivered' | 'launched';

/**
 * Mass a launch contributes under the current counting mode.
 * Delivered = reached (and stayed in) orbit: success or partial success on a
 * non-suborbital trajectory. Launched = everything that left the pad,
 * including failures and Starship's suborbital test arcs.
 */
export function countedKg(l: Launch, mode: Mode): number {
  if (l.mass_kg == null) return 0;
  if (mode === 'launched') return l.mass_kg;
  const reached = l.status === 'Success' || l.status === 'Partial Failure';
  return reached && l.orbit_abbrev !== 'Sub' ? l.mass_kg : 0;
}

/** True when the number shown is an estimate rather than a published mass. */
export function isEstimate(l: Launch): boolean {
  return l.mass_source !== 'lookup';
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const ACTIVE_WINDOW_MS = 1.5 * YEAR_MS;

export interface VehicleStats {
  vehicle: Vehicle;
  flights: number;
  successes: number;
  failures: number;
  tonnes: number;
  tPerFlight: number;
  years: number; // operational span; runs to "now" while the vehicle is active
  tPerYear: number;
  firstYear: number;
  lastYear: number;
  active: boolean;
  /** per-calendar-year tonnage, for the console sparkline */
  yearly: Array<{ year: number; tonnes: number }>;
}

export function vehicleStats(launches: Launch[], mode: Mode, now: number): VehicleStats[] {
  return VEHICLES.filter((v) => launches.some((l) => l.vehicle === v)).map((vehicle) => {
    const own = launches.filter((l) => l.vehicle === vehicle);
    const first = new Date(own[0].net).getTime();
    const last = new Date(own[own.length - 1].net).getTime();
    const active = now - last < ACTIVE_WINDOW_MS;
    const years = Math.max(((active ? now : last) - first) / YEAR_MS, 0.5);
    const tonnes = own.reduce((s, l) => s + countedKg(l, mode), 0) / 1000;

    const byYear = new Map<number, number>();
    for (const l of own) {
      const y = new Date(l.net).getUTCFullYear();
      byYear.set(y, (byYear.get(y) ?? 0) + countedKg(l, mode) / 1000);
    }
    const firstYear = new Date(first).getUTCFullYear();
    const lastYear = new Date(active ? now : last).getUTCFullYear();
    const yearly: VehicleStats['yearly'] = [];
    for (let y = firstYear; y <= lastYear; y++) {
      yearly.push({ year: y, tonnes: byYear.get(y) ?? 0 });
    }

    return {
      vehicle,
      flights: own.length,
      successes: own.filter((l) => l.status === 'Success').length,
      failures: own.filter((l) => l.status === 'Failure').length,
      tonnes,
      tPerFlight: tonnes / own.length,
      years,
      tPerYear: tonnes / years,
      firstYear,
      lastYear: new Date(last).getUTCFullYear(),
      active,
      yearly,
    };
  });
}

export interface CumPoint {
  t: number; // ms epoch
  v: number; // cumulative tonnes
}

/** Cumulative tonnage series per vehicle (stepped — mass arrives per launch). */
export function cumulativeSeries(launches: Launch[], mode: Mode): Map<Vehicle, CumPoint[]> {
  const out = new Map<Vehicle, CumPoint[]>();
  for (const vehicle of VEHICLES) {
    const own = launches.filter((l) => l.vehicle === vehicle);
    if (own.length === 0) continue;
    const pts: CumPoint[] = [{ t: new Date(own[0].net).getTime(), v: 0 }];
    let cum = 0;
    for (const l of own) {
      cum += countedKg(l, mode) / 1000;
      pts.push({ t: new Date(l.net).getTime(), v: cum });
    }
    out.set(vehicle, pts);
  }
  return out;
}

export interface YearRow {
  year: number;
  byVehicle: Partial<Record<Vehicle, number>>;
  total: number;
}

export function yearlyTotals(launches: Launch[], mode: Mode): YearRow[] {
  if (launches.length === 0) return [];
  const first = new Date(launches[0].net).getUTCFullYear();
  const last = new Date(launches[launches.length - 1].net).getUTCFullYear();
  const rows: YearRow[] = [];
  for (let y = first; y <= last; y++) {
    rows.push({ year: y, byVehicle: {}, total: 0 });
  }
  for (const l of launches) {
    const row = rows[new Date(l.net).getUTCFullYear() - first];
    const t = countedKg(l, mode) / 1000;
    const v = l.vehicle as Vehicle;
    row.byVehicle[v] = (row.byVehicle[v] ?? 0) + t;
    row.total += t;
  }
  return rows;
}

/** "8,709 t" / "13.0 t" — tonnes with sensible precision for the scale. */
export function fmtTonnes(t: number): string {
  if (t >= 100) return `${Math.round(t).toLocaleString('en-US')} t`;
  if (t >= 1) return `${t.toFixed(1)} t`;
  return `${(t * 1000).toFixed(0)} kg`;
}
