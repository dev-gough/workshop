import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { generateToken, getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// POST — replace the group's invite_token with a freshly generated one.
export async function POST(
  _request: NextRequest,
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

  const newToken = generateToken();
  const { rows } = await pool.query(
    `UPDATE splitwiser_groups SET invite_token = $1 WHERE id = $2 RETURNING invite_token`,
    [newToken, groupId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ invite_token: rows[0].invite_token });
}
