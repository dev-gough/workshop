import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — the transaction log for an account with optional filters and pagination.
// Query params: symbol, side ('buy'|'sell'), from (ISO date), to (ISO date),
// limit (default 50, max 200), offset (default 0).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });

    const sp = request.nextUrl.searchParams;
    const symbol = sp.get('symbol')?.trim().toUpperCase();
    const side = sp.get('side')?.trim().toLowerCase();
    const from = sp.get('from');
    const to = sp.get('to');
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);

    const where: string[] = ['account_id = $1'];
    const args: unknown[] = [id];
    if (symbol) { args.push(symbol); where.push(`symbol = $${args.length}`); }
    if (side === 'buy' || side === 'sell') { args.push(side); where.push(`side = $${args.length}`); }
    if (from) { args.push(from); where.push(`executed_at >= $${args.length}`); }
    if (to) { args.push(to); where.push(`executed_at <= $${args.length}`); }
    const whereClause = where.join(' AND ');

    // Count + total realized P&L across the *whole* filtered set (not just this page),
    // so the summary stat is stable while paging.
    const aggRes = await pool.query(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(realized_pnl_cents), 0)::bigint AS realized_pnl_total
       FROM pt_trades WHERE ${whereClause}`,
      args,
    );
    const total = aggRes.rows[0].total as number;
    const realizedPnlTotalCents = Number(aggRes.rows[0].realized_pnl_total);

    const dataRes = await pool.query(
      `SELECT id, order_id, symbol, side, qty, price_cents, total_cents, realized_pnl_cents, executed_at
       FROM pt_trades
       WHERE ${whereClause}
       ORDER BY executed_at DESC, id DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, offset],
    );

    const trades = dataRes.rows.map((r) => ({
      id: Number(r.id),
      orderId: r.order_id == null ? null : Number(r.order_id),
      symbol: r.symbol,
      side: r.side,
      qty: Number(r.qty),
      priceCents: Number(r.price_cents),
      totalCents: Number(r.total_cents),
      realizedPnlCents: r.realized_pnl_cents == null ? null : Number(r.realized_pnl_cents),
      executedAt: r.executed_at,
    }));

    return NextResponse.json({ trades, total, realizedPnlTotalCents, limit, offset });
  } catch (error) {
    console.error('paper-trading trades GET error:', error);
    return NextResponse.json({ error: 'Failed to load transaction log' }, { status: 500 });
  }
}
