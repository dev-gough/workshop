import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const { rows } = await pool.query(
      `SELECT park, slug, name, waypoints, cost, notes, updated_at
         FROM paddle_trips WHERE slug = $1`,
      [slug],
    );
    if (!rows.length) return NextResponse.json({ error: 'No such trip' }, { status: 404 });
    return NextResponse.json({ trip: rows[0] });
  } catch (error) {
    console.error('paddle trip get error:', error);
    return NextResponse.json({ error: 'Failed to load trip' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    await pool.query(`DELETE FROM paddle_trips WHERE slug = $1`, [slug]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('paddle trip delete error:', error);
    return NextResponse.json({ error: 'Failed to delete trip' }, { status: 500 });
  }
}
