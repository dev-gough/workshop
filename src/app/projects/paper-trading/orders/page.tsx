'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { fmtMoney, fmtDateTime } from '../_lib/format';

interface OpenOrder {
  id: number; symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit';
  qty: number; limitPriceCents: number | null; status: string; createdAt: string;
}

export default function OrdersPage() {
  const { selected, loading } = useAccounts();
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

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
    try {
      await fetch(`/api/paper-trading/orders/${orderId}`, { method: 'DELETE' });
      if (selected) await load(selected.id);
    } finally { setBusyId(null); }
  }

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading…</div>;
  if (!selected) return <EmptyState />;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">Open orders</div>
      {orders.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">No resting orders. Limit orders and orders placed while the market is closed appear here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Placed</th>
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium">Side</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Limit</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border/60">
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtDateTime(o.createdAt)}</td>
                  <td className="px-4 py-2.5 font-medium">{o.symbol}</td>
                  <td className="px-4 py-2.5">
                    <span className={o.side === 'buy' ? 'text-emerald-500' : 'text-red-500'}>{o.side.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2.5 capitalize">
                    {o.type}
                    {o.type === 'market' && <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">queued</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">{o.qty}</td>
                  <td className="px-4 py-2.5 text-right">{o.limitPriceCents != null ? fmtMoney(o.limitPriceCents) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => cancel(o.id)} disabled={busyId === o.id}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/60 disabled:opacity-50">
                      <X className="h-3 w-3" /> Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 py-20 text-center text-sm text-muted-foreground">
      Select or create an account to view its orders.
    </div>
  );
}
