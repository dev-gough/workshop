// Client-side aggregation for RM 03. The API hands over every past launch
// (and per-year mass components for the world families); everything the room
// displays derives from those lists, so every control — counting mode,
// accounting basis, year window, series muting — recomputes instantly.

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
  mass_source: 'gcat' | 'lookup' | 'starlink' | 'dragon' | 'coarse' | 'none';
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
 * The accounting basis — what counts as "mass in orbit":
 *   payload — satellites, cargo and capsules only
 *   craft   — + orbited spacecraft (Shuttle orbiter, Buran, Starship ships);
 *             this is GCAT's own convention
 *   stages  — + the upper stage each vehicle leaves in orbit (dry mass)
 */
export type Accounting = 'payload' | 'craft' | 'stages';

/** Inclusive year window applied across the whole room. */
export type YearRange = [number, number];
export const RANGE_MIN = 1957;

// Starship ships count as orbited spacecraft (GCAT credits 120 t each) for
// the flights GCAT catalogs as orbital attempts — V1.0 onward.
const SHIP_KG = 120_000;
const SHIP_FROM = Date.UTC(2024, 5, 1);
const SPACEX_STAGE_KG: Record<Vehicle, number> = {
  'Falcon 1': 360,
  'Falcon 9': 4000,
  'Falcon Heavy': 4000,
  Starship: 0, // the ship is the orbited hardware, counted under `craft`
};

/**
 * Mass a launch contributes under the current counting mode + accounting.
 * Delivered = reached (and stayed in) orbit; launched = everything that left
 * the pad. Ship hardware "delivers" whenever the flight succeeded — GCAT
 * treats Starship's transatmospheric arcs as orbital attempts.
 */
export function countedKg(l: Launch, mode: Mode, acct: Accounting): number {
  const reached = l.status === 'Success' || l.status === 'Partial Failure';
  const orbital = reached && l.orbit_abbrev !== 'Sub';
  let kg = 0;
  if (mode === 'launched' || orbital) kg += l.mass_kg ?? 0;
  if (acct !== 'payload' && l.vehicle === 'Starship' && new Date(l.net).getTime() >= SHIP_FROM) {
    if (mode === 'launched' || reached) kg += SHIP_KG;
  }
  if (acct === 'stages') {
    if (mode === 'launched' || orbital) kg += SPACEX_STAGE_KG[l.vehicle as Vehicle] ?? 0;
  }
  return kg;
}

/** True when the number shown is an estimate rather than a recorded mass. */
export function isEstimate(l: Launch): boolean {
  return l.mass_source !== 'lookup' && l.mass_source !== 'gcat';
}

