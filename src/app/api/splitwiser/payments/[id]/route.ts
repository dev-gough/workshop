import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { id } = await params;
  const paymentId = parseInt(id, 10);
  if (!Number.isFinite(paymentId)) {
    return NextResponse.json({ error: 'invalid payment id' }, { status: 400 });
  }

  const { rows } = await pool.query(
    `SELECT created_by FROM splitwiser_payments WHERE id = $1`,
    [paymentId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (rows[0].created_by !== me.id) {
    return NextResponse.json({ error: 'only the creator can delete' }, { status: 403 });
  }

  await pool.query(`DELETE FROM splitwiser_payments WHERE id = $1`, [paymentId]);
  return NextResponse.json({ ok: true });
}
