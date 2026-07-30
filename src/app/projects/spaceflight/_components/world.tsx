'use client';

// The World Range: every orbital launch family since Sputnik, from the GCAT
// mirror. A cumulative chart (top five under the current dials + Other), the
// Time Machine replay, and the full leaderboard table — all recomputed from
// per-year mass components under the console's mode / accounting / window.

import { useMemo, useRef, useState } from 'react';
import { CumulativeChart, Legend, type ChartSeries } from './charts';
import { TimeMachine } from './race';
import {
  WORLD_OTHER_COLOR,
  assignWorldColors,
  familyColor,
  familyCumulative,
  familyLabel,
  familyTotals,
  fmtTonnes,
  yearValue,
  type Accounting,
  type Mode,
  type WorldFamily,
  type YearRange,
} from '../_lib/model';

const SHOW_DEFAULT = 15;
const CHART_TOP = 5;

export function WorldSection({
  families,
  mode,
  acct,
  range,
  now,
  maxYear,
}: {
  families: WorldFamily[];
  mode: Mode;
  acct: Accounting;
  range: YearRange;
  now: number;
  maxYear: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return families
      .map((f) => ({ f, t: familyTotals(f, mode, acct, range) }))
      .filter((r) => r.t.flights > 0)
      .sort((a, b) => b.t.tonnes - a.t.tonnes);
  }, [families, mode, acct, range]);

  // Colors are seeded by all-time delivered rank and then follow each entity
  // for the whole session: if the dials surface a family that has no color
  // yet, it inherits one from a colored family currently off the chart.
  const colorsRef = useRef<Map<string, string> | null>(null);
  if (colorsRef.current === null) colorsRef.current = assignWorldColors(families);
  const colors = colorsRef.current;
  const top = rows.slice(0, CHART_TOP);
  for (const { f } of top) {
    if (!f.spacex && !colors.has(f.key)) {
      const donor = [...colors.keys()].find((k) => !top.some((r) => r.f.key === k));
      if (donor) {
        colors.set(f.key, colors.get(donor)!);
        colors.delete(donor);
      }
    }
  }

  const chartSeries: ChartSeries[] = useMemo(() => {
    const topKeys = new Set(top.map((r) => r.f.key));
    const byYear = new Map<number, number>();
    let otherCount = 0;
    for (const { f } of rows) {
      if (topKeys.has(f.key)) continue;
      otherCount++;
      for (const r of f.yearly) {
        if (r.y < range[0] || r.y > range[1]) continue;
        byYear.set(r.y, (byYear.get(r.y) ?? 0) + yearValue(r, mode, acct));
      }
    }
    const otherPts = (() => {
      const years = [...byYear.keys()].sort((a, b) => a - b);
      if (years.length === 0) return [];
      const pts = [{ t: Date.UTC(years[0], 0, 1), v: 0 }];
      let cum = 0;
      for (const y of years) {
        cum += byYear.get(y)!;
        pts.push({ t: Date.UTC(y, 11, 31), v: cum });
      }
      return pts;
    })();
    return [
      ...top.map(({ f }) => ({
        key: f.key,
        label: familyLabel(f.key),
        color: familyColor(f, colors),
        pts: familyCumulative(f, mode, acct, range),
      })),
      { key: '__other', label: `Other (${otherCount})`, color: WORLD_OTHER_COLOR, pts: otherPts },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode, acct, range]);

  if (rows.length === 0) return null;

  const chartEnd = Math.min(now, Date.UTC(range[1] + 1, 0, 1));
  const visibleSeries = chartSeries.filter((s) => !hidden.has(s.key));
  const maxT = Math.max(rows[0].t.tonnes, 0.001);
  const visible = showAll ? rows : rows.slice(0, SHOW_DEFAULT);

  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="sf-console mt-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="sf-etch">
            The world range · cumulative tonnes {mode === 'delivered' ? 'to orbit' : 'launched'} ·{' '}
            {range[0]}–{range[1] >= maxYear ? 'present' : range[1]}
          </p>
          <Legend
            items={chartSeries.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
            hidden={hidden}
            onToggle={toggle}
          />
        </div>
        <div className="mt-3">
          <CumulativeChart
            series={visibleSeries}
            now={chartEnd}
            from={Date.UTC(range[0], 0, 1)}
          />
        </div>
      </div>

      <TimeMachine
        families={families}
        mode={mode}
        acct={acct}
        colors={colors}
        minYear={range[0]}
        maxYear={range[1]}
      />

      <div className="sf-console mt-4 p-4 sm:p-5">
        <p className="sf-etch">Launch families · every orbital attempt on the books</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left">
                {['#', 'Family', 'Span', 'Flights', 'Success', `Tonnes ${mode === 'delivered' ? 'to orbit' : 'launched'}`, 't / yr'].map((h) => (
                  <th key={h} className="sf-etch py-2 pr-4 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ f, t }, i) => {
                const span = t.lastYear - t.firstYear + 1;
                return (
                  <tr key={f.key} className="border-b border-border last:border-b-0">
                    <td className="sf-readout py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
                        <span
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: familyColor(f, colors) }}
                        />
                        {familyLabel(f.key)}
                      </span>
                    </td>
                    <td className="sf-readout whitespace-nowrap py-2 pr-4 text-muted-foreground">
                      {t.firstYear}–{t.lastYear >= maxYear ? 'now' : t.lastYear}
                    </td>
                    <td className="sf-readout py-2 pr-4 text-foreground">{t.flights.toLocaleString('en-US')}</td>
                    <td className="sf-readout py-2 pr-4 text-muted-foreground">
                      {((t.successes / Math.max(t.flights, 1)) * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="sf-readout w-[72px] shrink-0 text-right text-foreground">
                          {fmtTonnes(t.tonnes)}
                        </span>
                        <span className="h-1.5 w-[120px] shrink-0 overflow-hidden rounded-[2px] bg-muted">
                          <span
                            className="block h-full rounded-[2px]"
                            style={{
                              width: `${Math.max((t.tonnes / maxT) * 100, t.tonnes > 0 ? 1.5 : 0)}%`,
                              background: familyColor(f, colors),
                            }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="sf-readout py-2 text-muted-foreground">
                      {t.tonnes / span >= 0.05 ? (t.tonnes / span).toFixed(1) : '0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > SHOW_DEFAULT && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="sf-chip mt-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
          >
            {showAll ? 'Show top 15' : `Show all ${rows.length} families`}
          </button>
        )}
      </div>
    </>
  );
}
