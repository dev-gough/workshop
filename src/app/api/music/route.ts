import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await pool.query(
      'SELECT artist, name, thumbnail AS "coverImage", songs, source, added_at AS "addedAt" FROM albums ORDER BY artist, name'
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching albums:', error);
    return NextResponse.json([], { status: 500 });
  }
}
