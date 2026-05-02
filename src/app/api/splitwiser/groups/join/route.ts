import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// POST — join a group using its invite_token. Idempotent.
export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  try {
    const { invite_token } = (await request.json()) as { invite_token?: unknown };
    if (typeof invite_token !== 'string' || invite_token.length === 0) {
      return NextResponse.json({ error: 'invite_token required' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT id, name FROM splitwiser_groups
       WHERE invite_token = $1 AND invite_enabled = TRUE AND archived_at IS NULL`,
      [invite_token],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'invalid or disabled invite' }, { status: 404 });
    }

    const group = rows[0];

    // If they were previously removed, restore them; otherwise insert new.
    await pool.query(
      `INSERT INTO splitwiser_group_members (group_id, user_id) VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO UPDATE
         SET removed_at = NULL, joined_at = COALESCE(splitwiser_group_members.joined_at, NOW())`,
      [group.id, me.id],
    );

    return NextResponse.json({ group });
  } catch (error) {
    return NextResponse.json({ error: 'join failed', detail: String(error) }, { status: 500 });
  }
}
