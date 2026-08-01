'use client';

// The two plots on the firing-room wall. Hand-rolled SVG, following the
// house dataviz rules: 2px lines, recessive grid, 2px surface gaps between
// stacked segments, legend + selective direct labels (never every point),
// crosshair/tooltip hover on both.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { fmtTonnes, type CumPoint, type YearRow } from '../_lib/model';

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A named, colored series — the unit both charts and the legend speak. */
export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface ChartSeries extends SeriesDef {
  pts: CumPoint[];
}

export function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: Array<{ key?: string; label: string; color: string }>;
  /** keys currently muted — chips render dimmed */
  hidden?: Set<string>;
  /** when present the legend is interactive: click a chip to mute/unmute */
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => {
        const k = it.key ?? it.label;
        const off = hidden?.has(k) ?? false;
        const inner = (
          <>
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: off ? 'transparent' : it.color, boxShadow: `inset 0 0 0 1.5px ${it.color}` }}
            />
            {it.label}
          </>
        );
        return onToggle ? (
          <button
            key={k}
            onClick={() => onToggle(k)}
            aria-pressed={!off}
            title={off ? 'Show series' : 'Hide series'}
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-opacity hover:text-foreground"
            style={{ opacity: off ? 0.45 : 1 }}
          >
            {inner}
          </button>
        ) : (
          <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

// ── Cumulative tonnage ──────────────────────────────────────────────────────

interface CumProps {
  series: ChartSeries[];
  now: number;
  /** override the left edge of the time axis (year-window start) */
  from?: number;
  /** fill height (the main screen measures its body); defaults to 300 */
  height?: number;
}

export function CumulativeChart({ series, now, from, height }: CumProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null); // ms epoch

  const H = Math.max(height ?? 300, 200);
  const pad = { l: 46, r: 96, t: 12, b: 26 };
  const iw = Math.max(width - pad.l - pad.r, 50);
  const ih = H - pad.t - pad.b;

  const all = series.map((s) => s.pts).filter((p) => p.length > 0);
  if (all.length === 0) {
    return (
      <div ref={ref} className="flex h-[120px] items-center justify-center">
        <p className="text-[11px] text-muted-foreground">No series in view — everything is muted or out of window.</p>
      </div>
    );
  }
  const t0 = from ?? Math.min(...all.map((p) => p[0].t));
  const t1 = now;
  const vMax = niceMax(Math.max(...all.map((p) => p[p.length - 1].v)));

  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => pad.t + ih - (v / vMax) * ih;

  // Step-after path: tonnage arrives in discrete launches.
  const path = (pts: CumPoint[]) => {
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += `H${x(pts[i].t).toFixed(1)}V${y(pts[i].v).toFixed(1)}`;
    }
    d += `H${x(t1).toFixed(1)}`; // hold the current total to "now"
    return d;
  };

  const valueAt = (pts: CumPoint[], t: number): number => {
    if (t < pts[0].t) return 0;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return pts[lo].v;
  };

  // Direct labels at line ends, nudged apart when lines converge.
  const ends = series
    .filter((s) => s.pts.length > 0)
    .map((s) => ({ s, y: y(s.pts[s.pts.length - 1].v) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  }
  // …then clamp the cluster back inside the plot (the three low lines all
  // converge on the baseline, which would otherwise push labels off-canvas).
  ends[ends.length - 1].y = Math.min(ends[ends.length - 1].y, pad.t + ih);
  for (let i = ends.length - 2; i >= 0; i--) {
    ends[i].y = Math.min(ends[i].y, ends[i + 1].y - 13);
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vMax);
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const span = y1 - y0;
  const step = span > 50 ? 10 : span > 25 ? 5 : width < 640 ? 4 : 2;
  const xTicks: number[] = [];
  for (let yy = Math.ceil(y0 / step) * step; yy <= y1; yy += step) {
    xTicks.push(Date.UTC(yy, 0, 1));
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < pad.l || px > pad.l + iw) return setHover(null);
    setHover(t0 + ((px - pad.l) / iw) * (t1 - t0));
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Cumulative tonnage to orbit over time, by vehicle"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={pad.l}
                x2={pad.l + iw}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--sf-line)"
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y(v) + 3}
                textAnchor="end"
                className="sf-readout"
                fontSize={10}
                fill="var(--sf-faint)"
              >
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={t}
              x={x(t)}
              y={H - 8}
              textAnchor="middle"
              className="sf-readout"
              fontSize={10}
              fill="var(--sf-faint)"
            >
              {new Date(t).getUTCFullYear()}
            </text>
          ))}

          {series.map((s) =>
            s.pts.length > 0 ? (
              <path
                key={s.key}
                d={path(s.pts)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : null
          )}

          {ends.map((e) => (
            <g key={e.s.key}>
              <rect
                x={pad.l + iw + 5}
                y={e.y - 4}
                width={7}
                height={7}
                rx={1.5}
                fill={e.s.color}
              />
              <text
                x={pad.l + iw + 16}
                y={e.y + 3}
                fontSize={10}
                fill="var(--sf-dim)"
              >
                {e.s.label}
              </text>
            </g>
          ))}

          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={pad.t + ih}
              stroke="var(--sf-faint)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>
      )}

      {hover !== null && width > 0 && (
        <div
          className="sf-console pointer-events-none absolute z-10 px-3 py-2"
          style={{
            left: Math.min(x(hover) + 12, width - 190),
            top: 8,
            width: 178,
          }}
        >
          <p className="sf-readout text-[10px] text-muted-foreground">{fmtDay(hover)}</p>
          {series.map((s) =>
            s.pts.length > 0 ? (
              <p key={s.key} className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="sf-readout text-foreground">{fmtTonnes(valueAt(s.pts, hover))}</span>
              </p>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

// ── Tonnage per year ────────────────────────────────────────────────────────

export function YearlyChart({
  rows,
  series,
  height,
}: {
  rows: YearRow[];
  /** visible series in stack order (bottom → top) */
  series: SeriesDef[];
  height?: number;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null); // year

  if (rows.length === 0 || series.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center">
        <p className="text-[11px] text-muted-foreground">
          No flights in view — everything is muted or out of window.
        </p>
      </div>
    );
  }

  const H = Math.max(height ?? 260, 180);
  const pad = { l: 46, r: 8, t: 20, b: 26 };
  const iw = Math.max(width - pad.l - pad.r, 50);
  const ih = H - pad.t - pad.b;

  const sumRow = (r: YearRow) => series.reduce((s, d) => s + (r.by[d.key] ?? 0), 0);
  const vMax = niceMax(Math.max(...rows.map(sumRow), 1));
  const slot = iw / rows.length;
  const barW = Math.max(Math.min(slot * 0.62, 26), 3);
  const y = (v: number) => pad.t + ih - (v / vMax) * ih;
  const peak = rows.reduce((a, b) => (sumRow(b) > sumRow(a) ? b : a), rows[0]);

  const yTicks = [0, 0.5, 1].map((f) => f * vMax);
  // Long windows label decades; short ones every 2–4 years.
  const labelStep = rows.length > 48 ? 10 : rows.length > 24 ? 5 : width < 560 ? 4 : 2;
  const hovered = hover !== null ? rows.find((r) => r.year === hover) : null;
  const hoverX = hover !== null ? pad.l + (hover - rows[0].year) * slot + slot / 2 : 0;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Tonnage to orbit per year, stacked by vehicle"
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke="var(--sf-line)" />
              <text
                x={pad.l - 6}
                y={y(v) + 3}
                textAnchor="end"
                className="sf-readout"
                fontSize={10}
                fill="var(--sf-faint)"
              >
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
              </text>
            </g>
          ))}

          {rows.map((r, i) => {
            const cx = pad.l + i * slot + slot / 2;
            let cursor = pad.t + ih;
            const segs = series.flatMap((d) => {
              const t = r.by[d.key] ?? 0;
              if (t <= 0) return [];
              const h = Math.max((t / vMax) * ih, 1);
              const seg = { key: d.key, color: d.color, top: cursor - h, h };
              cursor -= h + 2; // 2px surface gap between stacked segments
              return [seg];
            });
            const last = segs[segs.length - 1];
            return (
              <g key={r.year}>
                {segs.map((s) => (
                  <rect
                    key={s.key}
                    x={cx - barW / 2}
                    y={s.top}
                    width={barW}
                    height={s.h}
                    rx={s === last ? 2 : 0} // rounded data-end, squared at baseline
                    fill={s.color}
                  />
                ))}
                {r.year === peak.year && sumRow(r) > 0 && (
                  <text
                    x={cx}
                    y={(last?.top ?? pad.t + ih) - 5}
                    textAnchor="middle"
                    className="sf-readout"
                    fontSize={10}
                    fill="var(--sf-dim)"
                  >
                    {Math.round(sumRow(r)).toLocaleString('en-US')}
                  </text>
                )}
                {r.year % labelStep === 0 && (
                  <text
                    x={cx}
                    y={H - 8}
                    textAnchor="middle"
                    className="sf-readout"
                    fontSize={10}
                    fill="var(--sf-faint)"
                  >
                    {String(r.year).slice(2)}
                  </text>
                )}
                <rect
                  x={pad.l + i * slot}
                  y={pad.t}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={() => setHover(r.year)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {hovered && (
        <div
          className="sf-console pointer-events-none absolute z-10 px-3 py-2"
          style={{ left: Math.min(Math.max(hoverX - 80, 0), width - 170), top: 2, width: 164 }}
        >
          <p className="sf-readout text-[10px] text-muted-foreground">{hovered.year}</p>
          {series
            .filter((d) => (hovered.by[d.key] ?? 0) > 0)
            .map((d) => (
              <p key={d.key} className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: d.color }} />
                  <span className="truncate">{d.label}</span>
                </span>
                <span className="sf-readout text-foreground">{fmtTonnes(hovered.by[d.key]!)}</span>
              </p>
            ))}
          <p className="mt-1.5 flex items-center justify-between gap-3 border-t border-border pt-1 text-[11px]">
            <span className="text-muted-foreground">Total</span>
            <span className="sf-readout text-foreground">{fmtTonnes(sumRow(hovered))}</span>
          </p>
        </div>
      )}
    </div>
  );
}
