'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { fmtMoney, fmtDateTime, pnlColor } from '../_lib/format';
import { Monogram } from '../_components/holding-row';

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

  if (loading) return <div className="py-24 text-center text-muted-foreground">Loading…</div>;
  if (!selected) return <div className="rounded-3xl border border-dashed border-border py-24 text-center text-sm text-muted-foreground">Select or create an account to view its history.</div>;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inputCls = 'rounded-full border border-border bg-card px-3.5 py-2 text-sm outline-none transition-colors focus:border-foreground/40';

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="ws-serif text-xl font-semibold tracking-tight">Activity</h2>
        <span className="text-xs text-muted-foreground">{total} trade{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Symbol">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="All"
            className={`w-28 uppercase ${inputCls}`} />
        </Field>
        <Field label="Side">
          <select value={side} onChange={(e) => setSide(e.target.value)} className={inputCls}>
            <option value="">All</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </Field>
        {(symbol || side || from || to) && (
          <button onClick={() => { setSymbol(''); setSide(''); setFrom(''); setTo(''); }}
            className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Clear</button>
        )}
      </div>

      {/* Activity list */}
      {trades.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">No trades match these filters.</p>
      ) : (
        <div className="-mx-3">
          {trades.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-3">
              <Monogram symbol={t.symbol} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-tight">
                  {t.side === 'buy' ? 'Bought' : 'Sold'} {t.qty} {t.symbol}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                  {fmtDateTime(t.executedAt)} · @ {fmtMoney(t.priceCents)}
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="font-semibold leading-tight">
                  {t.side === 'buy' ? '−' : '+'}{fmtMoney(t.totalCents)}
                </div>
                {t.realizedPnlCents != null && (
                  <div className={`text-xs ${pnlColor(t.realizedPnlCents)}`}>
                    {fmtMoney(t.realizedPnlCents, { sign: true })} P&L
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-1.5">
            <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 transition-colors hover:border-foreground/30 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 transition-colors hover:border-foreground/30 disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="px-1 text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
