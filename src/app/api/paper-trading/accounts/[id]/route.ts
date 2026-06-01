import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

function parseId(id: string): number | null {
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

// PATCH — rename an account.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await params).id);
    if (id == null) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });
    const { name } = await request.json();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return NextResponse.json({ error: 'Account name is required' }, { status: 400 });

    const { rowCount } = await pool.query(`UPDATE pt_accounts SET name = $1 WHERE id = $2`, [trimmed, id]);
    if (!rowCount) return NextResponse.json({ error: 'account not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('paper-trading account PATCH error:', error);
    return NextResponse.json({ error: 'Failed to rename account' }, { status: 500 });
  }
}

// DELETE — remove an account and all its positions/orders/trades/snapshots (cascade).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await params).id);
    if (id == null) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });
    const { rowCount } = await pool.query(`DELETE FROM pt_accounts WHERE id = $1`, [id]);
    if (!rowCount) return NextResponse.json({ error: 'account not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('paper-trading account DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
