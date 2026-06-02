'use client';

import { useCallback, useEffect, useState } from 'react';
import { isMarketOpen } from '@/lib/market';
import { useAccounts } from './_lib/account-context';
import { useTrade } from './_lib/trade-context';
import { fmtMoney } from './_lib/format';
import EquitySection from './_components/equity-section';
import HoldingRow, { type Position } from './_components/holding-row';

export default function PortfolioPage() {
  const { selected, loading, refresh } = useAccounts();
  const { version, openTrade } = useTrade();
  const [positions, setPositions] = useState<Position[]>([]);

  const loadPositions = useCallback(async (accountId: number) => {
    const res = await fetch(`/api/paper-trading/accounts/${accountId}/positions`);
    const data = await res.json();
    setPositions(data.positions ?? []);
  }, []);

  // Load + poll positions/account value while the market is open.
  useEffect(() => {
    if (!selected) return;
    loadPositions(selected.id);
    const t = setInterval(() => {
      if (isMarketOpen()) { loadPositions(selected.id); refresh(); }
    }, 20_000);
    return () => clearInterval(t);
  }, [selected, loadPositions, refresh]);

  // A filled order bumps `version` — pull fresh positions + account value.
  useEffect(() => {
    if (!selected) return;
    loadPositions(selected.id);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (loading) return <div className="py-24 text-center text-muted-foreground">Loading…</div>;

  if (!selected) {
    return (
      <div className="rounded-3xl border border-dashed border-border py-24 text-center">
        <p className="ws-serif text-xl font-semibold">No account yet</p>
        <p className="mt-1.5 text-sm text-muted-foreground">Tap the gear above to create your first paper-trading account.</p>
      </div>
    );
  }

  return (
    <div>
      <EquitySection
        accountId={selected.id}
        seedCents={selected.seedCents}
        liveValueCents={selected.totalValueCents}
        reloadKey={version}
      />

      <section>
        <h2 className="ws-serif mb-1 text-xl font-semibold tracking-tight">Holdings</h2>

        {positions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            No positions yet. Hit <span className="font-medium text-foreground">Trade</span> to place your first order.
          </p>
        ) : (
          <div className="-mx-3">
            {positions.map((p) => (
              <HoldingRow key={p.symbol} position={p} onClick={() => openTrade({ symbol: p.symbol })} />
            ))}
          </div>
        )}

        {/* Cash row */}
        <div className="mt-2 flex items-center justify-between border-t border-border px-3 pt-4">
          <div>
            <div className="font-semibold">Cash</div>
            <div className="text-xs text-muted-foreground">Available to invest</div>
          </div>
          <div className="font-semibold tabular-nums">{fmtMoney(selected.cashCents)}</div>
        </div>
      </section>
    </div>
  );
}
