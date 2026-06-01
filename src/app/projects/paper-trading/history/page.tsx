'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { fmtMoney, fmtDateTime, pnlColor } from '../_lib/format';

interface Trade {
  id: number; symbol: string; side: 'buy' | 'sell'; qty: number;
  priceCents: number; totalCents: number; realizedPnlCents: number | null; executedAt: string;
}

const PAGE_SIZE = 25;

export default function HistoryPage() {
  const { selected, loading } = useAccounts();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filters
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async (accountId: number, ofs: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(ofs) });
    if (symbol.trim()) params.set('symbol', symbol.trim());
    if (side) params.set('side', side);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const res = await fetch(`/api/paper-trading/accounts/${accountId}/trades?${params}`);
    const data = await res.json();
    setTrades(data.trades ?? []);
    setTotal(data.total ?? 0);
  }, [symbol, side, from, to]);

  useEffect(() => {
    if (!selected) return;
    load(selected.id, offset);
  }, [selected, offset, load]);

  // Reset to first page whenever a filter changes.
  useEffect(() => { setOffset(0); }, [symbol, side, from, to]);

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;
  if (!selected) return <div className="rounded-xl border border-dashed border-border bg-card/40 py-20 text-center text-sm text-muted-foreground">Select or create an account to view its history.</div>;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <Field label="Symbol">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="All"
            className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm uppercase outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        <Field label="Side">
          <select value={side} onChange={(e) => setSide(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </Field>
        {(symbol || side || from || to) && (
          <button onClick={() => { setSymbol(''); setSide(''); setFrom(''); setTo(''); }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/60">Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Transaction log</span>
          <span className="text-xs text-muted-foreground">{total} trade{total !== 1 ? 's' : ''}</span>
        </div>
        {trades.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">No trades match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 font-medium">Side</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {trades.map((t) => (
                  <tr key={t.id} className="border-t border-border/60">
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDateTime(t.executedAt)}</td>
                    <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
                    <td className="px-4 py-2.5"><span className={t.side === 'buy' ? 'text-emerald-500' : 'text-red-500'}>{t.side.toUpperCase()}</span></td>
                    <td className="px-4 py-2.5 text-right">{t.qty}</td>
                    <td className="px-4 py-2.5 text-right">{fmtMoney(t.priceCents)}</td>
                    <td className="px-4 py-2.5 text-right">{fmtMoney(t.totalCents)}</td>
                    <td className={`px-4 py-2.5 text-right ${t.realizedPnlCents != null ? pnlColor(t.realizedPnlCents) : 'text-muted-foreground'}`}>
                      {t.realizedPnlCents != null ? fmtMoney(t.realizedPnlCents, { sign: true }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Page {page} of {pageCount}</span>
            <div className="flex gap-1">
              <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted/60 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted/60 disabled:opacity-40">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
