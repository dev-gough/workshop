import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// The whole routable graph for one park in a single payload (~3 MB for
// Temagami) — routing runs client-side, so the room fetches this once and
// never round-trips per waypoint.
export async function GET(request: Request) {
  const park = new URL(request.url).searchParams.get('park') ?? 'temagami';
  try {
    const [nodes, segments, campsites, access] = await Promise.all([
      pool.query(`SELECT id, lon, lat FROM paddle_nodes WHERE park = $1 ORDER BY id`, [park]),
      pool.query(
        `SELECT id, kind, node_a AS a, node_b AS b, length_m, coords
           FROM paddle_segments WHERE park = $1 ORDER BY id`,
        [park],
      ),
      pool.query(
        `SELECT id, name, lon, lat, notes, status
           FROM paddle_campsites WHERE park = $1 ORDER BY id`,
        [park],
      ),
      pool.query(`SELECT ogf_id, name, lon, lat FROM paddle_access_points WHERE park = $1`, [park]),
    ]);
    return NextResponse.json({
      nodes: nodes.rows,
      segments: segments.rows,
      campsites: campsites.rows,
      accessPoints: access.rows,
    });
  } catch (error) {
    console.error('paddle network error:', error);
    return NextResponse.json({ error: 'Failed to load network', detail: String(error) }, { status: 500 });
  }
}
