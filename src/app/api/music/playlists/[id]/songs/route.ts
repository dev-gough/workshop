import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { username, artist, album, song } = await request.json();
  if (!username || !artist || !album || !song) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Verify ownership
  const playlist = await pool.query(`SELECT id FROM playlists WHERE id = $1 AND username = $2`, [id, username]);
  if (playlist.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Get next position
  const maxPos = await pool.query(`SELECT COALESCE(MAX(position), 0) + 1 AS next FROM playlist_songs WHERE playlist_id = $1`, [id]);

  const result = await pool.query(
    `INSERT INTO playlist_songs (playlist_id, artist, album, song, position)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (playlist_id, artist, album, song) DO NOTHING
     RETURNING id`,
    [id, artist, album, song, maxPos.rows[0].next]
  );

  await pool.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);

  return NextResponse.json({ added: result.rowCount! > 0 }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { username, artist, album, song } = await request.json();
  if (!username || !artist || !album || !song) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const playlist = await pool.query(`SELECT id FROM playlists WHERE id = $1 AND username = $2`, [id, username]);
  if (playlist.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await pool.query(
    `DELETE FROM playlist_songs WHERE playlist_id = $1 AND artist = $2 AND album = $3 AND song = $4`,
    [id, artist, album, song]
  );

  await pool.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);

  return NextResponse.json({ ok: true });
}
