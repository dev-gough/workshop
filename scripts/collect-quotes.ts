/**
 * Paper-trading quote collector. Runs every 60s via a systemd timer.
 *
 * While the market is open it: (1) refreshes quotes for every symbol that's held or
 * has a resting order, (2) fills any limit/queued orders the new prices satisfy, and
 * (3) writes a mark-to-market equity snapshot per account. While the market is closed
 * it exits early — prices don't move and there's nothing to fill — which also keeps us
 * polite to the free quote APIs.
 */
import pool from '../src/lib/db';
import { isMarketOpen } from '../src/lib/market';
import { getQuotes } from '../src/lib/quotes';
import { processOpenOrders, snapshotAccounts } from '../src/lib/trading';

async function distinctSymbols(): Promise<string[]> {
  const { rows } = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM (
       SELECT symbol FROM pt_positions
       UNION
       SELECT symbol FROM pt_orders WHERE status = 'open'
     ) s`,
  );
  return rows.map((r) => r.symbol);
}

async function main() {
  try {
    if (!isMarketOpen()) {
      console.log('market closed — skipping quote refresh');
      return;
    }
    const symbols = await distinctSymbols();
    if (symbols.length > 0) {
      const quotes = await getQuotes(symbols);
      console.log(`refreshed ${quotes.size}/${symbols.length} symbols`);
    }
    const filled = await processOpenOrders();
    const snaps = await snapshotAccounts();
    console.log(`filled ${filled} resting order(s), wrote ${snaps} snapshot(s)`);
  } catch (err) {
    console.error('collect-quotes error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
