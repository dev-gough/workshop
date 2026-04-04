import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'Missing username' }, { status: 400 });

  const result = await pool.query(
    `SELECT p.id, p.name, p.created_at, COUNT(ps.id)::int AS song_count
     FROM playlists p
     LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
     WHERE p.username = $1
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
    [username]
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const { username, name } = await request.json();
  if (!username || !name) return NextResponse.json({ error: 'Missing username or name' }, { status: 400 });

  const result = await pool.query(
    `INSERT INTO playlists (username, name) VALUES ($1, $2) RETURNING id, name, created_at`,
    [username, name]
  );
  return NextResponse.json(result.rows[0], { status: 201 });
}
