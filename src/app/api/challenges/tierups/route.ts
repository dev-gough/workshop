import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Bounds the payload when someone comes back after a long break. */
const MAX_EVENTS = 60;

interface Row {
  at: string;
  match_id: string | null;
  champion: string | null;
  challenge_id: string | null;
  name: string | null;
  old_level: string | null;
  new_level: string | null;
  new_value: string | null;
}

/**
 * Tier-up events — the moments a challenge crossed a tier boundary.
 *
 * There is no tier-up table; like `/history`, this is reconstructed from the
 * deltas the poller attributes to each tracked match. A delta whose old_level
 * differs from its new_level IS the event, and the match's `game_creation` is
 * its timestamp.
 *
 * `since` is a millisecond epoch watermark — pass the newest timestamp you have
 * already celebrated and you get only what has happened since. Omit it and you
 * get no events at all, just `newest`: that is the first-visit case, where the
 * caller wants to seed its watermark rather than replay the whole account
 * history in confetti.
 *
 * `newest` is the newest tracked game overall, not the newest returned event —
 * the watermark has to advance past quiet games too, or every poll would
 * re-scan the same window.
 */
export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get('since');
    const since = raw === null ? null : Number(raw);
    if (raw !== null && !Number.isFinite(since)) {
      return NextResponse.json({ error: 'since must be a millisecond epoch' }, { status: 400 });
    }

    const newestRow = await pool.query<{ newest: string | null }>(
      `SELECT MAX(game_creation)::text AS newest FROM challenge_games`
    );
    const newest = Number(newestRow.rows[0]?.newest ?? 0) || null;

    if (since === null) return NextResponse.json({ newest, events: [] });

    const { rows } = await pool.query<Row>(
      `SELECT g.game_creation::text AS at,
              g.match_id,
              g.champion,
              d->>'challenge_id' AS challenge_id,
              d->>'name'         AS name,
              d->>'old_level'    AS old_level,
              d->>'new_level'    AS new_level,
              d->>'new_value'    AS new_value
         FROM challenge_games g,
              LATERAL jsonb_array_elements(g.deltas) d
        WHERE g.game_creation > $1
          AND d->>'new_level' IS NOT NULL
          AND d->>'old_level' IS DISTINCT FROM d->>'new_level'
        ORDER BY g.game_creation DESC
        LIMIT $2`,
      [since, MAX_EVENTS]
    );

    const events = rows
      .filter((r) => r.challenge_id && Number.isFinite(Number(r.at)))
      .map((r) => ({
        challengeId: Number(r.challenge_id),
        name: r.name ?? '',
        oldLevel: r.old_level || 'NONE',
        newLevel: r.new_level as string,
        newValue: Number(r.new_value) || 0,
        at: Number(r.at),
        matchId: r.match_id,
        champion: r.champion,
      }));

    return NextResponse.json({ newest, events });
  } catch (error) {
    console.error('Error fetching tier-ups:', error);
    return NextResponse.json({ error: 'Failed to fetch tier-ups' }, { status: 500 });
  }
}
