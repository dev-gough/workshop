import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { applyOverride, type OverrideRow } from '@/lib/paddle/overrides';

// Decide a review: approve applies the kind change to paddle_segments
// immediately (and the row re-applies itself after every re-ingest);
// reject/unclear just park the decision. Any status can be revisited —
// but un-approving does NOT revert an already-applied edit (the next
// re-ingest rebuilds without it).

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['proposed', 'approved', 'rejected', 'unclear']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status as string | undefined;
  if (!Number.isInteger(Number(id)) || !status || !STATUSES.has(status)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE paddle_kind_overrides
          SET status = $1, decided_at = CASE WHEN $1 = 'proposed' THEN NULL ELSE now() END
        WHERE id = $2
        RETURNING id, park, before_kind, coords, pieces, status`,
      [status, Number(id)],
    );
    if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

    let applied = null;
    if (status === 'approved') {
      applied = await applyOverride(pool, rows[0] as OverrideRow);
      if (applied.applied) {
        await pool.query(`UPDATE paddle_kind_overrides SET applied_at = now() WHERE id = $1`, [
          Number(id),
        ]);
      }
    }
    return NextResponse.json({ review: rows[0], applied });
  } catch (error) {
    console.error('paddle review decide error:', error);
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
  }
}
