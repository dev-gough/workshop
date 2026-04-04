import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [topSongs, topAlbums, topListeners, recentPlays] = await Promise.all([
      pool.query(`
        SELECT artist, album, song, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY artist, album, song
        ORDER BY play_count DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT artist, album, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY artist, album
        ORDER BY play_count DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT username, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY username
        ORDER BY play_count DESC
      `),
      pool.query(`
        SELECT artist, album, song, username, played_at
        FROM plays
        ORDER BY played_at DESC
        LIMIT 30
      `),
    ]);

    return NextResponse.json({
      topSongs: topSongs.rows,
      topAlbums: topAlbums.rows,
      topListeners: topListeners.rows,
      recentPlays: recentPlays.rows,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
