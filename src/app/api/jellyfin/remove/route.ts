import { NextRequest, NextResponse } from 'next/server';
import { removeTorrent } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { id, deleteData } = await request.json();
    if (typeof id !== 'number') {
      return NextResponse.json({ error: 'id (transmission id) required' }, { status: 400 });
    }

    await removeTorrent(id, !!deleteData);

    // Match by transmission_id (precise) instead of hash. Two rows can share
    // a hash if the user cancelled and re-submitted the same magnet; the
    // hash-based update would clobber both.
    await pool.query(
      `UPDATE jellyfin_torrents SET status = 'removed'
       WHERE transmission_id = $1 AND status NOT IN ('removed', 'ingested')`,
      [id],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Remove failed', detail: String(error) },
      { status: 500 },
    );
  }
}
