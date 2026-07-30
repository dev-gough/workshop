'use client';

// The World Range: every orbital launch family since Sputnik, from the GCAT
// mirror. One cumulative chart (top five by delivered tonnage + Other — the
// series cap is a dataviz rule, not a data limit) and the full leaderboard
// table, which is the sanctioned form for ninety-odd families.

import { useMemo, useState } from 'react';
import { CumulativeChart, Legend, type ChartSeries } from './charts';
import {
  VEHICLE_COLOR,
  WORLD_OTHER_COLOR,
  WORLD_RANK_COLORS,
  familyCumulative,
  familyLabel,
  fmtTonnes,
  worldTonnes,
  type Mode,
  type Vehicle,
  type WorldFamily,
} from '../_lib/model';

const SHOW_DEFAULT = 15;

export function WorldSection({ families, mode, now }: {
  families: WorldFamily[];
  mode: Mode;
  now: number;
}) {
  const [showAll, setShowAll] = useState(false);

  // Chart colors are assigned once, by delivered-tonnage rank, and do not
  // change when the toggle re-sorts the table: color follows the entity.
  const colorByKey = useMemo(() => {
    const ranked = [...families].sort((a, b) => b.tDelivered - a.tDelivered);
    const m = new Map<string, string>();
    ranked.slice(0, 5).forEach((f, i) => m.set(f.key, WORLD_RANK_COLORS[i]));
    return m;
  }, [families]);

  const chartSeries: ChartSeries[] = useMemo(() => {
    const top = [...families].sort((a, b) => b.tDelivered - a.tDelivered).slice(0, 5);
    const topKeys = new Set(top.map((f) => f.key));
    const others = families.filter((f) => !topKeys.has(f.key));
    const byYear = new Map<number, { y: number; del: number; lau: number }>();
    for (const f of others) {
      for (const r of f.yearly) {
        const e = byYear.get(r.y) ?? { y: r.y, del: 0, lau: 0 };
        e.del += r.del;
        e.lau += r.lau;
        byYear.set(r.y, e);
      }
    }
    const otherYearly = [...byYear.values()].sort((a, b) => a.y - b.y);
    return [
      ...top.map((f) => ({
        key: f.key,
        label: familyLabel(f.key),
        color: colorByKey.get(f.key)!,
        pts: familyCumulative(f.yearly, mode),
      })),
      {
        key: '__other',
        label: `Other (${others.length})`,
        color: WORLD_OTHER_COLOR,
        pts: familyCumulative(otherYearly, mode),
      },
    ];
  }, [families, mode, colorByKey]);

  const rows = useMemo(
    () => [...families].sort((a, b) => worldTonnes(b, mode) - worldTonnes(a, mode)),
    [families, mode]
  );
  if (rows.length === 0) return null;
  const maxT = Math.max(worldTonnes(rows[0], mode), 0.001);
  const visible = showAll ? rows : rows.slice(0, SHOW_DEFAULT);

  const chip = (f: WorldFamily) =>
    colorByKey.get(f.key) ??
    (f.spacex ? VEHICLE_COLOR[f.key as Vehicle] : undefined) ??
    WORLD_OTHER_COLOR;

  return (
    <>
      <div className="sf-console mt-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="sf-etch">
            The world range · cumulative tonnes {mode === 'delivered' ? 'to orbit' : 'launched'} ·
            1957–present
          </p>
          <Legend items={chartSeries.map((s) => ({ label: s.label, color: s.color }))} />
        </div>
        <div className="mt-3">
          <CumulativeChart series={chartSeries} now={now} />
        </div>
      </div>

      <div className="sf-console mt-4 p-4 sm:p-5">
        <p className="sf-etch">Launch families · every orbital attempt since Sputnik</p>
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
              {visible.map((f, i) => {
                const t = worldTonnes(f, mode);
                const span = f.lastYear - f.firstYear + 1;
                return (
                  <tr key={f.key} className="border-b border-border last:border-b-0">
                    <td className="sf-readout py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
                        <span
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: chip(f) }}
                        />
                        {familyLabel(f.key)}
                      </span>
                    </td>
                    <td className="sf-readout whitespace-nowrap py-2 pr-4 text-muted-foreground">
                      {f.firstYear}–{f.lastYear >= new Date(now).getUTCFullYear() ? 'now' : f.lastYear}
                    </td>
                    <td className="sf-readout py-2 pr-4 text-foreground">{f.flights.toLocaleString('en-US')}</td>
                    <td className="sf-readout py-2 pr-4 text-muted-foreground">
                      {((f.successes / Math.max(f.flights, 1)) * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="sf-readout w-[72px] shrink-0 text-right text-foreground">
                          {fmtTonnes(t)}
                        </span>
                        <span className="h-1.5 w-[120px] shrink-0 overflow-hidden rounded-[2px] bg-muted">
                          <span
                            className="block h-full rounded-[2px]"
                            style={{ width: `${Math.max((t / maxT) * 100, t > 0 ? 1.5 : 0)}%`, background: chip(f) }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="sf-readout py-2 text-muted-foreground">
                      {t / span >= 0.05 ? (t / span).toFixed(1) : '0'}
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
