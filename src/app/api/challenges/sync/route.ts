import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getConfig } from '@/lib/config';
import { syncChallenges } from '@/lib/challenges-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export async function POST() {
  try {
    // Check cooldown
    const syncRow = await pool.query(
      `SELECT last_synced_at FROM sync_metadata WHERE key = 'challenges'`
    );
    if (syncRow.rows.length > 0) {
      const lastSynced = new Date(syncRow.rows[0].last_synced_at).getTime();
      const elapsed = Date.now() - lastSynced;
      if (elapsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json({
          synced: false,
          reason: 'cooldown',
          remainingSeconds: remaining,
          lastSyncedAt: syncRow.rows[0].last_synced_at,
        });
      }
    }

    const riot = getConfig().riot;

    if (!riot?.apiKey || !riot?.gameName || !riot?.tagLine) {
      return NextResponse.json({ error: 'Riot API not configured' }, { status: 500 });
    }

    const { configCount, progressCount, thresholdUpdates } = await syncChallenges(pool, riot);

    return NextResponse.json({
      synced: true,
      configCount,
      progressCount,
      thresholdUpdates,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
