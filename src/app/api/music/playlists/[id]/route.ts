import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const username = request.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'Missing username' }, { status: 400 });

  const playlist = await pool.query(
    `SELECT id, name, username FROM playlists WHERE id = $1 AND username = $2`,
    [id, username]
  );
  if (playlist.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const songs = await pool.query(
    `SELECT artist, album, song, position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position`,
    [id]
  );
  return NextResponse.json({ ...playlist.rows[0], songs: songs.rows });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { username, name } = await request.json();
  if (!username || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const result = await pool.query(
    `UPDATE playlists SET name = $1, updated_at = now() WHERE id = $2 AND username = $3 RETURNING id, name`,
    [name, id, username]
  );
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const username = request.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'Missing username' }, { status: 400 });

  await pool.query(`DELETE FROM playlists WHERE id = $1 AND username = $2`, [id, username]);
  return NextResponse.json({ ok: true });
}
