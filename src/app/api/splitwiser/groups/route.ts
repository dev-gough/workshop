import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { generateToken, getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// GET — groups the current user is a member of
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { rows } = await pool.query(
    `SELECT g.*, gm.joined_at
     FROM splitwiser_groups g
     JOIN splitwiser_group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1 AND gm.removed_at IS NULL
     ORDER BY g.archived_at NULLS FIRST, g.created_at DESC`,
    [me.id],
  );
  return NextResponse.json({ groups: rows });
}

// POST — create a new group, current user becomes the first member
export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  try {
    const body = await request.json();
    const { name } = body as { name?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 80) {
      return NextResponse.json({ error: 'name required (1-80 chars)' }, { status: 400 });
    }

    const inviteToken = generateToken();
    const { rows } = await pool.query(
      `INSERT INTO splitwiser_groups (name, invite_token, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), inviteToken, me.id],
    );
    const group = rows[0];

    await pool.query(
      `INSERT INTO splitwiser_group_members (group_id, user_id) VALUES ($1, $2)`,
      [group.id, me.id],
    );

    return NextResponse.json({ group });
  } catch (error) {
    return NextResponse.json({ error: 'create failed', detail: String(error) }, { status: 500 });
  }
}
