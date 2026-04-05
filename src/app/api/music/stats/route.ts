import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [
      topSongs,
      topAlbums,
      topArtists,
      topListeners,
      recentPlays,
      summary,
      dailyPlays,
      hourlyHeatmap,
      streakDates,
      mostActiveDay,
      firstPlay,
    ] = await Promise.all([
      pool.query(`
        SELECT artist, album, song, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY artist, album, song
        ORDER BY play_count DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT p.artist, p.album, COUNT(*)::int AS play_count, a.thumbnail
        FROM plays p
        LEFT JOIN albums a ON a.artist = p.artist AND a.name = p.album
        GROUP BY p.artist, p.album, a.thumbnail
        ORDER BY play_count DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT artist, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY artist
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
      pool.query(`
        SELECT
          COUNT(*)::int AS total_plays,
          COUNT(DISTINCT artist)::int AS unique_artists,
          COUNT(DISTINCT (artist, album))::int AS unique_albums,
          COUNT(DISTINCT (artist, album, song))::int AS unique_songs,
          COUNT(DISTINCT username)::int AS active_listeners
        FROM plays
      `),
      pool.query(`
        SELECT DATE(played_at) AS date, COUNT(*)::int AS count
        FROM plays
        GROUP BY DATE(played_at)
        ORDER BY date
      `),
      pool.query(`
        SELECT
          EXTRACT(DOW FROM played_at)::int AS dow,
          EXTRACT(HOUR FROM played_at)::int AS hour,
          COUNT(*)::int AS count
        FROM plays
        GROUP BY dow, hour
      `),
      pool.query(`
        SELECT DISTINCT DATE(played_at) AS date
        FROM plays
        ORDER BY date
      `),
      pool.query(`
        SELECT DATE(played_at) AS date, COUNT(*)::int AS count
        FROM plays
        GROUP BY DATE(played_at)
        ORDER BY count DESC
        LIMIT 1
      `),
      pool.query(`
        SELECT MIN(played_at) AS first_play
        FROM plays
      `),
    ]);

    // Compute streaks from sorted distinct dates
    const dates = streakDates.rows.map((r: { date: string }) => r.date);
    let currentStreak = 0;
    let longestStreak = 0;

    if (dates.length > 0) {
      // Longest streak
      let streak = 1;
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (Math.round(diffDays) === 1) {
          streak++;
        } else {
          if (streak > longestStreak) longestStreak = streak;
          streak = 1;
        }
      }
      if (streak > longestStreak) longestStreak = streak;

      // Current streak (counting back from today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastDate = new Date(dates[dates.length - 1]);
      lastDate.setHours(0, 0, 0, 0);
      const diffFromToday = (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diffFromToday <= 1) {
        currentStreak = 1;
        for (let i = dates.length - 2; i >= 0; i--) {
          const curr = new Date(dates[i + 1]);
          const prev = new Date(dates[i]);
          const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
          if (Math.round(diff) === 1) {
            currentStreak++;
          } else {
            break;
          }
        }
      }
    }

    return NextResponse.json({
      topSongs: topSongs.rows,
      topAlbums: topAlbums.rows,
      topArtists: topArtists.rows,
      topListeners: topListeners.rows,
      recentPlays: recentPlays.rows,
      summary: summary.rows[0],
      dailyPlays: dailyPlays.rows,
      hourlyHeatmap: hourlyHeatmap.rows,
      streaks: {
        current: currentStreak,
        longest: longestStreak,
      },
      mostActiveDay: mostActiveDay.rows[0] || null,
      firstPlay: firstPlay.rows[0]?.first_play || null,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
