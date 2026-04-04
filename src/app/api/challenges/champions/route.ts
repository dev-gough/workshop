import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — returns completed champions for a challenge (or all per-champion challenges)
export async function GET(request: NextRequest) {
  const challengeId = request.nextUrl.searchParams.get('challengeId');

  try {
    if (challengeId) {
      const { rows } = await pool.query(
        `SELECT champion_id, champion_name, completed, synced_at
         FROM challenge_champion_progress
         WHERE challenge_id = $1
         ORDER BY champion_name`,
        [challengeId]
      );
      return NextResponse.json(rows);
    } else {
      // Return summary: per challenge_id, count of completed champions
      const { rows } = await pool.query(
        `SELECT challenge_id, COUNT(*)::int AS completed_count,
                array_agg(champion_name ORDER BY champion_name) AS champions
         FROM challenge_champion_progress
         WHERE completed = true
         GROUP BY challenge_id`
      );
      return NextResponse.json(rows);
    }
  } catch (error) {
    console.error('Error fetching champion progress:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// POST — receives per-champion completion data from the overlay
// Body: { challengeId: number, champions: [{ id: number, name: string, completed: boolean }] }
// Or bulk: { data: [{ challengeId: number, champions: [{ id, name, completed }] }] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const entries: { challengeId: number; champions: { id: number; name: string; completed: boolean }[] }[] = [];

    if (body.data) {
      entries.push(...body.data);
    } else if (body.challengeId && body.champions) {
      entries.push(body);
    } else {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    let upserted = 0;
    for (const entry of entries) {
      for (const champ of entry.champions) {
        await pool.query(
          `INSERT INTO challenge_champion_progress (challenge_id, champion_id, champion_name, completed, synced_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (challenge_id, champion_id) DO UPDATE SET
             champion_name = $3, completed = $4, synced_at = now()`,
          [entry.challengeId, champ.id, champ.name, champ.completed]
        );
        upserted++;
      }
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (error) {
    console.error('Error saving champion progress:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
