'use client';

import { useCallback, useRef, useState } from 'react';
import type { AlignedData, Series } from 'uplot';
import UplotChart from '@/components/charts/uplot-chart';

const AXIS_FONT = '10px "JetBrains Mono", ui-monospace, monospace';
const AXIS = 'var(--cc-dim)';
const GRID = 'var(--cc-grid)';

export function rangeFromZero(_u: unknown, _min: number, max: number): [number, number] {
  return [0, max > 0 ? max * 1.08 : 1];
}

/** Short tick labels. Full units stay in the hover plate; the gutter is narrow. */
export function tickBytes(v: number): string {
  if (!Number.isFinite(v)) return '';
  const sign = v < 0 ? '-' : '';
  let n = Math.abs(v);
  const units = ['B', 'K', 'M', 'G', 'T'];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  if (u === 0) return `${sign}${Math.round(n)}`;
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return `${sign}${n.toFixed(digits)}${units[u]}`;
}

export function tickRate(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  return `${tickBytes(v)}/s`;
}

interface InstrumentChartProps {
  data: AlignedData;
  series: Series[];
  height?: number;
  onZoom?: (fromUnix: number, toUnix: number) => void;
  format?: (v: number) => string;
  /** Axis gutter labels. Defaults to `format`. Keep these short — the gutter clips. */
  tickFormat?: (v: number) => string;
  /** Static y range, or a uPlot range function. */
  yRange?: [number, number] | ((u: unknown, min: number, max: number) => [number, number]);
}

interface Hover {
  ts: number;
  idx: number;
  left: number;
}

function seriesLabel(s: Series, i: number): string {
  return typeof s.label === 'string' && s.label ? s.label : `series ${i}`;
}

function seriesColor(s: Series): string {
  return typeof s.stroke === 'string' ? s.stroke : 'var(--cc-cyan)';
}

function nearestIdx(xs: AlignedData[number], ts: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (typeof x !== 'number') continue;
    const d = Math.abs(x - ts);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * One history trace: a vertical hairline on this chart only, and a readout
 * plate that stays on the instrument glass (never the page behind it).
 */
export default function InstrumentChart({
  data,
  series,
  height = 160,
  onZoom,
  format,
  tickFormat,
  yRange,
}: InstrumentChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const onHover = useCallback((ts: number | null, leftPx?: number) => {
    if (ts == null) { setHover(null); return; }
    const xs = data[0] ?? [];
    if (xs.length === 0) { setHover(null); return; }
    setHover({ ts, idx: nearestIdx(xs, ts), left: leftPx ?? 0 });
  }, [data]);

  const rows = series.slice(1).map((s, i) => {
    const ys = data[i + 1] as Array<number | null> | undefined;
    const v = hover && ys ? ys[hover.idx] : null;
    return {
      key: `${seriesLabel(s, i + 1)}-${i}`,
      label: seriesLabel(s, i + 1),
      color: seriesColor(s),
      value: typeof v === 'number' && Number.isFinite(v) ? (format ? format(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : '—',
    };
  });

  const flip = hover != null && wrapRef.current != null && hover.left > wrapRef.current.clientWidth * 0.45;
  const empty = !data[0] || data[0].length === 0;
  const ticks = tickFormat ?? format;

  return (
    <div ref={wrapRef} className="cc-instrument relative">
      <div className="flex flex-nowrap items-center gap-x-3 overflow-hidden px-2 pb-1.5 min-h-[22px]">
        {rows.slice(0, 4).map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5 min-w-0 shrink">
            <span className="h-1.5 w-1.5 shrink-0" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}` }} aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--cc-muted)] truncate">
              {r.label}
            </span>
          </span>
        ))}
        {rows.length > 4 && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--cc-muted)]">
            +{rows.length - 4}
          </span>
        )}
      </div>

      <UplotChart
        data={data}
        series={series}
        height={height}
        onZoom={onZoom}
        onHover={onHover}
        opts={{
          legend: { show: false },
          cursor: { y: false, points: { size: 7, width: 2 } },
          padding: [8, 10, 0, 0],
          scales: {
            x: { time: true },
            ...(yRange ? { y: { range: yRange } } : {}),
          },
          axes: [
            {
              stroke: AXIS,
              grid: { show: false },
              ticks: { stroke: GRID, width: 1 },
              font: AXIS_FONT,
              size: 28,
            },
            {
              stroke: AXIS,
              grid: { stroke: GRID, width: 1 },
              ticks: { show: false },
              font: AXIS_FONT,
              size: 58,
              values: (_u: unknown, splits: number[]) => splits.map((v) => ticks ? ticks(v) : String(Math.round(v))),
            },
          ],
        }}
      />

      {empty && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--cc-muted)]">
          no samples in this window
        </div>
      )}

      {hover && !empty && (
        <div
          className="cc-plot-plate"
          style={flip ? { left: 58, right: 'auto' } : { right: 8, left: 'auto' }}
        >
          <div className="font-mono text-[10px] tabular-nums tracking-[0.08em] text-[color:var(--cc-cyan)] mb-1.5">
            {fmtTime(hover.ts)}
          </div>
          <div className="space-y-1">
            {rows.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3 min-w-0">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span className="h-1.5 w-1.5 shrink-0" style={{ background: r.color }} aria-hidden />
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--cc-dim)] truncate">
                    {r.label}
                  </span>
                </span>
                <span className="cc-readout text-[12px] leading-none text-[color:var(--cc-text)] shrink-0">
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
