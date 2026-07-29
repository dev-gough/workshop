import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// The whole room renders from this one payload: every past launch (charts
// aggregate client-side, where the delivered/launched toggle lives), the next
// launch for the countdown, and the sync timestamp for the console footer.
export async function GET() {
  try {
    const [launches, upcoming, meta] = await Promise.all([
      pool.query(
        `SELECT ll2_id, name, mission_name, vehicle, config_name, net, status,
                orbit_abbrev, orbit_name, pad_name, pad_location,
                mass_kg, mass_source, mass_note
           FROM spaceflight_launches
          WHERE NOT is_upcoming
          ORDER BY net`
      ),
      pool.query(
        `SELECT ll2_id, name, mission_name, vehicle, config_name, net, status,
                orbit_abbrev, pad_name, pad_location, description
           FROM spaceflight_launches
          WHERE is_upcoming AND net > now()
          ORDER BY net
          LIMIT 3`
      ),
      pool.query(`SELECT value FROM spaceflight_meta WHERE key = 'last_sync'`),
    ]);

    return NextResponse.json({
      launches: launches.rows,
      upcoming: upcoming.rows,
      lastSync: meta.rows[0]?.value ?? null,
    });
  } catch (error) {
    console.error('spaceflight launches error:', error);
    return NextResponse.json(
      { error: 'Failed to load launches', detail: String(error) },
      { status: 500 }
    );
  }
}
