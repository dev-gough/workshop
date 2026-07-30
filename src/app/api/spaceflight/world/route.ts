import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// The world-range dataset: per-family, per-year mass *components*, so the
// client can recombine them under any accounting instantly:
//   p — payload proper (satellites, cargo, capsules)
//   c — orbited spacecraft GCAT already counts inside OrbPay (Shuttle
//       orbiter, Buran) plus Starship ships on the SpaceX side
//   s — orbit-reaching upper-stage dry mass (never in GCAT's OrbPay)
// Each split into delivered/launched. GCAT's SpaceX families are excluded
// and replaced by our LL2-driven vehicles so the room never shows two
// competing SpaceX numbers.
const SPACEX_GCAT_FAMILIES = ['Falcon1', 'Falcon9', 'Starship'];

// Delivered = reached and stayed in orbit (same rule as the rest of the room).
const SPACEX_DELIVERED =
  `status IN ('Success','Partial Failure') AND orbit_abbrev IS DISTINCT FROM 'Sub'`;

// Spaceplane masses GCAT includes in OrbPay. The Shuttle constant is the
// lightest recorded OrbPay (STS-1, near-empty bay) — every flight's figure
// is orbiter + cargo, so subtracting it approximates cargo-only.
const SHUTTLE_ORBITER_T = 94.5;
const BURAN_T = 79.4;

// Approximate dry masses (t) of the stage each family leaves in orbit —
// GCAT never counts these. Families not listed contribute 0 in "+ stages"
// accounting; coverage spans the highest-tonnage families.
const STAGE_T: Record<string, number> = {
  'R-7': 2.5, // Blok-I; the early core stages that orbited were heavier
  Proton: 2.4, // Blok-D/DM, Briz-M
  DF5: 3.0, // Long March 2/3/4 upper stages
  CZ5: 6.0,
  Titan: 2.0, // Transtage / core second stage
  Atlas: 2.0, // sustainer / Agena / Centaur
  Atlas5: 2.3, // Centaur III
  Delta4: 3.5, // DCSS
  Thor: 0.9, // Delta-K
  Ariane: 1.7, // H10
  Ariane5: 4.5, // ESC-A
  Ariane6: 5.0,
  SaturnV: 13.5, // S-IVB reached orbit on every flight
  Saturn: 10.0, // S-IV / S-IVB
  Zenit: 9.0, // second stage orbits
  H2: 3.0,
  H2B: 3.0,
  Vulcan: 5.5, // Centaur V
  NewGlenn: 23, // GS2 — unpublished, community estimate
  Electron: 0.25, // stage 2 + kick stage
  PSLV: 0.9, // PS4
  GSLV3: 4.0, // C25
  Angara: 2.4, // Briz-M / Persei
  'R-36': 2.0, // Tsyklon
  'R-14': 1.4, // Kosmos-3M
  'R-12': 0.9, // Kosmos-2
  Pegasus: 0.13,
};

function craftT(lvType: string): number {
  if (/space shuttle/i.test(lvType)) return SHUTTLE_ORBITER_T;
  if (/buran/i.test(lvType)) return BURAN_T;
  return 0;
}

function stageT(family: string, lvType: string): number {
  // SRB is the Shuttle+SLS lineage: the orbiter IS the shuttle's orbited
  // stage (already in `c`); SLS leaves an ICPS in orbit instead.
  if (family === 'SRB') return /shuttle/i.test(lvType) ? 0 : 3.5;
  return STAGE_T[family] ?? 0;
}

// Starship ships count as orbited spacecraft (GCAT credits 120 t each) for
// the flights GCAT catalogs as orbital attempts — V1.0 onward.
const SHIP_T = 120;
const SHIP_FROM = '2024-06-01';
const SPACEX_STAGE_T: Record<string, number> = {
  'Falcon 1': 0.36,
  'Falcon 9': 4.0,
  'Falcon Heavy': 4.0,
  Starship: 0, // the ship is the orbited hardware; counted in `c`
};

