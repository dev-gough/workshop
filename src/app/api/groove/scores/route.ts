import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  GENERATOR_VERSION, generateTrack, gradeFor, type Onset, type TrackFeatures,
} from '@/lib/groove';

export const dynamic = 'force-dynamic';

/**
 * Runs, and the leaderboard built from them.
 *
 * Every row is stamped with the generator version it was set against, and
 * every read filters on the CURRENT version — so revising the track generator
 * retires the old board rather than silently re-labelling it. Old rows stay:
 * they're still true about the track they were set on.
 */

interface BestRow {
  artist: string;
  album: string;
  song: string;
  score: string;
  max_score: string;
  notes_hit: number;
  notes_total: number;
  ramps_hit: number;
  ramps_total: number;
  best_combo: number;
  played_at: string;
  runs: string;
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
    const { rows } = await pool.query<BestRow>(
      `SELECT DISTINCT ON (artist, album, song)
              artist, album, song, score::text, max_score::text,
              notes_hit, notes_total, ramps_hit, ramps_total, best_combo,
              played_at::text,
              COUNT(*) OVER (PARTITION BY artist, album, song)::text AS runs
         FROM groove_scores
        WHERE ${filters.join(' AND ')}
        ORDER BY artist, album, song, score DESC`,
      params
    );

    const best = rows.map(r => {
      const score = Number(r.score);
      const maxScore = Number(r.max_score);
      const pct = maxScore > 0 ? score / maxScore : 0;
      return {
        artist: r.artist, album: r.album, song: r.song,
        score, maxScore, pct,
        grade: gradeFor(pct),
        notesHit: r.notes_hit, notesTotal: r.notes_total,
        rampsHit: r.ramps_hit, rampsTotal: r.ramps_total,
        bestCombo: r.best_combo,
        playedAt: r.played_at,
        runs: Number(r.runs),
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
    score?: number; notesHit?: number; notesTotal?: number;
    rampsHit?: number; rampsTotal?: number; bestCombo?: number;
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
  const score = Math.max(0, Math.round(Number(body.score ?? 0)));
  if (!Number.isFinite(score)) {
    return NextResponse.json({ error: 'score must be a number' }, { status: 400 });
  }

  try {
    // Rebuild the track from the cached analysis to get the perfect-play
    // total. The client knows this number too, but it's the denominator of
    // every percentage on the board, so it isn't the client's to report.
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
    const track = generateTrack(features);

    await pool.query(
      `INSERT INTO groove_scores
         (artist, album, song, generator_version, player, score, max_score,
          notes_hit, notes_total, ramps_hit, ramps_total, best_combo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        artist, album, song, GENERATOR_VERSION, body.player?.slice(0, 40) || 'anon',
        Math.min(score, track.maxScore), track.maxScore,
        Math.max(0, Math.round(body.notesHit ?? 0)), track.notes.length,
        Math.max(0, Math.round(body.rampsHit ?? 0)), track.ramps.length,
        Math.max(0, Math.round(body.bestCombo ?? 0)),
      ]
    );

    const pct = Math.min(score, track.maxScore) / track.maxScore;
    return NextResponse.json({
      ok: true, maxScore: track.maxScore, pct, grade: gradeFor(pct),
      generatorVersion: GENERATOR_VERSION,
    });
  } catch (error) {
    console.error('groove: score write failed', error);
    return NextResponse.json({ error: 'could not record the run' }, { status: 500 });
  }
}
