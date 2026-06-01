'use client';

import { useCallback, useEffect, useState } from 'react';
import { isMarketOpen } from '@/lib/market';
import { useAccounts } from './_lib/account-context';
import { fmtMoney, fmtPct, pnlColor } from './_lib/format';
import TradeTicket from './_components/trade-ticket';
import EquityChart from './_components/equity-chart';

interface Position {
  symbol: string; name: string | null; qty: number; avgCostCents: number;
  priceCents: number | null; marketValueCents: number; unrealizedPnlCents: number;
  unrealizedPnlPct: number; dayChangeCents: number | null;
}

export default function PortfolioPage() {
  const { selected, loading, refresh } = useAccounts();
  const [positions, setPositions] = useState<Position[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [selected, loadPositions, refresh, refreshKey]);

  const onTradeDone = useCallback(() => {
    if (selected) loadPositions(selected.id);
    refresh();
    setRefreshKey((k) => k + 1);
  }, [selected, loadPositions, refresh]);

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;

  if (!selected) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 py-20 text-center">
        <p className="text-lg font-medium">No account selected</p>
        <p className="mt-1 text-sm text-muted-foreground">Click <strong>Manage</strong> above to create your first paper-trading account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total value" value={fmtMoney(selected.totalValueCents)} />
        <SummaryCard label="Total P&L"
          value={fmtMoney(selected.totalPnlCents, { sign: true })}
          sub={fmtPct((selected.totalPnlCents / selected.seedCents) * 100, { sign: true })}
          valueClass={pnlColor(selected.totalPnlCents)} />
        <SummaryCard label="Cash" value={fmtMoney(selected.cashCents)} />
        <SummaryCard label="Holdings" value={fmtMoney(selected.holdingsCents)} sub={`${selected.positionCount} position${selected.positionCount !== 1 ? 's' : ''}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Equity curve */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 text-sm font-semibold">Equity curve</div>
            <EquityChart accountId={selected.id} refreshKey={refreshKey} />
          </div>

          {/* Holdings */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Holdings</div>
            {positions.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No positions yet. Place a buy order to get started.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Symbol</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Avg cost</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2 text-right font-medium">Mkt value</th>
                      <th className="px-4 py-2 text-right font-medium">Unreal. P&L</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {positions.map((p) => (
                      <tr key={p.symbol} className="border-t border-border/60">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{p.symbol}</div>
                          {p.name && <div className="max-w-[160px] truncate text-xs text-muted-foreground">{p.name}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right">{p.qty}</td>
                        <td className="px-4 py-2.5 text-right">{fmtMoney(p.avgCostCents)}</td>
                        <td className="px-4 py-2.5 text-right">{p.priceCents != null ? fmtMoney(p.priceCents) : '—'}</td>
                        <td className="px-4 py-2.5 text-right">{fmtMoney(p.marketValueCents)}</td>
                        <td className={`px-4 py-2.5 text-right ${pnlColor(p.unrealizedPnlCents)}`}>
                          {fmtMoney(p.unrealizedPnlCents, { sign: true })}
                          <div className="text-xs">{fmtPct(p.unrealizedPnlPct, { sign: true })}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Trade ticket */}
        <div className="lg:col-span-1">
          <TradeTicket accountId={selected.id} cashCents={selected.cashCents} onDone={onTradeDone} />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums ${valueClass ?? 'text-muted-foreground'}`}>{sub}</div>}
    </div>
  );
}
