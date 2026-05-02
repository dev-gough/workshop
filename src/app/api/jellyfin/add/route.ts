import { NextRequest, NextResponse } from 'next/server';
import { addTorrent } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const STAGING = {
  tv: '/Media/.staging/tv',
  movie: '/Media/.staging/movies',
} as const;

export async function POST(request: NextRequest) {
  try {
    const { link, mode } = await request.json();

    if (!link || typeof link !== 'string') {
      return NextResponse.json({ error: 'link required' }, { status: 400 });
    }
    if (mode !== 'tv' && mode !== 'movie') {
      return NextResponse.json({ error: 'mode must be "tv" or "movie"' }, { status: 400 });
    }
    const safeMode: 'tv' | 'movie' = mode;

    const trimmed = link.trim();
    const isValid =
      trimmed.startsWith('magnet:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://');
    if (!isValid) {
      return NextResponse.json({ error: 'link must be a magnet: or http(s) URL' }, { status: 400 });
    }

    const added = await addTorrent(trimmed, STAGING[safeMode]);

    const { rows } = await pool.query(
      `INSERT INTO jellyfin_torrents (transmission_id, hash, mode, link, original_name, staging_path, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'downloading')
       RETURNING *`,
      [added.id, added.hashString.toLowerCase(), mode, trimmed, added.name, STAGING[safeMode]],
    );

    return NextResponse.json({ torrent: rows[0], transmission: added });
  } catch (error) {
    return NextResponse.json(
      { error: 'Add failed', detail: String(error) },
      { status: 500 },
    );
  }
}
