import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// GET — per-member balance in cents.
// balance(U) = paid_by(U) − shares(U) + payments_from(U) − payments_to(U)
// Positive: U is owed money. Negative: U owes money. Sum across members = 0.
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

  const { rows } = await pool.query(
    `
    SELECT u.id, u.name, u.color, (u.login_token IS NULL) AS is_ghost,
      (COALESCE(paid.total, 0)
       - COALESCE(shares.total, 0)
       + COALESCE(po.total, 0)
       - COALESCE(pi.total, 0))::bigint AS balance_cents
    FROM splitwiser_group_members gm
    JOIN splitwiser_users u ON u.id = gm.user_id
    LEFT JOIN (
      SELECT paid_by, SUM(total_cents) AS total
      FROM splitwiser_expenses
      WHERE group_id = $1 AND deleted_at IS NULL
      GROUP BY paid_by
    ) paid ON paid.paid_by = u.id
    LEFT JOIN (
      SELECT s.user_id, SUM(s.share_cents) AS total
      FROM splitwiser_expense_shares s
      JOIN splitwiser_expenses e ON e.id = s.expense_id
      WHERE e.group_id = $1 AND e.deleted_at IS NULL
      GROUP BY s.user_id
    ) shares ON shares.user_id = u.id
    LEFT JOIN (
      SELECT from_user, SUM(amount_cents) AS total
      FROM splitwiser_payments
      WHERE group_id = $1
      GROUP BY from_user
    ) po ON po.from_user = u.id
    LEFT JOIN (
      SELECT to_user, SUM(amount_cents) AS total
      FROM splitwiser_payments
      WHERE group_id = $1
      GROUP BY to_user
    ) pi ON pi.to_user = u.id
    WHERE gm.group_id = $1 AND gm.removed_at IS NULL
    ORDER BY u.id
    `,
    [groupId],
  );

  return NextResponse.json({ balances: rows });
}
