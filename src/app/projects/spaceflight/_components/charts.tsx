'use client';

// The two plots on the firing-room wall. Hand-rolled SVG, following the
// house dataviz rules: 2px lines, recessive grid, 2px surface gaps between
// stacked segments, legend + selective direct labels (never every point),
// crosshair/tooltip hover on both.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  VEHICLES,
  VEHICLE_COLOR,
  fmtTonnes,
  type CumPoint,
  type Vehicle,
  type YearRow,
} from '../_lib/model';

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

export function Legend({ vehicles }: { vehicles: Vehicle[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {vehicles.map((v) => (
        <span key={v} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: VEHICLE_COLOR[v] }}
          />
          {v}
        </span>
      ))}
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
  series: Map<Vehicle, CumPoint[]>;
  now: number;
}

export function CumulativeChart({ series, now }: CumProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null); // ms epoch

  const H = 300;
  const pad = { l: 46, r: 96, t: 12, b: 26 };
  const iw = Math.max(width - pad.l - pad.r, 50);
  const ih = H - pad.t - pad.b;

  const all = [...series.values()];
  const t0 = Math.min(...all.map((p) => p[0].t));
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
  const ends = [...series.entries()]
    .map(([v, pts]) => ({ vehicle: v, v: pts[pts.length - 1].v, y: y(pts[pts.length - 1].v) }))
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
  const step = width < 640 ? 4 : 2;
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

          {VEHICLES.map((v) => {
            const pts = series.get(v);
            if (!pts) return null;
            return (
              <path
                key={v}
                d={path(pts)}
                fill="none"
                stroke={VEHICLE_COLOR[v]}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            );
          })}

          {ends.map((e) => (
            <g key={e.vehicle}>
              <rect
                x={pad.l + iw + 5}
                y={e.y - 4}
                width={7}
                height={7}
                rx={1.5}
                fill={VEHICLE_COLOR[e.vehicle]}
              />
              <text
                x={pad.l + iw + 16}
                y={e.y + 3}
                fontSize={10}
                fill="var(--sf-dim)"
              >
                {e.vehicle}
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
          {[...series.entries()].map(([v, pts]) => (
            <p key={v} className="mt-1 flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: VEHICLE_COLOR[v] }} />
                {v}
              </span>
              <span className="sf-readout text-foreground">{fmtTonnes(valueAt(pts, hover))}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tonnage per year ────────────────────────────────────────────────────────

export function YearlyChart({ rows }: { rows: YearRow[] }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null); // year

  const H = 260;
  const pad = { l: 46, r: 8, t: 20, b: 26 };
  const iw = Math.max(width - pad.l - pad.r, 50);
  const ih = H - pad.t - pad.b;

  const vMax = niceMax(Math.max(...rows.map((r) => r.total), 1));
  const slot = iw / rows.length;
  const barW = Math.max(Math.min(slot * 0.62, 26), 3);
  const y = (v: number) => pad.t + ih - (v / vMax) * ih;
  const peak = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0]);

  const yTicks = [0, 0.5, 1].map((f) => f * vMax);
  const labelStep = width < 560 ? 4 : 2;
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
            const segs = VEHICLES.flatMap((v) => {
              const t = r.byVehicle[v] ?? 0;
              if (t <= 0) return [];
              const h = Math.max((t / vMax) * ih, 1);
              const seg = { v, top: cursor - h, h };
              cursor -= h + 2; // 2px surface gap between stacked segments
              return [seg];
            });
            const last = segs[segs.length - 1];
            return (
              <g key={r.year}>
                {segs.map((s) => (
                  <rect
                    key={s.v}
                    x={cx - barW / 2}
                    y={s.top}
                    width={barW}
                    height={s.h}
                    rx={s === last ? 2 : 0} // rounded data-end, squared at baseline
                    fill={VEHICLE_COLOR[s.v]}
                  />
                ))}
                {r.year === peak.year && r.total > 0 && (
                  <text
                    x={cx}
                    y={(last?.top ?? pad.t + ih) - 5}
                    textAnchor="middle"
                    className="sf-readout"
                    fontSize={10}
                    fill="var(--sf-dim)"
                  >
                    {Math.round(r.total).toLocaleString('en-US')}
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
          {VEHICLES.filter((v) => (hovered.byVehicle[v] ?? 0) > 0).map((v) => (
            <p key={v} className="mt-1 flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: VEHICLE_COLOR[v] }} />
                {v}
              </span>
              <span className="sf-readout text-foreground">{fmtTonnes(hovered.byVehicle[v]!)}</span>
            </p>
          ))}
          <p className="mt-1.5 flex items-center justify-between gap-3 border-t border-border pt-1 text-[11px]">
            <span className="text-muted-foreground">Total</span>
            <span className="sf-readout text-foreground">{fmtTonnes(hovered.total)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
