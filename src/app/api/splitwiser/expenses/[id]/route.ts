import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized, userIsInGroup } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { id } = await params;
  const expenseId = parseInt(id, 10);
  if (!Number.isFinite(expenseId)) {
    return NextResponse.json({ error: 'invalid expense id' }, { status: 400 });
  }

  const { rows } = await pool.query(
    `SELECT e.*,
            COALESCE(json_agg(json_build_object('user_id', s.user_id, 'share_cents', s.share_cents))
                     FILTER (WHERE s.user_id IS NOT NULL), '[]') AS shares
     FROM splitwiser_expenses e
     LEFT JOIN splitwiser_expense_shares s ON s.expense_id = e.id
     WHERE e.id = $1 AND e.deleted_at IS NULL
     GROUP BY e.id`,
    [expenseId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!(await userIsInGroup(me.id, rows[0].group_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ expense: rows[0] });
}

// DELETE — soft-delete. Only the creator can delete.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { id } = await params;
  const expenseId = parseInt(id, 10);
  if (!Number.isFinite(expenseId)) {
    return NextResponse.json({ error: 'invalid expense id' }, { status: 400 });
  }

  const { rows } = await pool.query(
    `SELECT created_by, deleted_at FROM splitwiser_expenses WHERE id = $1`,
    [expenseId],
  );
  if (rows.length === 0 || rows[0].deleted_at !== null) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (rows[0].created_by !== me.id) {
    return NextResponse.json({ error: 'only the creator can delete' }, { status: 403 });
  }

  await pool.query(
    `UPDATE splitwiser_expenses SET deleted_at = NOW() WHERE id = $1`,
    [expenseId],
  );
  return NextResponse.json({ ok: true });
}
