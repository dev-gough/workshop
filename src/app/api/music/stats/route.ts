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
      weeklyEras,
      sessionRecords,
      biggestBinge,
      frontToBack,
      listenerProfiles,
    ] = await Promise.all([
      pool.query(`
        SELECT artist, album, song, COUNT(*)::int AS play_count
        FROM plays
        GROUP BY artist, album, song
        ORDER BY play_count DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT p.artist, p.album, COUNT(*)::int AS play_count,
               CASE WHEN a.cover_path IS NOT NULL THEN '/api/music/cover/' || a.id END AS "coverUrl"
        FROM plays p
        LEFT JOIN albums a ON a.artist = p.artist AND a.name = p.album
        GROUP BY p.artist, p.album, a.id, a.cover_path
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
      // The eras: weekly plays, split into the all-time top-5 artists and
      // everything else — the raw material for the era streamgraph.
      pool.query(`
        WITH top5 AS (
          SELECT artist FROM plays GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 5
        )
        SELECT
          date_trunc('week', played_at)::date AS week,
          CASE WHEN artist IN (SELECT artist FROM top5) THEN artist ELSE '__other' END AS artist,
          COUNT(*)::int AS count
        FROM plays
        GROUP BY week, 2
        ORDER BY week
      `),
      // Sittings: one listener's plays with no half-hour silence between
      // them. Longest by songs, plus the house totals.
      pool.query(`
        WITH marked AS (
          SELECT username, played_at,
            CASE WHEN played_at - LAG(played_at) OVER (PARTITION BY username ORDER BY played_at) > interval '30 minutes'
                 OR LAG(played_at) OVER (PARTITION BY username ORDER BY played_at) IS NULL THEN 1 ELSE 0 END AS new_s
          FROM plays
        ), sess AS (
          SELECT username, played_at,
            SUM(new_s) OVER (PARTITION BY username ORDER BY played_at) AS sid
          FROM marked
        ), grouped AS (
          SELECT username, sid, COUNT(*)::int AS songs,
            MIN(played_at) AS started_at,
            ROUND(EXTRACT(EPOCH FROM MAX(played_at) - MIN(played_at)) / 3600.0, 1)::float AS hours
          FROM sess GROUP BY username, sid
        )
        SELECT
          (SELECT COUNT(*)::int FROM grouped) AS total_sittings,
          (SELECT ROUND(AVG(songs))::int FROM grouped) AS avg_songs,
          username, songs, started_at, hours
        FROM grouped
        ORDER BY songs DESC
        LIMIT 1
      `),
      pool.query(`
        SELECT username, artist, album, song, DATE(played_at) AS date, COUNT(*)::int AS count
        FROM plays
        GROUP BY username, artist, album, song, DATE(played_at)
        ORDER BY count DESC, date DESC
        LIMIT 1
      `),
      // Front to back: how much of each album's track list has ever hit
      // the platter. Only albums still on the shelf (join) and long
      // enough to mean something.
      pool.query(`
        SELECT p.artist, p.album,
          COUNT(DISTINCT p.song)::int AS played_tracks,
          COUNT(*)::int AS plays,
          array_length(a.songs, 1) AS total_tracks,
          CASE WHEN a.cover_path IS NOT NULL THEN '/api/music/cover/' || a.id END AS "coverUrl"
        FROM plays p
        JOIN albums a ON a.artist = p.artist AND a.name = p.album
        WHERE array_length(a.songs, 1) >= 5
        GROUP BY p.artist, p.album, a.id, a.cover_path
        ORDER BY COUNT(DISTINCT p.song) DESC, COUNT(*) DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT p.username,
          COUNT(*)::int AS plays,
          COUNT(DISTINCT DATE(p.played_at))::int AS days_active,
          MIN(p.played_at) AS first_play,
          (SELECT p2.artist FROM plays p2 WHERE p2.username = p.username
            GROUP BY p2.artist ORDER BY COUNT(*) DESC LIMIT 1) AS top_artist,
          (SELECT EXTRACT(HOUR FROM p3.played_at)::int FROM plays p3 WHERE p3.username = p.username
            GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1) AS peak_hour
        FROM plays p
        GROUP BY p.username
        ORDER BY plays DESC
        LIMIT 6
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
      weeklyEras: weeklyEras.rows,
      records: {
        longestSitting: sessionRecords.rows[0]
          ? {
              username: sessionRecords.rows[0].username,
              songs: sessionRecords.rows[0].songs,
              startedAt: sessionRecords.rows[0].started_at,
              hours: sessionRecords.rows[0].hours,
            }
          : null,
        totalSittings: sessionRecords.rows[0]?.total_sittings ?? 0,
        avgSittingSongs: sessionRecords.rows[0]?.avg_songs ?? 0,
        biggestBinge: biggestBinge.rows[0] || null,
      },
      frontToBack: frontToBack.rows,
      listenerProfiles: listenerProfiles.rows,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
