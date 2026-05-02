import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// GET — recent expenses + payments across every group I'm a member of.
// Used by the workshop home page activity feed.
export async function GET(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '15'), 50);

  const { rows: groupIdRows } = await pool.query(
    `SELECT group_id FROM splitwiser_group_members WHERE user_id = $1 AND removed_at IS NULL`,
    [me.id],
  );
  const groupIds = groupIdRows.map((r) => r.group_id);
  if (groupIds.length === 0) {
    return NextResponse.json({ activity: [] });
  }

  const { rows: expenses } = await pool.query(
    `SELECT 'expense' AS kind, e.id, e.created_at, e.occurred_on,
            e.description, e.total_cents, e.paid_by,
            payer.name AS payer_name,
            g.id AS group_id, g.name AS group_name,
            (SELECT share_cents FROM splitwiser_expense_shares
             WHERE expense_id = e.id AND user_id = $1) AS my_share_cents
     FROM splitwiser_expenses e
     JOIN splitwiser_groups g ON g.id = e.group_id
     JOIN splitwiser_users payer ON payer.id = e.paid_by
     WHERE e.group_id = ANY($2::int[]) AND e.deleted_at IS NULL
     ORDER BY e.created_at DESC
     LIMIT $3`,
    [me.id, groupIds, limit],
  );

  const { rows: payments } = await pool.query(
    `SELECT 'payment' AS kind, p.id, p.created_at, p.occurred_on,
            p.amount_cents, p.from_user, p.to_user,
            fu.name AS from_name, tu.name AS to_name,
            g.id AS group_id, g.name AS group_name
     FROM splitwiser_payments p
     JOIN splitwiser_groups g ON g.id = p.group_id
     JOIN splitwiser_users fu ON fu.id = p.from_user
     JOIN splitwiser_users tu ON tu.id = p.to_user
     WHERE p.group_id = ANY($1::int[])
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [groupIds, limit],
  );

  const merged = [...expenses, ...payments]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  return NextResponse.json({ activity: merged });
}
