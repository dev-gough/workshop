'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AlignedData, Series } from 'uplot';
import UplotChart from '@/components/charts/uplot-chart';
import { fmtMoney } from '../_lib/format';

export default function EquityChart({ accountId, refreshKey }: { accountId: number; refreshKey: number }) {
  const [points, setPoints] = useState<{ ts: number; totalValueCents: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/paper-trading/accounts/${accountId}/history`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPoints(d.snapshots ?? []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, refreshKey]);

  const data = useMemo<AlignedData>(() => {
    const xs = points.map((p) => p.ts);
    const ys = points.map((p) => p.totalValueCents / 100);
    return [xs, ys];
  }, [points]);

  const series = useMemo<Series[]>(() => [
    {},
    { label: 'Account value', stroke: 'var(--color-primary)', width: 2, value: (_u, v) => (v == null ? '--' : fmtMoney(Math.round(v * 100))) },
  ], []);

  if (loading) return <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Loading equity curve…</div>;
  if (points.length < 2) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
        <span>Not enough history yet.</span>
        <span className="text-xs">The equity curve fills in as the snapshot job records value during market hours.</span>
      </div>
    );
  }

  return <UplotChart data={data} series={series} height={220} />;
}
