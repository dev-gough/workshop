import { NextRequest, NextResponse } from 'next/server';
import { removeTorrent } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { id, hash, deleteData } = await request.json();
    if (typeof id !== 'number') {
      return NextResponse.json({ error: 'id (transmission id) required' }, { status: 400 });
    }

    await removeTorrent(id, !!deleteData);

    if (typeof hash === 'string' && hash.length > 0) {
      await pool.query(
        `UPDATE jellyfin_torrents SET status = 'removed' WHERE hash = $1`,
        [hash.toLowerCase()],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Remove failed', detail: String(error) },
      { status: 500 },
    );
  }
}
