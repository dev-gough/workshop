'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type uPlot from 'uplot';
import type { AlignedData, Series, Options, Cursor } from 'uplot';
import 'uplot/dist/uPlot.min.css';

// Single shared loader so multiple charts don't each fetch the bundle.
let uPlotCtor: typeof uPlot | null = null;
async function loadUplot(): Promise<typeof uPlot> {
  if (uPlotCtor) return uPlotCtor;
  const mod = await import('uplot');
  uPlotCtor = mod.default;
  return uPlotCtor;
}

export interface UplotChartProps {
  data: AlignedData;
  series: Series[];
  /** Override or extend the generated options. Merged on top of theme defaults. */
  opts?: Partial<Options>;
  height?: number;
  /** Charts sharing a syncKey will share their cursors. */
  syncKey?: string;
  /** Called with unix seconds when the user click-drags a window. */
  onZoom?: (fromUnix: number, toUnix: number) => void;
  /** Called continuously as the user hovers; null when leaving. The second
   *  arg is the cursor's pixel offset within the plot, for positioning an
   *  external label/marker. */
  onHover?: (ts: number | null, leftPx?: number) => void;
  className?: string;
  /** Compact preset: no axes, no legend, no cursor. */
  spark?: boolean;
}

// Read CSS variables from the chart's container so scoped overrides (e.g. `.cc-scope`)
// reach uPlot. Falls back to sensible dark-mode colors during SSR / first render.
function readThemeColors(el?: Element | null): { primary: string; accent: string; grid: string; ok: string; warn: string; chart: string[] } {
  const FB = { primary: '#7b8eff', accent: '#3fd1c2', grid: '#26314a', ok: '#3fbf7f', warn: '#f4b73d', chart: ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa'] };
  if (typeof window === 'undefined') return FB;
  const target = el ?? document.documentElement;
  const cs = getComputedStyle(target);
  const v = (n: string, fallback: string) => (cs.getPropertyValue(n).trim() || fallback);
  return {
    primary: v('--color-primary', FB.primary),
    accent:  v('--color-accent',  FB.accent),
    grid:    v('--color-grid',    FB.grid),
    ok:      v('--color-ok',      FB.ok),
    warn:    v('--color-warn',    FB.warn),
    chart:   [1, 2, 3, 4, 5].map((i, idx) => v(`--color-chart-${i}`, FB.chart[idx])),
  };
}

export default function UplotChart({
  data, series, opts, height = 200, syncKey, onZoom, onHover, className, spark = false,
}: UplotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [ready, setReady] = useState(false);

  // Lazy-load uPlot once.
  useEffect(() => { loadUplot().then(() => setReady(true)); }, []);

  // Build/rebuild plot when series shape or readiness changes.
  useEffect(() => {
    if (!ready || !containerRef.current || !uPlotCtor) return;
    const el = containerRef.current;
    const theme = readThemeColors(el);
    const width = el.clientWidth || 600;

    // Inject theme colors into series strokes where unspecified.
    const styledSeries: Series[] = series.map((s, i) => ({
      ...s,
      stroke: s.stroke ?? (i === 0 ? undefined : theme.chart[(i - 1) % theme.chart.length]),
      width: s.width ?? 1.5,
    }));

    const baseOpts: Options = {
      width,
      height,
      series: styledSeries,
      cursor: {
        ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
        points: { show: !spark },
        ...(onHover ? {
          bind: {
            mouseleave: () => () => { onHover(null); return null; },
          },
        } : {}),
      } as Cursor,
      scales: { x: { time: true } },
      axes: spark ? [{ show: false }, { show: false }] : [
        { stroke: 'var(--muted-foreground)', grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid, width: 1 } },
        { stroke: 'var(--muted-foreground)', grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid, width: 1 } },
      ],
      legend: { show: !spark },
      padding: spark ? [2, 2, 2, 2] : [12, 12, 4, 4],
      hooks: {
        setSelect: onZoom ? [(u) => {
          const { left, width: w } = u.select;
          if (w < 2) return;
          const fromX = u.posToVal(left, 'x');
          const toX = u.posToVal(left + w, 'x');
          onZoom(fromX, toX);
          // Clear the selection after firing.
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        }] : [],
        setCursor: onHover ? [(u) => {
          const idx = u.cursor.idx;
          if (idx == null) { onHover(null); return; }
          const x = u.data[0][idx];
          onHover(typeof x === 'number' ? x : null, u.cursor.left);
        }] : [],
      },
      ...opts,
    };

    plotRef.current = new uPlotCtor(baseOpts, data, el);

    const ro = new ResizeObserver(() => {
      if (plotRef.current && el) plotRef.current.setSize({ width: el.clientWidth, height });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // Rebuilding when series shape changes; data-only updates use the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, series.length, height, syncKey, spark]);

  // Cheap data updates (same series shape).
  useEffect(() => {
    if (plotRef.current) plotRef.current.setData(data);
  }, [data]);

  // Theme change listener — repaint by destroying & letting the shape effect rebuild.
  // (Done implicitly on next render; we just expose this for future hooking.)
  const refresh = useCallback(() => { plotRef.current?.redraw(true, true); }, []);
  useEffect(() => {
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, [refresh]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
}
