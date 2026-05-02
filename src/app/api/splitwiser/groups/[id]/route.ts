import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// GET — group meta + members. Expenses and balances are added in phase 3.
export async function GET(
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

  const { rows: groupRows } = await pool.query(
    `SELECT * FROM splitwiser_groups WHERE id = $1`,
    [groupId],
  );
  if (groupRows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Members — never expose login_token of other users.
  const { rows: members } = await pool.query(
    `SELECT u.id, u.name, u.color, u.created_by,
            (u.login_token IS NULL) AS is_ghost,
            gm.joined_at, gm.removed_at
     FROM splitwiser_group_members gm
     JOIN splitwiser_users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY u.id`,
    [groupId],
  );

  return NextResponse.json({ group: groupRows[0], members });
}
