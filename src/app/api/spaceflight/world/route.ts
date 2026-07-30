import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// The world-range dataset: per-family aggregates + yearly series. GCAT's
// SpaceX families are excluded and replaced by our LL2-driven vehicles so
// the room never shows two competing SpaceX numbers (the masses themselves
// are GCAT-adopted where launches match, so the totals line up anyway).
const SPACEX_GCAT_FAMILIES = ['Falcon1', 'Falcon9', 'Starship'];

// Delivered = reached and stayed in orbit (same rule as the rest of the room).
const SPACEX_DELIVERED =
  `status IN ('Success','Partial Failure') AND orbit_abbrev IS DISTINCT FROM 'Sub'`;

export async function GET() {
  try {
    const [gcat, gcatYearly, spacex, spacexYearly, meta] = await Promise.all([
      pool.query(
        `SELECT family AS key, count(*)::int AS flights,
                count(*) FILTER (WHERE success)::int AS successes,
                coalesce(sum(payload_t) FILTER (WHERE success), 0)::float AS t_delivered,
                coalesce(sum(payload_t), 0)::float AS t_launched,
                min(year)::int AS first_year, max(year)::int AS last_year
           FROM gcat_launches
          WHERE family <> ALL($1)
          GROUP BY family`,
        [SPACEX_GCAT_FAMILIES]
      ),
      pool.query(
        `SELECT family AS key, year,
                coalesce(sum(payload_t) FILTER (WHERE success), 0)::float AS del,
                coalesce(sum(payload_t), 0)::float AS lau
           FROM gcat_launches
          WHERE family <> ALL($1)
          GROUP BY family, year`,
        [SPACEX_GCAT_FAMILIES]
      ),
      pool.query(
        `SELECT vehicle AS key, count(*)::int AS flights,
                count(*) FILTER (WHERE status = 'Success')::int AS successes,
                coalesce(sum(mass_kg) FILTER (WHERE ${SPACEX_DELIVERED}), 0)::float / 1000 AS t_delivered,
                coalesce(sum(mass_kg), 0)::float / 1000 AS t_launched,
                min(extract(year FROM net))::int AS first_year,
                max(extract(year FROM net))::int AS last_year
           FROM spaceflight_launches
          WHERE NOT is_upcoming
          GROUP BY vehicle`
      ),
      pool.query(
        `SELECT vehicle AS key, extract(year FROM net)::int AS year,
                coalesce(sum(mass_kg) FILTER (WHERE ${SPACEX_DELIVERED}), 0)::float / 1000 AS del,
                coalesce(sum(mass_kg), 0)::float / 1000 AS lau
           FROM spaceflight_launches
          WHERE NOT is_upcoming
          GROUP BY vehicle, extract(year FROM net)`
      ),
      pool.query(`SELECT value FROM spaceflight_meta WHERE key = 'last_gcat_sync'`),
    ]);

    const yearly = new Map<string, Array<{ y: number; del: number; lau: number }>>();
    for (const r of [...gcatYearly.rows, ...spacexYearly.rows]) {
      const list = yearly.get(r.key) ?? [];
      list.push({ y: r.year, del: r.del, lau: r.lau });
      yearly.set(r.key, list);
    }

    const families = [...gcat.rows, ...spacex.rows].map((r) => ({
      key: r.key,
      spacex: spacex.rows.includes(r),
      flights: r.flights,
      successes: r.successes,
      tDelivered: r.t_delivered,
      tLaunched: r.t_launched,
      firstYear: r.first_year,
      lastYear: r.last_year,
      yearly: (yearly.get(r.key) ?? []).sort((a, b) => a.y - b.y),
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
