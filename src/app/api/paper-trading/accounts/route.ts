import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list accounts, each with current cash, mark-to-market holdings value, total
// value, and P&L vs the original seed.
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.seed_cents, a.cash_cents, a.created_at,
              COALESCE(SUM(COALESCE(q.price_cents * p.qty, p.cost_basis_cents)), 0) AS holdings_cents,
              COUNT(p.symbol) AS position_count
       FROM pt_accounts a
       LEFT JOIN pt_positions p ON p.account_id = a.id
       LEFT JOIN pt_quotes q ON q.symbol = p.symbol
       GROUP BY a.id
       ORDER BY a.created_at ASC`,
    );
    const accounts = rows.map((r) => {
      const cash = Number(r.cash_cents);
      const holdings = Number(r.holdings_cents);
      const seed = Number(r.seed_cents);
      const totalValue = cash + holdings;
      return {
        id: Number(r.id),
        name: r.name,
        seedCents: seed,
        cashCents: cash,
        holdingsCents: holdings,
        totalValueCents: totalValue,
        totalPnlCents: totalValue - seed,
        positionCount: Number(r.position_count),
        createdAt: r.created_at,
      };
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('paper-trading accounts GET error:', error);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}

// POST — create an account seeded with a custom dollar amount.
export async function POST(request: NextRequest) {
  try {
    const { name, seedDollars } = await request.json();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return NextResponse.json({ error: 'Account name is required' }, { status: 400 });
    const seed = Number(seedDollars);
    if (!Number.isFinite(seed) || seed <= 0) return NextResponse.json({ error: 'Seed amount must be positive' }, { status: 400 });
    if (seed > 10_000_000) return NextResponse.json({ error: 'Seed amount cannot exceed $10,000,000' }, { status: 400 });

    const seedCents = Math.round(seed * 100);
    const { rows } = await pool.query(
      `INSERT INTO pt_accounts (name, seed_cents, cash_cents) VALUES ($1, $2, $2) RETURNING id, name, seed_cents, cash_cents, created_at`,
      [trimmed, seedCents],
    );
    const r = rows[0];
    return NextResponse.json({
      account: {
        id: Number(r.id),
        name: r.name,
        seedCents: Number(r.seed_cents),
        cashCents: Number(r.cash_cents),
        holdingsCents: 0,
        totalValueCents: Number(r.cash_cents),
        totalPnlCents: 0,
        positionCount: 0,
        createdAt: r.created_at,
      },
    });
  } catch (error) {
    console.error('paper-trading accounts POST error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
