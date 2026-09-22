'use client';

// The main screen — the firing room's front wall. One display surface; the
// tracking console dials in what it shows: cumulative curves, per-year
// stacks, the time-machine replay, the orbit desk, the ledger, or the per-launch log. The
// screen measures its own body so charts fill whatever height the cockpit
// gives them.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CumulativeChart, Legend, YearlyChart, type ChartSeries, type SeriesDef } from './charts';
import { LaunchLog, VehicleConsole } from './console';
import { FamilyLedger } from './ledger';
import { OrbitDesk } from './orbit-desk';
import { TimeMachine } from './race';
import {
  VEHICLE_COLOR,
  WORLD_OTHER_COLOR,
  assignWorldColors,
  cumulativeSeries,
  familyColor,
  familyCumulative,
  familyLabel,
  familyYearRows,
  yearValue,
  yearlyTotals,
  type Accounting,
  type Display,
  type Launch,
  type Mode,
  type RankedFamily,
  type Scope,
  type Vehicle,
  type VehicleStats,
  type WorldFamily,
  type YearRange,
} from '../_lib/model';

const CHART_TOP = 5;

function useSize(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) =>
      setSize({ w: entries[0].contentRect.width, h: entries[0].contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center">
      <p className="max-w-md text-center text-[12px] text-muted-foreground">{children}</p>
    </div>
  );
}

