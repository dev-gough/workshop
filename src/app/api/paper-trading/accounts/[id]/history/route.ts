import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — equity-curve snapshots for an account (oldest first), for the chart.
// Optional `from` (ISO) to limit the window.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });

    const from = request.nextUrl.searchParams.get('from');
    const args: unknown[] = [id];
    let where = 'account_id = $1';
    if (from) { args.push(from); where += ` AND ts >= $${args.length}`; }

    const { rows } = await pool.query(
      `SELECT ts, total_value_cents, cash_cents FROM pt_snapshots WHERE ${where} ORDER BY ts ASC`,
      args,
    );
    const snapshots = rows.map((r) => ({
      ts: Math.floor(new Date(r.ts).getTime() / 1000),
      totalValueCents: Number(r.total_value_cents),
      cashCents: Number(r.cash_cents),
    }));
    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error('paper-trading history GET error:', error);
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }
}
