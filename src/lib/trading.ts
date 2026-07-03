/**
 * Order engine for the paper-trading project. All money is integer cents, all share
 * quantities are whole numbers.
 *
 * Order lifecycle:
 *   - Market order, market open  → fills immediately at the latest quote.
 *   - Market order, market closed → queued (status 'open'), fills at the next open.
 *   - Limit order                → stays 'open' until the price crosses (buy: quote
 *                                   <= limit, sell: quote >= limit) during a session.
 *
 * Cash/shares are validated at fill time (we don't reserve buying power for resting
 * orders) — a fill that can no longer be afforded is marked 'rejected' rather than
 * driving the account negative. Every fill is one transaction so cash, position, the
 * trade ledger row, and the order's terminal state all move together.
 */
import type { PoolClient } from 'pg';
import pool from './db';
import { isMarketOpen, nextMarketOpen, todaysMarketOpen } from './market';
import { getQuote } from './quotes';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  type: OrderType;
  /** Either qty or dollars must be supplied. qty wins if both are present. */
  qty?: number;
  dollars?: number;
  /** Required for limit orders, in dollars. */
  limitPrice?: number;
}

export interface PlaceOrderResult {
  ok: boolean;
  status: 'filled' | 'queued' | 'open' | 'rejected';
  orderId?: number;
  filledQty?: number;
  fillPriceCents?: number;
  message: string;
}

interface OpenOrderRow {
  id: number;
  account_id: number;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limit_price_cents: number | null;
}

function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

/** Does the latest price satisfy a limit order's trigger? Market orders always do. */
function isFillable(order: OpenOrderRow, priceCents: number): boolean {
  if (order.type === 'market') return true;
  if (order.limit_price_cents == null) return false;
  return order.side === 'buy' ? priceCents <= order.limit_price_cents : priceCents >= order.limit_price_cents;
}

/**
 * Execute a fill inside an existing transaction. Updates cash + position, writes the
 * trade ledger row, and marks the order filled. If the account can't afford the buy
 * or lacks the shares to sell, marks the order 'rejected' and returns ok:false.
 */
async function fillOrderTx(client: PoolClient, order: OpenOrderRow, fillPriceCents: number): Promise<{ ok: boolean; reason?: string }> {
  const total = order.qty * fillPriceCents;

  if (order.side === 'buy') {
    const { rows } = await client.query(`SELECT cash_cents FROM pt_accounts WHERE id = $1 FOR UPDATE`, [order.account_id]);
    if (rows.length === 0) return { ok: false, reason: 'account not found' };
    const cash = Number(rows[0].cash_cents);
    if (cash < total) {
      await rejectOrderTx(client, order.id, 'insufficient buying power at fill time');
      return { ok: false, reason: 'insufficient buying power' };
    }
    await client.query(`UPDATE pt_accounts SET cash_cents = cash_cents - $1 WHERE id = $2`, [total, order.account_id]);
    await client.query(
      `INSERT INTO pt_positions (account_id, symbol, qty, cost_basis_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, symbol) DO UPDATE
         SET qty = pt_positions.qty + EXCLUDED.qty,
             cost_basis_cents = pt_positions.cost_basis_cents + EXCLUDED.cost_basis_cents`,
      [order.account_id, order.symbol, order.qty, total],
    );
    await client.query(
      `INSERT INTO pt_trades (account_id, order_id, symbol, side, qty, price_cents, total_cents)
       VALUES ($1, $2, $3, 'buy', $4, $5, $6)`,
      [order.account_id, order.id, order.symbol, order.qty, fillPriceCents, total],
    );
  } else {
    const { rows } = await client.query(
      `SELECT qty, cost_basis_cents FROM pt_positions WHERE account_id = $1 AND symbol = $2 FOR UPDATE`,
      [order.account_id, order.symbol],
    );
    const posQty = rows.length ? Number(rows[0].qty) : 0;
    if (posQty < order.qty) {
      await rejectOrderTx(client, order.id, 'insufficient shares at fill time');
      return { ok: false, reason: 'insufficient shares' };
    }
    const costBasis = Number(rows[0].cost_basis_cents);
    // Proportional cost basis of the shares being sold (avoids per-share rounding drift).
    const costOfSold = Math.round((costBasis * order.qty) / posQty);
    const realized = total - costOfSold;
    const remainingQty = posQty - order.qty;
    if (remainingQty === 0) {
      await client.query(`DELETE FROM pt_positions WHERE account_id = $1 AND symbol = $2`, [order.account_id, order.symbol]);
    } else {
      await client.query(
        `UPDATE pt_positions SET qty = $1, cost_basis_cents = $2 WHERE account_id = $3 AND symbol = $4`,
        [remainingQty, costBasis - costOfSold, order.account_id, order.symbol],
      );
    }
    await client.query(`UPDATE pt_accounts SET cash_cents = cash_cents + $1 WHERE id = $2`, [total, order.account_id]);
    await client.query(
      `INSERT INTO pt_trades (account_id, order_id, symbol, side, qty, price_cents, total_cents, realized_pnl_cents)
       VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7)`,
      [order.account_id, order.id, order.symbol, order.qty, fillPriceCents, total, realized],
    );
  }

  await client.query(
    `UPDATE pt_orders SET status = 'filled', filled_at = now(), fill_price_cents = $1 WHERE id = $2`,
    [fillPriceCents, order.id],
  );
  return { ok: true };
}

