import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { Onset, TrackFeatures } from '@/lib/groove';

export const dynamic = 'force-dynamic';

/**
 * The analysis cache. Sweeping a song's spectrum takes a couple of seconds of
 * solid maths in the browser, and the answer never changes for a given file —
 * so the first person to ride a track pays for it and nobody else does.
 *
 * Deliberately NOT keyed on generator version: what's stored here are
 * measurements of the audio, not opinions about what makes a good track. The
 * generator can be rewritten as often as we like without re-analysing a
 * library.
 */

interface Row {
  frame_rate: number;
  duration: number;
  intensity: number[];
  bass: number[];
  mid: number[];
  treble: number[];
  onsets: Onset[];
  rideability: number;
}

function keyOf(url: URL) {
  const artist = url.searchParams.get('artist');
  const album = url.searchParams.get('album');
  const song = url.searchParams.get('song');
  return artist && album && song ? { artist, album, song } : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = keyOf(url);

  // Album-level query: just the summary, so the sleeve can say which sides
  // have something to ride without hauling four float arrays per track over
  // the wire.
  if (!key) {
    const artist = url.searchParams.get('artist');
    const album = url.searchParams.get('album');
    if (!artist || !album) {
      return NextResponse.json({ error: 'artist and album are required' }, { status: 400 });
    }
    try {
      const { rows } = await pool.query<{ song: string; rideability: number; duration: number }>(
        `SELECT song, rideability, duration FROM groove_tracks WHERE artist = $1 AND album = $2`,
        [artist, album]
      );
      return NextResponse.json({ analysed: rows });
    } catch (error) {
      console.error('groove: album summary failed', error);
      return NextResponse.json({ analysed: [] }, { status: 500 });
    }
  }

  try {
    const { rows } = await pool.query<Row>(
      `SELECT frame_rate, duration, intensity, bass, mid, treble, onsets, rideability
         FROM groove_tracks WHERE artist = $1 AND album = $2 AND song = $3`,
      [key.artist, key.album, key.song]
    );
    if (rows.length === 0) return NextResponse.json({ features: null });

    const r = rows[0];
    const features: TrackFeatures = {
      frameRate: r.frame_rate,
      duration: r.duration,
      intensity: r.intensity,
      bass: r.bass,
      mid: r.mid,
      treble: r.treble,
      onsets: r.onsets,
      rideability: r.rideability,
    };
    return NextResponse.json({ features });
  } catch (error) {
    console.error('groove: track fetch failed', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { artist?: string; album?: string; song?: string; features?: TrackFeatures };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 });
  }

  const { artist, album, song, features } = body;
  if (!artist || !album || !song || !features) {
    return NextResponse.json({ error: 'artist, album, song and features are all required' }, { status: 400 });
  }

  const series = [features.intensity, features.bass, features.mid, features.treble];
  if (
    !Number.isFinite(features.frameRate) || features.frameRate <= 0 ||
    !Number.isFinite(features.duration) || features.duration <= 0 ||
    !series.every(s => Array.isArray(s) && s.length > 0) ||
    !Array.isArray(features.onsets)
  ) {
    return NextResponse.json({ error: 'features are incomplete' }, { status: 400 });
  }

  try {
    await pool.query(
      `INSERT INTO groove_tracks
         (artist, album, song, frame_rate, duration, intensity, bass, mid, treble, onsets, rideability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (artist, album, song) DO UPDATE SET
         frame_rate = EXCLUDED.frame_rate, duration = EXCLUDED.duration,
         intensity = EXCLUDED.intensity, bass = EXCLUDED.bass,
         mid = EXCLUDED.mid, treble = EXCLUDED.treble,
         onsets = EXCLUDED.onsets, rideability = EXCLUDED.rideability,
         analysed_at = now()`,
      [
        artist, album, song, features.frameRate, features.duration,
        features.intensity, features.bass, features.mid, features.treble,
        JSON.stringify(features.onsets), features.rideability ?? 0,
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('groove: track cache write failed', error);
    return NextResponse.json({ error: 'could not cache analysis' }, { status: 500 });
  }
}
