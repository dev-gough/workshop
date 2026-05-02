import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const GHOST_PALETTE = [
  '#22d3ee', '#fbbf24', '#a78bfa', '#f472b6',
  '#4ade80', '#38bdf8', '#fb7185', '#facc15',
];

// POST — create a ghost user (no login_token) and add them to the group.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { id } = await params;
  const groupId = parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: 'invalid group id' }, { status: 400 });
  }
  if (!(await userIsInGroup(me.id, groupId))) {
    return NextResponse.json({ error: 'not a member' }, { status: 403 });
  }

  try {
    const { name, color } = (await request.json()) as { name?: unknown; color?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 60) {
      return NextResponse.json({ error: 'name required (1-60 chars)' }, { status: 400 });
    }
    const finalColor = typeof color === 'string' && COLOR_RE.test(color)
      ? color
      : GHOST_PALETTE[Math.floor(Math.random() * GHOST_PALETTE.length)];

    const { rows: userRows } = await pool.query(
      `INSERT INTO splitwiser_users (name, color, login_token, created_by)
       VALUES ($1, $2, NULL, $3) RETURNING id, name, color, created_by`,
      [name.trim(), finalColor, me.id],
    );
    const ghost = userRows[0];

    await pool.query(
      `INSERT INTO splitwiser_group_members (group_id, user_id) VALUES ($1, $2)`,
      [groupId, ghost.id],
    );

    return NextResponse.json({ user: { ...ghost, is_ghost: true } });
  } catch (error) {
    return NextResponse.json({ error: 'add member failed', detail: String(error) }, { status: 500 });
  }
}
