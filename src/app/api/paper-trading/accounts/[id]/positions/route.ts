import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — holdings for an account joined with the latest quotes, with live P&L.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid account id' }, { status: 400 });

    const { rows } = await pool.query(
      `SELECT p.symbol, p.qty, p.cost_basis_cents, q.price_cents, q.prev_close_cents, q.name, q.updated_at
       FROM pt_positions p
       LEFT JOIN pt_quotes q ON q.symbol = p.symbol
       WHERE p.account_id = $1
       ORDER BY p.symbol ASC`,
      [id],
    );

    const positions = rows.map((r) => {
      const qty = Number(r.qty);
      const costBasis = Number(r.cost_basis_cents);
      const priceCents = r.price_cents == null ? null : Number(r.price_cents);
      const prevCloseCents = r.prev_close_cents == null ? null : Number(r.prev_close_cents);
      const marketValue = priceCents != null ? priceCents * qty : costBasis;
      const unrealized = marketValue - costBasis;
      const dayChange = priceCents != null && prevCloseCents != null ? (priceCents - prevCloseCents) * qty : null;
      return {
        symbol: r.symbol,
        name: r.name,
        qty,
        avgCostCents: Math.round(costBasis / qty),
        costBasisCents: costBasis,
        priceCents,
        marketValueCents: marketValue,
        unrealizedPnlCents: unrealized,
        unrealizedPnlPct: costBasis > 0 ? (unrealized / costBasis) * 100 : 0,
        dayChangeCents: dayChange,
        quoteUpdatedAt: r.updated_at,
      };
    });

    return NextResponse.json({ positions });
  } catch (error) {
    console.error('paper-trading positions GET error:', error);
    return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });
  }
}