async function rejectOrderTx(client: PoolClient, orderId: number, reason: string): Promise<void> {
  await client.query(`UPDATE pt_orders SET status = 'rejected', reject_reason = $1 WHERE id = $2`, [reason, orderId]);
}

/** Run a single fill in its own transaction. */
async function attemptFill(order: OpenOrderRow, fillPriceCents: number): Promise<{ ok: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fillOrderTx(client, order, fillPriceCents);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Validate and place an order. Fills immediately when possible, otherwise leaves it
 * resting. Fetches a fresh quote (used for dollar→share conversion and immediate
 * fills). Returns a structured result describing what happened.
 */
export async function placeOrder(accountId: number, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const symbol = input.symbol?.trim().toUpperCase();
  if (!symbol) return { ok: false, status: 'rejected', message: 'symbol is required' };
  if (input.side !== 'buy' && input.side !== 'sell') return { ok: false, status: 'rejected', message: 'side must be buy or sell' };
  if (input.type !== 'market' && input.type !== 'limit') return { ok: false, status: 'rejected', message: 'type must be market or limit' };

  let limitCents: number | null = null;
  if (input.type === 'limit') {
    if (input.limitPrice == null || !(input.limitPrice > 0)) return { ok: false, status: 'rejected', message: 'limit orders need a positive limit price' };
    limitCents = dollarsToCents(input.limitPrice);
  }

  // Fresh quote for fill / dollar conversion. May be null (e.g. typo, or yahoo down).
  // Fetched before the transaction — it's an external call and shouldn't hold a tx open.
  const quote = await getQuote(symbol);
  const marketOpen = isMarketOpen();

  // Resolve quantity (whole shares).
  let qty: number;
  if (input.qty != null) {
    qty = Math.floor(input.qty);
    if (qty < 1) return { ok: false, status: 'rejected', message: 'quantity must be at least 1 share' };
  } else if (input.dollars != null && input.dollars > 0) {
    const refPriceCents = input.type === 'limit' ? limitCents! : quote?.priceCents;
    if (!refPriceCents) return { ok: false, status: 'rejected', message: 'no quote available to size a dollar order' };
    qty = Math.floor(dollarsToCents(input.dollars) / refPriceCents);
    if (qty < 1) return { ok: false, status: 'rejected', message: 'amount is too small for even one share' };
  } else {
    return { ok: false, status: 'rejected', message: 'provide either a share quantity or a dollar amount' };
  }

  // One transaction: confirm the account exists, insert the order as 'open', then decide
  // whether to fill it now — so an order is never observable in a half-processed state.
  // Non-fill paths (market-closed, limit resting) still commit the insert as 'open'; a
  // rejected fill commits the order in 'rejected' state (fillOrderTx marks it).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const acct = await client.query(`SELECT id FROM pt_accounts WHERE id = $1`, [accountId]);
    if (acct.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 'rejected', message: 'account not found' };
    }

    const inserted = await client.query(
      `INSERT INTO pt_orders (account_id, symbol, side, type, qty, limit_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [accountId, symbol, input.side, input.type, qty, limitCents],
    );
    const orderId = Number(inserted.rows[0].id);
    const order: OpenOrderRow = { id: orderId, account_id: accountId, symbol, side: input.side, type: input.type, qty, limit_price_cents: limitCents };

    // Market order while the market is closed → leave queued for the next open.
    if (input.type === 'market' && !marketOpen) {
      await client.query('COMMIT');
      const open = nextMarketOpen();
      return {
        ok: true,
        status: 'queued',
        orderId,
        message: open ? `Market closed — queued to fill at next open (${open.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET).` : 'Market closed — order queued.',
      };
    }

    // Eligible to fill right now?
    if (quote && marketOpen && isFillable(order, quote.priceCents)) {
      const res = await fillOrderTx(client, order, quote.priceCents);
      await client.query('COMMIT');
      if (res.ok) {
        return { ok: true, status: 'filled', orderId, filledQty: qty, fillPriceCents: quote.priceCents, message: `Filled ${qty} ${symbol} @ $${(quote.priceCents / 100).toFixed(2)}.` };
      }
      return { ok: false, status: 'rejected', orderId, message: `Order rejected: ${res.reason}.` };
    }

    // Limit order resting (or market order we couldn't price yet).
    await client.query('COMMIT');
    if (input.type === 'limit') {
      return { ok: true, status: 'open', orderId, message: `Limit ${input.side} placed for ${qty} ${symbol} @ $${(limitCents! / 100).toFixed(2)} — resting until it crosses.` };
    }
    return { ok: true, status: 'open', orderId, message: `Order placed for ${qty} ${symbol} — awaiting a quote to fill.` };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Cancel a resting order. Only 'open' orders can be cancelled. */
export async function cancelOrder(orderId: number): Promise<{ ok: boolean; message: string }> {
  const { rowCount } = await pool.query(
    `UPDATE pt_orders SET status = 'cancelled' WHERE id = $1 AND status = 'open'`,
    [orderId],
  );
  return rowCount ? { ok: true, message: 'Order cancelled.' } : { ok: false, message: 'Order not found or no longer open.' };
}

/**
 * Sweep all resting orders and fill any that the latest cached quotes now satisfy.
 * Called by the collector after it refreshes pt_quotes. No-op while the market is
 * closed (queued market + limit orders only fill during a session). Returns the
 * number of orders filled.
 */
export async function processOpenOrders(): Promise<number> {
  if (!isMarketOpen()) return 0;
  // Reject quotes captured before today's session began — on the first sweep after the
  // open the cache may still hold yesterday's close, and we don't want to fill on it.
  const sessionOpen = todaysMarketOpen();
  const { rows } = await pool.query<OpenOrderRow & { price_cents: string | null; quote_updated_at: Date | null }>(
    `SELECT o.id, o.account_id, o.symbol, o.side, o.type, o.qty, o.limit_price_cents, q.price_cents, q.updated_at AS quote_updated_at
     FROM pt_orders o
     LEFT JOIN pt_quotes q ON q.symbol = o.symbol
     WHERE o.status = 'open'
     ORDER BY o.created_at ASC`,
  );

  let filled = 0;
  for (const r of rows) {
    if (r.price_cents == null) continue; // no quote yet; try next sweep
    // Stale quote (from before today's open) → leave the order resting for a later sweep.
    if (sessionOpen && (r.quote_updated_at == null || new Date(r.quote_updated_at) < sessionOpen)) continue;
    const priceCents = Number(r.price_cents);
    const order: OpenOrderRow = {
      id: Number(r.id), account_id: Number(r.account_id), symbol: r.symbol,
      side: r.side, type: r.type, qty: Number(r.qty), limit_price_cents: r.limit_price_cents == null ? null : Number(r.limit_price_cents),
    };
    if (!isFillable(order, priceCents)) continue;
    try {
      const res = await attemptFill(order, priceCents);
      if (res.ok) filled++;
    } catch (e) {
      console.error(`fill failed for order ${order.id}:`, e);
    }
  }
  return filled;
}

/** Write one mark-to-market equity snapshot per account (cash + holdings value). */
export async function snapshotAccounts(): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO pt_snapshots (account_id, total_value_cents, cash_cents)
     SELECT a.id,
            a.cash_cents + COALESCE(SUM(COALESCE(q.price_cents * p.qty, p.cost_basis_cents)), 0),
            a.cash_cents
     FROM pt_accounts a
     LEFT JOIN pt_positions p ON p.account_id = a.id
     LEFT JOIN pt_quotes q ON q.symbol = p.symbol
     GROUP BY a.id, a.cash_cents
     ON CONFLICT (account_id, ts) DO NOTHING`,
  );
  return rowCount ?? 0;
}
