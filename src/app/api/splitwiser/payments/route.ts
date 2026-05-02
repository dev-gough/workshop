import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST — record a settle-up payment between two members of a group.
export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  try {
    const body = await request.json();
    const { group_id, from_user, to_user, amount_cents, occurred_on, note } = body as {
      group_id?: unknown; from_user?: unknown; to_user?: unknown;
      amount_cents?: unknown; occurred_on?: unknown; note?: unknown;
    };

    if (typeof group_id !== 'number' || !Number.isInteger(group_id)) {
      return NextResponse.json({ error: 'group_id required' }, { status: 400 });
    }
    if (typeof from_user !== 'number' || typeof to_user !== 'number'
        || from_user === to_user) {
      return NextResponse.json({ error: 'from_user and to_user must differ' }, { status: 400 });
    }
    if (typeof amount_cents !== 'number' || !Number.isInteger(amount_cents) || amount_cents <= 0) {
      return NextResponse.json({ error: 'amount_cents must be a positive integer' }, { status: 400 });
    }
    if (typeof occurred_on !== 'string' || !DATE_RE.test(occurred_on)) {
      return NextResponse.json({ error: 'occurred_on must be YYYY-MM-DD' }, { status: 400 });
    }
    const noteStr = typeof note === 'string' ? note.slice(0, 500) : null;

    if (!(await userIsInGroup(me.id, group_id))) {
      return NextResponse.json({ error: 'not a member of that group' }, { status: 403 });
    }

    const { rows: memberRows } = await pool.query(
      `SELECT user_id FROM splitwiser_group_members
       WHERE group_id = $1 AND removed_at IS NULL AND user_id = ANY($2::int[])`,
      [group_id, [from_user, to_user]],
    );
    if (memberRows.length !== 2) {
      return NextResponse.json({ error: 'from_user or to_user not in group' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `INSERT INTO splitwiser_payments
         (group_id, from_user, to_user, amount_cents, currency, occurred_on, note, created_by)
       VALUES ($1, $2, $3, $4, 'CAD', $5, $6, $7) RETURNING *`,
      [group_id, from_user, to_user, amount_cents, occurred_on, noteStr, me.id],
    );
    return NextResponse.json({ payment: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: 'create failed', detail: String(error) }, { status: 500 });
  }
}

// GET — list a group's payments
export async function GET(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const groupIdRaw = request.nextUrl.searchParams.get('group_id');
  const groupId = groupIdRaw ? parseInt(groupIdRaw, 10) : NaN;
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: 'group_id required' }, { status: 400 });
  }
  if (!(await userIsInGroup(me.id, groupId))) {
    return NextResponse.json({ error: 'not a member' }, { status: 403 });
  }
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 200);

  const { rows } = await pool.query(
    `SELECT * FROM splitwiser_payments WHERE group_id = $1
     ORDER BY occurred_on DESC, id DESC LIMIT $2`,
    [groupId, limit],
  );
  return NextResponse.json({ payments: rows });
}
