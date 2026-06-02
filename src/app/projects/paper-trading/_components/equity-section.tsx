'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AlignedData, Series, Options } from 'uplot';
import UplotChart from '@/components/charts/uplot-chart';
import { useTheme } from '@/components/ThemeProvider';
import { fmtMoney, fmtPct, fmtDateTime } from '../_lib/format';
import RangeTabs, { type Range, RANGE_SECONDS, RANGE_LABEL } from './range-tabs';

interface Snapshot { ts: number; totalValueCents: number }

export default function EquitySection({
  accountId, seedCents, liveValueCents, reloadKey,
}: {
  accountId: number;
  seedCents: number;
  liveValueCents: number;
  reloadKey: number;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('1M');
  // Cursor: data index + pixel offset within the plot (for the floating label).
  const [hover, setHover] = useState<{ idx: number; left: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/paper-trading/accounts/${accountId}/history`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: Snapshot[] = (d.snapshots ?? []).slice().sort((a: Snapshot, b: Snapshot) => a.ts - b.ts);
        setSnaps(list);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, reloadKey]);

  // Snapshots inside the selected window.
  const rangeSnaps = useMemo(() => {
    if (range === 'ALL' || !snaps.length) return snaps;
    const cutoff = Date.now() / 1000 - RANGE_SECONDS[range];
    const within = snaps.filter((s) => s.ts >= cutoff);
    return within.length ? within : snaps; // fall back so sparse windows still draw
  }, [snaps, range]);

  // For non-ALL ranges the baseline is the window's first point; for ALL it's
  // the seed, so "change" reads as lifetime P&L.
  const baseValue = range === 'ALL' ? seedCents : (rangeSnaps[0]?.totalValueCents ?? seedCents);
  const lastSnapValue = rangeSnaps.length ? rangeSnaps[rangeSnaps.length - 1].totalValueCents : liveValueCents;

  const hoverSnap = hover ? rangeSnaps[hover.idx] : null;
  const displayValue = hoverSnap ? hoverSnap.totalValueCents : liveValueCents;
  const changeCents = displayValue - baseValue;
  const changePct = baseValue ? (changeCents / baseValue) * 100 : 0;
  const up = lastSnapValue - baseValue >= 0;
  const changeColor = changeCents >= 0 ? 'pt-gain' : 'pt-loss';

  // Theme-aware line + gradient (uPlot draws to canvas, so concrete colors).
  const c = up
    ? (isDark ? { line: '#4cc47c', rgb: '76,196,124' } : { line: '#1f9254', rgb: '31,146,84' })
    : (isDark ? { line: '#f06a4e', rgb: '240,106,78' } : { line: '#c8472e', rgb: '200,71,46' });

  // Plot against a sequential index rather than the real timestamp, so closed
  // -market stretches (overnight, weekends) collapse instead of being spanned
  // by a long interpolated segment. The real time is recovered for labels.
  const data = useMemo<AlignedData>(() => {
    const xs = rangeSnaps.map((_, i) => i);
    const ys = rangeSnaps.map((s) => s.totalValueCents / 100);
    return [xs, ys];
  }, [rangeSnaps]);

  const series = useMemo<Series[]>(() => [
    {},
    {
      label: 'Value',
      stroke: c.line,
      width: 1.5,
      points: { show: false },
      fill: (u) => {
        const { ctx } = u;
        const top = u.bbox.top;
        const g = ctx.createLinearGradient(0, top, 0, top + u.bbox.height);
        g.addColorStop(0, `rgba(${c.rgb},0.13)`);
        g.addColorStop(1, `rgba(${c.rgb},0)`);
        return g;
      },
    },
  ], [c.line, c.rgb]);

  const opts = useMemo<Partial<Options>>(() => ({
    axes: [{ show: false }, { show: false }],
    legend: { show: false },
    padding: [10, 1, 2, 1],
    scales: { x: { time: false } }, // x is a sample index, not a timestamp
  }), []);

  const hoverDate = hoverSnap ? fmtDateTime(hoverSnap.ts) : null;

  return (
    <section className="mb-10">
      {/* Hero readout */}
      <div className="min-h-[78px]">
        {loading ? (
          <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
        ) : (
          <>
            <div className="text-[40px] font-semibold leading-none tracking-tight tabular-nums sm:text-[52px]">
              {fmtMoney(displayValue)}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 text-sm font-semibold tabular-nums">
              <span className={changeColor}>
                {changeCents >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(changeCents))} ({fmtPct(Math.abs(changePct))})
              </span>
              <span className="font-normal text-muted-foreground">· {RANGE_LABEL[range]}</span>
            </div>
          </>
        )}
      </div>

      {/* Chart */}
      <div className="mt-6">
        {loading ? (
          <div className="h-[200px] animate-pulse rounded-2xl bg-muted" />
        ) : data[0].length < 2 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-center text-sm text-muted-foreground">
            <span>Your equity curve is taking shape.</span>
            <span className="text-xs">It fills in as snapshots are recorded during market hours.</span>
          </div>
        ) : (
          <>
            {/* Floating timestamp label, tracking the cursor x. */}
            <div className="relative h-4">
              {hoverDate && (
                <span
                  className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-muted-foreground"
                  style={{ left: hover!.left }}
                >
                  {hoverDate}
                </span>
              )}
            </div>
            <UplotChart
              key={`${theme}-${up ? 'u' : 'd'}`}
              data={data}
              series={series}
              opts={opts}
              height={196}
              onHover={(val, left) => {
                if (val == null) setHover(null);
                else setHover({ idx: val, left: left ?? 0 });
              }}
            />
          </>
        )}
      </div>

      {/* Range selector */}
      <div className="mt-4">
        <RangeTabs value={range} onChange={(r) => { setRange(r); setHover(null); }} />
      </div>
    </section>
  );
}
