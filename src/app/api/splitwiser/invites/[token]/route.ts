import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Public — returns only the group name so the join page can render
// "Join Camping 2026?" before signup. The token itself authorizes this.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { rows } = await pool.query(
    `SELECT id, name FROM splitwiser_groups
     WHERE invite_token = $1 AND invite_enabled = TRUE AND archived_at IS NULL`,
    [token],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'invalid invite' }, { status: 404 });
  }
  return NextResponse.json({ group: rows[0] });
}
