import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { placeOrder, type PlaceOrderInput } from '@/lib/trading';

export const dynamic = 'force-dynamic';

// GET — resting (open) orders for an account: queued markets + working limits.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });

    const { rows } = await pool.query(
      `SELECT id, symbol, side, type, qty, limit_price_cents, status, created_at
       FROM pt_orders
       WHERE account_id = $1 AND status = 'open'
       ORDER BY created_at DESC`,
      [id],
    );
    const orders = rows.map((r) => ({
      id: Number(r.id),
      symbol: r.symbol,
      side: r.side,
      type: r.type,
      qty: Number(r.qty),
      limitPriceCents: r.limit_price_cents == null ? null : Number(r.limit_price_cents),
      status: r.status,
      createdAt: r.created_at,
    }));
    return NextResponse.json({ orders });
  } catch (error) {
    console.error('paper-trading orders GET error:', error);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}

// POST — place a buy/sell order (market or limit; qty or dollar amount).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });

    const body = await request.json();
    const input: PlaceOrderInput = {
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      qty: body.qty != null ? Number(body.qty) : undefined,
      dollars: body.dollars != null ? Number(body.dollars) : undefined,
      limitPrice: body.limitPrice != null ? Number(body.limitPrice) : undefined,
    };

    const result = await placeOrder(id, input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error('paper-trading order POST error:', error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}
