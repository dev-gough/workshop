import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Per-challenge value history.
 *
 * There is no history table — the trail is reconstructed from the deltas the
 * poller attributes to each tracked match. That has two consequences worth
 * knowing before trusting a chart built on it:
 *
 *  - Coverage is partial. Only challenges that moved while the poller was
 *    running appear at all (~171 of ~450), and the record starts when match
 *    tracking did, not when the account did.
 *  - Timestamps are the match's, and a batch of matches discovered in one
 *    poll has its deltas attributed to the most recent one. Points are
 *    therefore accurate to the game, not to the minute.
 *
 * Returned as a whole map rather than per-challenge: the entire history is a
 * few thousand points, so one request beats a fetch per hovered token.
 */
export async function GET() {
  try {
    const { rows } = await pool.query<{ t: string; id: string; v: string | null }>(
      `SELECT g.game_creation AS t,
              d->>'challenge_id' AS id,
              d->>'new_value'    AS v
         FROM challenge_games g,
              LATERAL jsonb_array_elements(g.deltas) d
        WHERE jsonb_array_length(g.deltas) > 0
        ORDER BY g.game_creation`
    );

    // [timestampMs, value][] per challenge id, already in chronological order.
    const series: Record<string, [number, number][]> = {};
    for (const r of rows) {
      const t = Number(r.t);
      const v = Number(r.v);
      if (!r.id || !Number.isFinite(t) || !Number.isFinite(v)) continue;
      (series[r.id] ??= []).push([t, v]);
    }

    return NextResponse.json({ series });
  } catch (error) {
    console.error('Error fetching challenge history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
