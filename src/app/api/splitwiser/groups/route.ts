import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { generateToken, getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';
import { shapeGroupSummaries } from '@/lib/splitwiser';

export const dynamic = 'force-dynamic';

// GET — groups the current user is a member of
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { rows } = await pool.query(
    `WITH my_groups AS (
       SELECT g.*, gm.joined_at
       FROM splitwiser_groups g
       JOIN splitwiser_group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND gm.removed_at IS NULL
     ),
     paid AS (
       SELECT e.group_id, SUM(e.total_cents)::bigint AS total
       FROM splitwiser_expenses e
       JOIN my_groups mg ON mg.id = e.group_id
       WHERE e.paid_by = $1 AND e.deleted_at IS NULL
       GROUP BY e.group_id
     ),
     shares AS (
       SELECT e.group_id, SUM(s.share_cents)::bigint AS total
       FROM splitwiser_expense_shares s
       JOIN splitwiser_expenses e ON e.id = s.expense_id
       JOIN my_groups mg ON mg.id = e.group_id
       WHERE s.user_id = $1 AND e.deleted_at IS NULL
       GROUP BY e.group_id
     ),
     payment_out AS (
       SELECT p.group_id, SUM(p.amount_cents)::bigint AS total
       FROM splitwiser_payments p
       JOIN my_groups mg ON mg.id = p.group_id
       WHERE p.from_user = $1
       GROUP BY p.group_id
     ),
     payment_in AS (
       SELECT p.group_id, SUM(p.amount_cents)::bigint AS total
       FROM splitwiser_payments p
       JOIN my_groups mg ON mg.id = p.group_id
       WHERE p.to_user = $1
       GROUP BY p.group_id
     )
     SELECT mg.*,
       (COALESCE(paid.total, 0)
        - COALESCE(shares.total, 0)
        + COALESCE(payment_out.total, 0)
        - COALESCE(payment_in.total, 0))::bigint AS balance_cents
     FROM my_groups mg
     LEFT JOIN paid ON paid.group_id = mg.id
     LEFT JOIN shares ON shares.group_id = mg.id
     LEFT JOIN payment_out ON payment_out.group_id = mg.id
     LEFT JOIN payment_in ON payment_in.group_id = mg.id
     ORDER BY mg.archived_at NULLS FIRST, mg.created_at DESC`,
    [me.id],
  );
  return NextResponse.json({ groups: shapeGroupSummaries(rows) });
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
