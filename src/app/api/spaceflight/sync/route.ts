import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { syncSpaceflight } from '@/lib/spaceflight/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Manual refresh from the room's console. The timer already syncs every 6h;
// this exists for launch days. Cooldown keeps us well inside Launch Library's
// 15 requests/hour free tier (each incremental sync is 2 requests).
const COOLDOWN_MS = 10 * 60 * 1000;

export async function POST() {
  try {
    const metaRow = await pool.query(
      `SELECT value FROM spaceflight_meta WHERE key = 'last_sync'`
    );
    if (metaRow.rows.length > 0) {
      const elapsed = Date.now() - new Date(metaRow.rows[0].value).getTime();
      if (elapsed < COOLDOWN_MS) {
        return NextResponse.json({
          synced: false,
          reason: 'cooldown',
          remainingSeconds: Math.ceil((COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }

    const { past, upcoming } = await syncSpaceflight(pool);
    return NextResponse.json({ synced: true, past, upcoming });
  } catch (error) {
    console.error('spaceflight sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
