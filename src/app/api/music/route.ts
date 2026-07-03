import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, artist, name, songs, source, added_at AS "addedAt",
              CASE WHEN cover_path IS NOT NULL THEN '/api/music/cover/' || id END AS "coverUrl"
       FROM albums ORDER BY artist, name`
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching albums:', error);
    return NextResponse.json([], { status: 500 });
  }
}
