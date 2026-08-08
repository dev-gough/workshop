import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { PARKS } from '@/lib/paddle/parks';
import { chartOnDisk } from '@/lib/paddle/jefftiles';

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
    const parks = rows.map((row) => {
      const chart = PARKS[row.slug]?.chart;
      return {
        ...row,
        // Advertise the purchased chart only when its tiles are on disk.
        chart: chart && chartOnDisk(row.slug) ? chart : null,
      };
    });
    return NextResponse.json({ parks });
  } catch (error) {
    console.error('paddle parks error:', error);
    return NextResponse.json({ error: 'Failed to load parks', detail: String(error) }, { status: 500 });
  }
}
