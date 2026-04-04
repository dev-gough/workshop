import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const challengeRows = await pool.query(
      `SELECT c.challenge_id, c.name, c.description, c.short_description, c.category, c.state, c.thresholds, c.tags,
              p.level, p.value, p.percentile, p.achieved_time, p.position, p.players_in_level
       FROM challenge_configs c
       LEFT JOIN challenge_progress p ON p.challenge_id = c.challenge_id
       WHERE c.state = 'ENABLED'
       ORDER BY c.category, c.name`
    );

    const syncRow = await pool.query(
      `SELECT last_synced_at, details FROM sync_metadata WHERE key = 'challenges'`
    );

    const meta = syncRow.rows[0] || { last_synced_at: null, details: {} };

    return NextResponse.json({
      lastSyncedAt: meta.last_synced_at,
      totalPoints: meta.details?.totalPoints || null,
      categoryPoints: meta.details?.categoryPoints || null,
      challenges: challengeRows.rows,
    });
  } catch (error) {
    console.error('Error fetching challenges:', error);
    return NextResponse.json({ error: 'Failed to fetch challenges' }, { status: 500 });
  }
}
