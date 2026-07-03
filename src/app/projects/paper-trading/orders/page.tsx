'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { fmtMoney, fmtDateTime } from '../_lib/format';
import { Monogram } from '../_components/holding-row';

interface OpenOrder {
  id: number; symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit';
  qty: number; limitPriceCents: number | null; status: string; createdAt: string;
}

export default function OrdersPage() {
  const { selected, loading } = useAccounts();
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<{ id: number; message: string } | null>(null);

  const load = useCallback(async (id: number) => {
    const res = await fetch(`/api/paper-trading/accounts/${id}/orders`);
    const data = await res.json();
    setOrders(data.orders ?? []);
  }, []);

  useEffect(() => {
    if (!selected) return;
    load(selected.id);
    const t = setInterval(() => load(selected.id), 20_000);
    return () => clearInterval(t);
  }, [selected, load]);

  async function cancel(orderId: number) {
    setBusyId(orderId);
    setCancelError(null);
    try {
      const res = await fetch(`/api/paper-trading/orders/${orderId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setCancelError({ id: orderId, message: data?.error || data?.message || 'Could not cancel this order.' });
        if (selected) await load(selected.id);
        return;
      }
      if (selected) await load(selected.id);
    } catch {
      setCancelError({ id: orderId, message: 'Could not cancel this order.' });
    } finally { setBusyId(null); }
  }

  if (loading) return <div className="py-24 text-center text-muted-foreground">Loading…</div>;
  if (!selected) return <EmptyState text="Select or create an account to view its orders." />;

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="ws-serif text-xl font-semibold tracking-tight">Open orders</h2>
        {orders.length > 0 && <span className="text-xs text-muted-foreground">{orders.length} resting</span>}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No resting orders. Limit orders — and orders placed while the market is closed — appear here.
        </p>
      ) : (
        <div className="-mx-3">
          {orders.map((o) => (
            <div key={o.id}>
            <div className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-muted">
              <Monogram symbol={o.symbol} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold leading-tight">
                  {o.symbol}
                  <span className={`text-[11px] font-bold tracking-wide ${o.side === 'buy' ? 'pt-gain' : 'pt-loss'}`}>{o.side.toUpperCase()}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="capitalize">{o.type}</span>
                  {o.type === 'market' && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">queued</span>
                  )}
                  <span>· {o.qty} {o.qty === 1 ? 'share' : 'shares'}</span>
                  {o.limitPriceCents != null && <span>· limit {fmtMoney(o.limitPriceCents)}</span>}
                  <span>· {fmtDateTime(o.createdAt)}</span>
                </div>
              </div>
              <button onClick={() => cancel(o.id)} disabled={busyId === o.id}
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50">
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
            {cancelError?.id === o.id && (
              <p className="px-3 pb-2 text-xs pt-loss">{cancelError.message}</p>
            )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-border py-24 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
