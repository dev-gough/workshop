import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';
import { splitEqual } from '@/lib/splitwiser';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST — create an expense with an equal split across share_user_ids.
export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  try {
    const body = await request.json();
    const {
      group_id, description, total_cents, paid_by, occurred_on, share_user_ids, note,
    } = body as {
      group_id?: unknown; description?: unknown; total_cents?: unknown;
      paid_by?: unknown; occurred_on?: unknown; share_user_ids?: unknown; note?: unknown;
    };

    if (typeof group_id !== 'number' || !Number.isInteger(group_id)) {
      return NextResponse.json({ error: 'group_id required' }, { status: 400 });
    }
    if (typeof description !== 'string' || description.trim().length === 0 || description.length > 200) {
      return NextResponse.json({ error: 'description required (1-200 chars)' }, { status: 400 });
    }
    if (typeof total_cents !== 'number' || !Number.isInteger(total_cents) || total_cents <= 0) {
      return NextResponse.json({ error: 'total_cents must be a positive integer' }, { status: 400 });
    }
    if (typeof paid_by !== 'number' || !Number.isInteger(paid_by)) {
      return NextResponse.json({ error: 'paid_by required' }, { status: 400 });
    }
    if (typeof occurred_on !== 'string' || !DATE_RE.test(occurred_on)) {
      return NextResponse.json({ error: 'occurred_on must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!Array.isArray(share_user_ids) || share_user_ids.length === 0
        || !share_user_ids.every((x) => Number.isInteger(x))) {
      return NextResponse.json({ error: 'share_user_ids must be a non-empty integer array' }, { status: 400 });
    }
    const noteStr = typeof note === 'string' ? note.slice(0, 500) : null;

    if (!(await userIsInGroup(me.id, group_id))) {
      return NextResponse.json({ error: 'not a member of that group' }, { status: 403 });
    }

    // Verify paid_by + every share user is in the group
    const ids = Array.from(new Set([paid_by, ...share_user_ids]));
    const { rows: memberRows } = await pool.query(
      `SELECT user_id FROM splitwiser_group_members
       WHERE group_id = $1 AND removed_at IS NULL AND user_id = ANY($2::int[])`,
      [group_id, ids],
    );
    if (memberRows.length !== ids.length) {
      return NextResponse.json({ error: 'paid_by or share_user_ids includes non-members' }, { status: 400 });
    }

    const shares = splitEqual(total_cents, share_user_ids as number[]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: er } = await client.query(
        `INSERT INTO splitwiser_expenses
           (group_id, paid_by, description, total_cents, currency, occurred_on, note, created_by)
         VALUES ($1, $2, $3, $4, 'CAD', $5, $6, $7)
         RETURNING *`,
        [group_id, paid_by, description.trim(), total_cents, occurred_on, noteStr, me.id],
      );
      const expense = er[0];
      for (const s of shares) {
        await client.query(
          `INSERT INTO splitwiser_expense_shares (expense_id, user_id, share_cents) VALUES ($1, $2, $3)`,
          [expense.id, s.userId, s.shareCents],
        );
      }
      await client.query('COMMIT');
      return NextResponse.json({ expense, shares });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    return NextResponse.json({ error: 'create failed', detail: String(error) }, { status: 500 });
  }
}

// GET — list a group's expenses (newest first), or a specific expense via ?id=
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
    `SELECT e.*,
            COALESCE(json_agg(json_build_object('user_id', s.user_id, 'share_cents', s.share_cents))
                     FILTER (WHERE s.user_id IS NOT NULL), '[]') AS shares
     FROM splitwiser_expenses e
     LEFT JOIN splitwiser_expense_shares s ON s.expense_id = e.id
     WHERE e.group_id = $1 AND e.deleted_at IS NULL
     GROUP BY e.id
     ORDER BY e.occurred_on DESC, e.id DESC
     LIMIT $2`,
    [groupId, limit],
  );
  return NextResponse.json({ expenses: rows });
}
