import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// The imagery review queue: kind-change proposals written by
// scripts/flag-imagery-kinds.ts, ranked most-confident-first. Undecided
// rows lead; decided ones trail (newest decisions first) so the tab shows
// a work queue with history under it.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const park = new URL(request.url).searchParams.get('park');
  if (!park) return NextResponse.json({ error: 'park required' }, { status: 400 });
  try {
    const { rows } = await pool.query(
      `SELECT id, seg_hint, before_kind, coords, pieces, evidence, status,
              created_at, decided_at
         FROM paddle_kind_overrides
        WHERE park = $1
        ORDER BY (status = 'proposed') DESC,
                 (evidence->>'confidence')::numeric DESC NULLS LAST,
                 decided_at DESC NULLS LAST, id`,
      [park],
    );
    return NextResponse.json({ reviews: rows });
  } catch (error) {
    console.error('paddle reviews error:', error);
    return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500 });
  }
}
