import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  GENERATOR_VERSION, generateCourse, gradeFor, parMsOf, ratioFor,
  type Onset, type TrackFeatures,
} from '@/lib/groove';

export const dynamic = 'force-dynamic';

/**
 * Runs, and the leaderboard built from them.
 *
 * Every row is stamped with the generator version it was set against, and
 * every read filters on the CURRENT version — so revising the course generator
 * retires the old board rather than silently re-labelling it. Old rows stay:
 * they're still true about the course they were set on.
 */

interface BestRow {
  artist: string; album: string; song: string;
  time_ms: number; par_ms: number; finished: boolean;
  distance: number; course_len: number;
  crashes: number; air_ms: number; flips: number; style: number;
  played_at: string; runs: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artist = url.searchParams.get('artist');
  const album = url.searchParams.get('album');

  const filters = ['generator_version = $1'];
  const params: (string | number)[] = [GENERATOR_VERSION];
  if (artist) { params.push(artist); filters.push(`artist = $${params.length}`); }
  if (album) { params.push(album); filters.push(`album = $${params.length}`); }

  try {
    // One row per song: the best run, plus how many times it's been ridden.
    // A finished run always beats an unfinished one, however quick.
    const { rows } = await pool.query<BestRow>(
      `SELECT DISTINCT ON (artist, album, song)
              artist, album, song, time_ms, par_ms, finished,
              distance, course_len, crashes, air_ms, flips, style,
              played_at::text,
              COUNT(*) OVER (PARTITION BY artist, album, song)::text AS runs
         FROM groove_scores
        WHERE ${filters.join(' AND ')}
        ORDER BY artist, album, song, finished DESC, time_ms ASC`,
      params
    );

    const best = rows.map(r => {
      const ratio = ratioFor(r.par_ms, r.time_ms, r.finished);
      return {
        artist: r.artist, album: r.album, song: r.song,
        timeMs: r.time_ms, parMs: r.par_ms, finished: r.finished,
        ratio, grade: gradeFor(ratio),
        distance: r.distance, courseLength: r.course_len,
        crashes: r.crashes, airMs: r.air_ms, flips: r.flips, style: r.style,
        playedAt: r.played_at, runs: Number(r.runs),
      };
    });

    return NextResponse.json({ generatorVersion: GENERATOR_VERSION, best });
  } catch (error) {
    console.error('groove: score fetch failed', error);
    return NextResponse.json({ generatorVersion: GENERATOR_VERSION, best: [] }, { status: 500 });
  }
}

interface Row {
  frame_rate: number; duration: number;
  intensity: number[]; bass: number[]; mid: number[]; treble: number[];
  onsets: Onset[]; rideability: number;
}

export async function POST(request: Request) {
  let body: {
    artist?: string; album?: string; song?: string; player?: string;
    timeMs?: number; finished?: boolean; distance?: number;
    crashes?: number; airMs?: number; flips?: number; style?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 });
  }

  const { artist, album, song } = body;
  if (!artist || !album || !song) {
    return NextResponse.json({ error: 'artist, album and song are all required' }, { status: 400 });
  }
  const timeMs = Math.max(0, Math.round(Number(body.timeMs ?? 0)));
  if (!Number.isFinite(timeMs)) {
    return NextResponse.json({ error: 'timeMs must be a number' }, { status: 400 });
  }

  try {
    // Rebuild the course from the cached analysis to get par and its length.
    // The client knows both, but par is the denominator of every grade on the
    // board, so it isn't the client's to report.
    const { rows } = await pool.query<Row>(
      `SELECT frame_rate, duration, intensity, bass, mid, treble, onsets, rideability
         FROM groove_tracks WHERE artist = $1 AND album = $2 AND song = $3`,
      [artist, album, song]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'that song has not been analysed yet' }, { status: 409 });
    }

    const r = rows[0];
    const features: TrackFeatures = {
      frameRate: r.frame_rate, duration: r.duration,
      intensity: r.intensity, bass: r.bass, mid: r.mid, treble: r.treble,
      onsets: r.onsets, rideability: r.rideability,
    };
    const course = generateCourse(features);
    const parMs = parMsOf(course);
    const finished = Boolean(body.finished);
    const distance = Math.max(0, Math.min(Math.round(body.distance ?? 0), Math.round(course.length)));

    await pool.query(
      `INSERT INTO groove_scores
         (artist, album, song, generator_version, player,
          time_ms, par_ms, finished, distance, course_len, crashes, air_ms, flips, style)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        artist, album, song, GENERATOR_VERSION, body.player?.slice(0, 40) || 'anon',
        timeMs, parMs, finished,
        finished ? Math.round(course.length) : distance, Math.round(course.length),
        Math.max(0, Math.round(body.crashes ?? 0)),
        Math.max(0, Math.round(body.airMs ?? 0)),
        Math.max(0, Math.round(body.flips ?? 0)),
        Math.max(0, Math.round(body.style ?? 0)),
      ]
    );

    const ratio = ratioFor(parMs, timeMs, finished);
    return NextResponse.json({
      ok: true, parMs, ratio, grade: gradeFor(ratio),
      generatorVersion: GENERATOR_VERSION,
    });
  } catch (error) {
    console.error('groove: score write failed', error);
    return NextResponse.json({ error: 'could not record the run' }, { status: 500 });
  }
}