export function launchYear(l: Launch): number {
  return new Date(l.net).getUTCFullYear();
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

export function vehicleStats(
  launches: Launch[],
  mode: Mode,
  acct: Accounting,
  now: number
): VehicleStats[] {
  return VEHICLES.filter((v) => launches.some((l) => l.vehicle === v)).map((vehicle) => {
    const own = launches.filter((l) => l.vehicle === vehicle);
    const first = new Date(own[0].net).getTime();
    const last = new Date(own[own.length - 1].net).getTime();
    const active = now - last < ACTIVE_WINDOW_MS;
    const years = Math.max(((active ? now : last) - first) / YEAR_MS, 0.5);
    const tonnes = own.reduce((s, l) => s + countedKg(l, mode, acct), 0) / 1000;

    const byYear = new Map<number, number>();
    for (const l of own) {
      const y = launchYear(l);
      byYear.set(y, (byYear.get(y) ?? 0) + countedKg(l, mode, acct) / 1000);
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
export function cumulativeSeries(
  launches: Launch[],
  mode: Mode,
  acct: Accounting
): Map<Vehicle, CumPoint[]> {
  const out = new Map<Vehicle, CumPoint[]>();
  for (const vehicle of VEHICLES) {
    const own = launches.filter((l) => l.vehicle === vehicle);
    if (own.length === 0) continue;
    const pts: CumPoint[] = [{ t: new Date(own[0].net).getTime(), v: 0 }];
    let cum = 0;
    for (const l of own) {
      cum += countedKg(l, mode, acct) / 1000;
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

export function yearlyTotals(launches: Launch[], mode: Mode, acct: Accounting): YearRow[] {
  if (launches.length === 0) return [];
  const first = launchYear(launches[0]);
  const last = launchYear(launches[launches.length - 1]);
  const rows: YearRow[] = [];
  for (let y = first; y <= last; y++) {
    rows.push({ year: y, byVehicle: {}, total: 0 });
  }
  for (const l of launches) {
    const row = rows[launchYear(l) - first];
    const t = countedKg(l, mode, acct) / 1000;
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

// ── World range (GCAT) ──────────────────────────────────────────────────────

/** One family-year of mass components: p payload, c orbited spacecraft,
 * s orbited stage — each as delivered (d) / launched (l) tonnes. */
export interface WorldYear {
  y: number;
  n: number; // flights
  ok: number; // successes
  pd: number;
  pl: number;
  cd: number;
  cl: number;
  sd: number;
  sl: number;
}

export interface WorldFamily {
  key: string;
  spacex: boolean;
  yearly: WorldYear[];
}

/** Tonnes one family-year contributes under the chosen mode + accounting. */
export function yearValue(r: WorldYear, mode: Mode, acct: Accounting): number {
  const p = mode === 'delivered' ? r.pd : r.pl;
  const c = mode === 'delivered' ? r.cd : r.cl;
  const s = mode === 'delivered' ? r.sd : r.sl;
  return p + (acct !== 'payload' ? c : 0) + (acct === 'stages' ? s : 0);
}

export interface FamilyTotals {
  tonnes: number;
  flights: number;
  successes: number;
  firstYear: number;
  lastYear: number;
}

export function familyTotals(
  f: WorldFamily,
  mode: Mode,
  acct: Accounting,
  range: YearRange
): FamilyTotals {
  let tonnes = 0;
  let flights = 0;
  let successes = 0;
  let firstYear = 0;
  let lastYear = 0;
  for (const r of f.yearly) {
    if (r.y < range[0] || r.y > range[1] || r.n === 0) continue;
    tonnes += yearValue(r, mode, acct);
    flights += r.n;
    successes += r.ok;
    if (firstYear === 0) firstYear = r.y;
    lastYear = r.y;
  }
  return { tonnes, flights, successes, firstYear, lastYear };
}

/** Cumulative tonnes series from a family's yearly rows, within the window. */
export function familyCumulative(
  f: WorldFamily,
  mode: Mode,
  acct: Accounting,
  range: YearRange
): CumPoint[] {
  const rows = f.yearly.filter((r) => r.y >= range[0] && r.y <= range[1]);
  if (rows.length === 0) return [];
  const pts: CumPoint[] = [{ t: Date.UTC(rows[0].y, 0, 1), v: 0 }];
  let cum = 0;
  for (const row of rows) {
    cum += yearValue(row, mode, acct);
    pts.push({ t: Date.UTC(row.y, 11, 31), v: cum });
  }
  return pts;
}

/**
 * Human labels for GCAT's lineage-based family codes. GCAT groups by design
 * heritage, which produces a few surprises worth naming honestly: the
 * Shuttle lives in "SRB" together with SLS; Long March 2/3/4 descend from
 * the DF-5 missile. Unmapped codes pass through as-is.
 */
const FAMILY_LABEL: Record<string, string> = {
  SRB: 'Shuttle / SLS',
  'R-7': 'R-7 / Soyuz',
  Proton: 'Proton',
  DF5: 'Long March 2–4',
  CZ5: 'Long March 5',
  Ariane5: 'Ariane 5',
  Ariane6: 'Ariane 6',
  Titan: 'Titan',
  Thor: 'Thor / Delta',
  'R-36': 'Tsyklon (R-36)',
  SaturnV: 'Saturn V',
  Saturn: 'Saturn I / IB',
  Atlas5: 'Atlas V',
  Atlas: 'Atlas (classic)',
  Ariane: 'Ariane 1–4',
  'R-14': 'Kosmos (R-14)',
  'R-12': 'Kosmos (R-12)',
  Delta4: 'Delta IV',
  H2B: 'H-IIB / H3',
  H2: 'H-II / H-IIA',
  Energiya: 'Energia',
  PSLV: 'PSLV',
  GSLV3: 'GSLV / LVM3',
  Angara: 'Angara',
  Vulcan: 'Vulcan',
  Electron: 'Electron',
  NewGlenn: 'New Glenn',
  'N-1': 'N-1',
  Zenit: 'Zenit',
};

export function familyLabel(key: string): string {
  return FAMILY_LABEL[key] ?? key;
}

/** World series colors, assigned by all-time delivered rank (GCAT
 * convention) and held fixed thereafter — color follows the entity, never
 * its rank under the current filter. Order is the validated reference
 * sequence. */
export const WORLD_RANK_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
export const WORLD_OTHER_COLOR = '#57685e';
const FULL_RANGE: YearRange = [RANGE_MIN, 2100];

export function assignWorldColors(families: WorldFamily[]): Map<string, string> {
  // SpaceX families rank too and consume their slot — Falcon 9 sits at #3,
  // where the palette entry happens to BE its vehicle green, which keeps the
  // world chart and the SpaceX consoles speaking one color language (and
  // keeps that green off any other family).
  const ranked = [...families].sort(
    (a, b) =>
      familyTotals(b, 'delivered', 'craft', FULL_RANGE).tonnes -
      familyTotals(a, 'delivered', 'craft', FULL_RANGE).tonnes
  );
  const m = new Map<string, string>();
  ranked.slice(0, WORLD_RANK_COLORS.length).forEach((f, i) => m.set(f.key, WORLD_RANK_COLORS[i]));
  return m;
}

/** Chart/leaderboard color for a family: fixed rank color, else the SpaceX
 * vehicle color, else the neutral "Other" tone. */
export function familyColor(f: WorldFamily, colors: Map<string, string>): string {
  return (
    colors.get(f.key) ??
    (f.spacex ? VEHICLE_COLOR[f.key as Vehicle] : undefined) ??
    WORLD_OTHER_COLOR
  );
}