export function MainScreen({
  scope,
  display,
  mode,
  acct,
  range,
  maxYear,
  rangeEnd,
  launches,
  stats,
  families,
  ranked,
}: {
  scope: Scope;
  display: Display;
  mode: Mode;
  acct: Accounting;
  range: YearRange;
  maxYear: number;
  /** window edge in ms — charts and consoles read as they would in that year */
  rangeEnd: number;
  /** SpaceX launches inside the window (per-launch, LL2) */
  launches: Launch[];
  stats: VehicleStats[];
  /** the world universe (GCAT + SpaceX folded in); [] until loaded */
  families: WorldFamily[];
  ranked: RankedFamily[];
}) {
  // One muted-series set per scope, so silencing Falcon 1 on the SpaceX
  // range doesn't silence anything on the world range.
  const [hiddenWorld, setHiddenWorld] = useState<Set<string>>(new Set());
  const [hiddenX, setHiddenX] = useState<Set<string>>(new Set());
  const hidden = scope === 'world' ? hiddenWorld : hiddenX;
  const toggle = (key: string) =>
    (scope === 'world' ? setHiddenWorld : setHiddenX)((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // World colors are seeded by all-time delivered rank and then follow each
  // entity for the whole session: if the dials surface a family that has no
  // color yet, it inherits one from a colored family currently off the chart.
  const colorsRef = useRef<Map<string, string> | null>(null);
  if (colorsRef.current === null && families.length > 0) {
    colorsRef.current = assignWorldColors(families);
  }
  const colors = colorsRef.current ?? new Map<string, string>();
  const top = ranked.slice(0, CHART_TOP);
  for (const { f } of top) {
    if (!f.spacex && !colors.has(f.key)) {
      const donor = [...colors.keys()].find((k) => !top.some((r) => r.f.key === k));
      if (donor) {
        colors.set(f.key, colors.get(donor)!);
        colors.delete(donor);
      }
    }
  }

  // ── Series universes ──
  const worldDefs: SeriesDef[] = [
    ...top.map(({ f }) => ({
      key: f.key,
      label: familyLabel(f.key),
      color: familyColor(f, colors),
    })),
    {
      key: '__other',
      label: `Other (${Math.max(ranked.length - top.length, 0)})`,
      color: WORLD_OTHER_COLOR,
    },
  ];
  const spacexDefs: SeriesDef[] = stats.map((s) => ({
    key: s.vehicle,
    label: s.vehicle,
    color: VEHICLE_COLOR[s.vehicle as Vehicle],
  }));
  const defs = scope === 'world' ? worldDefs : spacexDefs;

  const worldSeries: ChartSeries[] = useMemo(() => {
    const topKeys = new Set(top.map((r) => r.f.key));
    const byYear = new Map<number, number>();
    for (const { f } of ranked) {
      if (topKeys.has(f.key)) continue;
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
      { ...worldDefs[worldDefs.length - 1], pts: otherPts },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, mode, acct, range]);

  const worldYears = useMemo(() => {
    const topKeys = new Set(ranked.slice(0, CHART_TOP).map((r) => r.f.key));
    return familyYearRows(families, topKeys, mode, acct, range);
  }, [families, ranked, mode, acct, range]);

  const spacexSeries: ChartSeries[] = useMemo(() => {
    const m = cumulativeSeries(launches, mode, acct);
    return stats.map((s) => ({
      key: s.vehicle,
      label: s.vehicle,
      color: VEHICLE_COLOR[s.vehicle as Vehicle],
      pts: m.get(s.vehicle) ?? [],
    }));
  }, [launches, stats, mode, acct]);
  const spacexYears = useMemo(() => yearlyTotals(launches, mode, acct), [launches, mode, acct]);

  // Replay universe: in SpaceX scope only its families, with the window's
  // left edge pulled up to the first flight so play doesn't idle in 1957.
  const replayFamilies = useMemo(
    () => (scope === 'spacex' ? families.filter((f) => f.spacex) : families),
    [scope, families]
  );
  const replayMin = useMemo(() => {
    if (scope !== 'spacex') return range[0];
    let min = Infinity;
    for (const f of replayFamilies) {
      for (const r of f.yearly) if (r.n > 0) min = Math.min(min, r.y);
    }
    return min === Infinity ? range[0] : Math.max(range[0], min);
  }, [scope, replayFamilies, range]);

  // ── Title ──
  const modeWord = mode === 'delivered' ? 'to orbit' : 'launched';
  const scopeWord = scope === 'spacex' ? 'SpaceX' : 'The world range';
  const windowWord = `${range[0]}–${range[1] >= maxYear ? 'present' : range[1]}`;
  const title = {
    cumulative: `${scopeWord} · cumulative tonnes ${modeWord} · ${windowWord}`,
    yearly: `${scopeWord} · tonnes ${modeWord} per year · ${windowWord}`,
    replay: `${scopeWord} · the time machine · standings, tonnes ${
      mode === 'delivered' ? 'in orbit' : 'launched'
    }`,
    orbit: 'Orbit desk · ideal mission transfer planner',
    ledger:
      scope === 'world'
        ? `Launch families · every orbital attempt on the books · ${windowWord}`
        : `Vehicle consoles · the SpaceX range · ${windowWord}`,
    log: `Launch log · ${launches.length.toLocaleString('en-US')} flights in window`,
  }[display];

  const legendOn = display === 'cumulative' || display === 'yearly';

  const [bodyRef, size] = useSize();
  // Fill exactly what the cockpit gives us; 280 only before first measure.
  const chartH = size.h > 0 ? size.h : 280;

  // ── Body ──
  let body: ReactNode;
  if (display === 'orbit') {
    body = <OrbitDesk />;
  } else if (scope === 'world' && families.length === 0) {
    body = (
      <Empty>
        The world range is offline — the GCAT mirror didn&apos;t answer. The SpaceX range still
        tracks.
      </Empty>
    );
  } else if (scope === 'spacex' && stats.length === 0 && display !== 'replay') {
    body = (
      <Empty>
        No SpaceX flights inside this window — Falcon 1 first flew in 2006. Widen the window, or
        dial Tracking to The World.
      </Empty>
    );
  } else {
    switch (display) {
      case 'cumulative':
        body = (
          <CumulativeChart
            series={(scope === 'world' ? worldSeries : spacexSeries).filter(
              (s) => !hidden.has(s.key)
            )}
            now={rangeEnd}
            from={scope === 'world' ? Date.UTC(range[0], 0, 1) : undefined}
            height={chartH}
          />
        );
        break;
      case 'yearly':
        body = (
          <YearlyChart
            rows={scope === 'world' ? worldYears : spacexYears}
            series={defs.filter((d) => !hidden.has(d.key))}
            height={chartH}
          />
        );
        break;
      case 'replay':
        body = (
          <TimeMachine
            families={replayFamilies}
            mode={mode}
            acct={acct}
            colors={colors}
            minYear={replayMin}
            maxYear={range[1]}
          />
        );
        break;
      case 'ledger':
        body =
          scope === 'world' ? (
            <div className="h-full overflow-y-auto overflow-x-auto">
              <FamilyLedger ranked={ranked} colors={colors} mode={mode} maxYear={maxYear} />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="grid gap-3 sm:grid-cols-2">
                {stats.map((s) => (
                  <VehicleConsole key={s.vehicle} s={s} mode={mode} />
                ))}
              </div>
            </div>
          );
        break;
      case 'log':
        body = (
          <div className="h-full overflow-y-auto pr-1">
            <LaunchLog launches={launches} mode={mode} acct={acct} />
          </div>
        );
        break;
    }
  }

  return (
    <div className="sf-console flex min-h-0 flex-1 flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="sf-etch">{title}</p>
        {legendOn && defs.length > 0 && (
          <Legend
            items={defs.map((d) => ({ key: d.key, label: d.label, color: d.color }))}
            hidden={hidden}
            onToggle={toggle}
          />
        )}
      </div>
      <div ref={bodyRef} className="mt-3 min-h-[320px] flex-1 overflow-hidden lg:min-h-[180px]">
        {body}
      </div>
    </div>
  );
}