interface YearRow {
  y: number;
  n: number;
  ok: number;
  pd: number;
  pl: number;
  cd: number;
  cl: number;
  sd: number;
  sl: number;
}

export async function GET() {
  try {
    const [gcat, spacex, meta] = await Promise.all([
      pool.query(
        `SELECT family, lv_type, year,
                count(*)::int AS n,
                count(*) FILTER (WHERE success)::int AS ok,
                coalesce(sum(payload_t) FILTER (WHERE success), 0)::float AS del,
                coalesce(sum(payload_t), 0)::float AS lau
           FROM gcat_launches
          WHERE family <> ALL($1)
          GROUP BY family, lv_type, year`,
        [SPACEX_GCAT_FAMILIES]
      ),
      pool.query(
        `SELECT vehicle AS key, extract(year FROM net)::int AS year,
                count(*)::int AS n,
                count(*) FILTER (WHERE status = 'Success')::int AS ok,
                count(*) FILTER (WHERE ${SPACEX_DELIVERED})::int AS n_orb,
                count(*) FILTER (WHERE vehicle = 'Starship' AND net >= $1)::int AS ship_n,
                count(*) FILTER (WHERE vehicle = 'Starship' AND net >= $1
                                   AND status IN ('Success','Partial Failure'))::int AS ship_ok,
                coalesce(sum(mass_kg) FILTER (WHERE ${SPACEX_DELIVERED}), 0)::float / 1000 AS del,
                coalesce(sum(mass_kg), 0)::float / 1000 AS lau
           FROM spaceflight_launches
          WHERE NOT is_upcoming
          GROUP BY vehicle, extract(year FROM net)`,
        [SHIP_FROM]
      ),
      pool.query(`SELECT value FROM spaceflight_meta WHERE key = 'last_gcat_sync'`),
    ]);

    const byFamily = new Map<string, Map<number, YearRow>>();
    const row = (key: string, y: number): YearRow => {
      let years = byFamily.get(key);
      if (!years) byFamily.set(key, (years = new Map()));
      let r = years.get(y);
      if (!r) years.set(y, (r = { y, n: 0, ok: 0, pd: 0, pl: 0, cd: 0, cl: 0, sd: 0, sl: 0 }));
      return r;
    };

    for (const g of gcat.rows) {
      const r = row(g.family, g.year);
      const craft = craftT(g.lv_type);
      const stage = stageT(g.family, g.lv_type);
      r.n += g.n;
      r.ok += g.ok;
      // OrbPay already contains the spaceplane; carve it out into `c`.
      r.pd += g.del - craft * g.ok;
      r.pl += g.lau - craft * g.n;
      r.cd += craft * g.ok;
      r.cl += craft * g.n;
      r.sd += stage * g.ok;
      r.sl += stage * g.n;
    }

    const spacexKeys = new Set<string>();
    for (const s of spacex.rows) {
      spacexKeys.add(s.key);
      const r = row(s.key, s.year);
      const stage = SPACEX_STAGE_T[s.key] ?? 0;
      r.n += s.n;
      r.ok += s.ok;
      r.pd += s.del;
      r.pl += s.lau;
      r.cd += SHIP_T * s.ship_ok;
      r.cl += SHIP_T * s.ship_n;
      r.sd += stage * s.n_orb;
      r.sl += stage * s.n;
    }

    const families = [...byFamily.entries()].map(([key, years]) => ({
      key,
      spacex: spacexKeys.has(key),
      yearly: [...years.values()].sort((a, b) => a.y - b.y),
    }));

    return NextResponse.json({
      families,
      lastGcatSync: meta.rows[0]?.value ?? null,
    });
  } catch (error) {
    console.error('spaceflight world error:', error);
    return NextResponse.json(
      { error: 'Failed to load world data', detail: String(error) },
      { status: 500 }
    );
  }
}
