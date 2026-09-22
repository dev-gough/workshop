import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireSetupToken } from '@/lib/admin-auth';
import { slskdDelete } from '@/lib/slskd';
import { transferCancelPath } from '@/lib/soulseek-transfers';

export const dynamic = 'force-dynamic';

const PAGE_SIZES = [25, 50, 100];

/**
 * Paginated log of every transfer ever recorded, both wires merged.
 * ?direction=all|down|up  ?status=all|completed|queued|rejected|failed
 * ?q=<username/filename/artist/album substring>  ?page=0  ?pageSize=25|50|100
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const direction = searchParams.get('direction') || 'all';
    const status = searchParams.get('status') || 'all';
    const rawQ = (searchParams.get('q') || '').trim();
    // Escape ILIKE wildcards so a literal search for "100%" behaves.
    const q = rawQ.replace(/[\\%_]/g, '\\$&');
    const page = Math.max(parseInt(searchParams.get('page') || '0') || 0, 0);
    const requestedSize = parseInt(searchParams.get('pageSize') || '25') || 25;
    const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : 25;

    const { rows } = await pool.query(
      `WITH log AS (
        SELECT id, 'down' AS direction, username, filename, artist, album,
               size_bytes, speed_bytes_per_sec, status, created_at, completed_at
        FROM soulseek_downloads
        UNION ALL
        SELECT id, 'up' AS direction, username, filename, artist, album,
               size_bytes, speed_bytes_per_sec, status, created_at, completed_at
        FROM soulseek_uploads
      )
      SELECT *, COUNT(*) OVER() AS total_count FROM log
      WHERE ($1 = 'all' OR direction = $1)
        AND ($2 = 'all' OR status = $2)
        AND ($3 = '' OR username ILIKE '%' || $3 || '%' OR filename ILIKE '%' || $3 || '%'
             OR artist ILIKE '%' || $3 || '%' OR album ILIKE '%' || $3 || '%')
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
      [direction, status, q, pageSize, page * pageSize]
    );

    let total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
    if (rows.length === 0 && page > 0) {
      // Page ran past the end (e.g. filters shrank the set) — still report
      // the real total so the client can clamp back to a valid page.
      const count = await pool.query(
        `WITH log AS (
          SELECT 'down' AS direction, username, filename, artist, album, status FROM soulseek_downloads
          UNION ALL
          SELECT 'up', username, filename, artist, album, status FROM soulseek_uploads
        )
        SELECT COUNT(*) AS n FROM log
        WHERE ($1 = 'all' OR direction = $1)
          AND ($2 = 'all' OR status = $2)
          AND ($3 = '' OR username ILIKE '%' || $3 || '%' OR filename ILIKE '%' || $3 || '%'
               OR artist ILIKE '%' || $3 || '%' OR album ILIKE '%' || $3 || '%')`,
        [direction, status, q]
      );
      total = parseInt(count.rows[0].n);
    }
    return NextResponse.json({
      transfers: rows.map(({ total_count, ...transfer }) => {
        void total_count;
        return transfer;
      }),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch transfer log', detail: String(error) }, { status: 500 });
  }
}

/** Cancel a live transfer in slskd. */
export async function DELETE(request: NextRequest) {
  const authError = requireSetupToken(request);
  if (authError) return authError;

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Transfer details required' }, { status: 400 });
    }

    const { direction, username, id } = body as Record<string, unknown>;
    if (
      (direction !== 'down' && direction !== 'up')
      || typeof username !== 'string'
      || !username.trim()
      || typeof id !== 'string'
      || !id
    ) {
      return NextResponse.json(
        { error: 'direction, username, and id are required' },
        { status: 400 },
      );
    }

    await slskdDelete(transferCancelPath(direction, username, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to cancel transfer', detail: String(error) },
      { status: 500 },
    );
  }
}
