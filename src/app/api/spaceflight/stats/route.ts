import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Compact per-vehicle aggregates for the homepage tile. "Delivered" here
// means mass that reached (and stayed in) orbit: successful or partially
// successful flights, excluding suborbital trajectories.
export async function GET() {
  try {
    const [vehicles, next] = await Promise.all([
      pool.query(
        `SELECT vehicle,
                count(*)::int AS flights,
                round(coalesce(sum(mass_kg) FILTER (
                  WHERE status IN ('Success', 'Partial Failure')
                    AND orbit_abbrev IS DISTINCT FROM 'Sub'
                ), 0)::numeric / 1000, 1)::float AS tonnes_delivered,
                min(net) AS first_launch,
                max(net) AS last_launch
           FROM spaceflight_launches
          WHERE NOT is_upcoming
          GROUP BY vehicle
          ORDER BY min(net)`
      ),
      pool.query(
        `SELECT name, net FROM spaceflight_launches
          WHERE is_upcoming AND net > now()
          ORDER BY net LIMIT 1`
      ),
    ]);

    return NextResponse.json({
      vehicles: vehicles.rows,
      nextLaunch: next.rows[0] ?? null,
    });
  } catch (error) {
    console.error('spaceflight stats error:', error);
    return NextResponse.json(
      { error: 'Failed to load stats', detail: String(error) },
      { status: 500 }
    );
  }
}
