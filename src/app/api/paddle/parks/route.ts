import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT p.slug, p.name, p.bbox, p.built_at, p.stats,
              (SELECT count(*)::int FROM paddle_campsites c
                WHERE c.park = p.slug AND c.status <> 'closed') AS campsites
         FROM paddle_parks p
        ORDER BY p.name`,
    );
    return NextResponse.json({ parks: rows });
  } catch (error) {
    console.error('paddle parks error:', error);
    return NextResponse.json({ error: 'Failed to load parks', detail: String(error) }, { status: 500 });
  }
}
