'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type uPlot from 'uplot';
import type { AlignedData, Series, Options, Cursor, Axis } from 'uplot';
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

// Canvas fillStyle/strokeStyle cannot resolve var() or color-mix(). Probe an
// element inside the chart so scoped tokens (cc-scope, etc.) compute to rgb.
function resolveCssColor(el: Element, color: string, fallback: string): string {
  if (!color || (!color.includes('var(') && !color.includes('color-mix'))) return color || fallback;
  const probe = document.createElement('span');
  probe.style.color = color;
  el.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)') return fallback;
  return resolved;
}

function resolvePaint(el: Element, value: Series['stroke']): Series['stroke'] {
  if (typeof value !== 'string') return value;
  return resolveCssColor(el, value, value);
}

// Read CSS variables from the chart's container so scoped overrides (e.g. `.cc-scope`)
// reach uPlot. Falls back to sensible dark-mode colors during SSR / first render.
function readThemeColors(el?: Element | null): { primary: string; accent: string; grid: string; axis: string; ok: string; warn: string; chart: string[] } {
  const FB = { primary: '#7b8eff', accent: '#3fd1c2', grid: '#26314a', axis: '#9aa4b8', ok: '#3fbf7f', warn: '#f4b73d', chart: ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa'] };
  if (typeof window === 'undefined' || !el) return FB;
  const cs = getComputedStyle(el);
  const raw = (n: string, fallback: string) => (cs.getPropertyValue(n).trim() || fallback);
  const paint = (n: string, fallback: string) => resolveCssColor(el, raw(n, fallback), fallback);
  return {
    primary: paint('--color-primary', FB.primary),
    accent:  paint('--color-accent',  FB.accent),
    grid:    paint('--color-grid',    FB.grid),
    axis:    paint('--color-muted-foreground', FB.axis),
    ok:      paint('--color-ok',      FB.ok),
    warn:    paint('--color-warn',    FB.warn),
    chart:   [1, 2, 3, 4, 5].map((i, idx) => paint(`--color-chart-${i}`, FB.chart[idx])),
  };
}

function resolveAxis(el: Element, axis: Axis | undefined, theme: ReturnType<typeof readThemeColors>): Axis {
  if (!axis || axis.show === false) return axis ?? {};
  const stroke = typeof axis.stroke === 'string' ? resolveCssColor(el, axis.stroke, theme.axis) : (axis.stroke ?? theme.axis);
  const grid = axis.grid && typeof axis.grid === 'object'
    ? {
        ...axis.grid,
        stroke: typeof axis.grid.stroke === 'string' ? resolveCssColor(el, axis.grid.stroke, theme.grid) : axis.grid.stroke,
      }
    : axis.grid;
  const ticks = axis.ticks && typeof axis.ticks === 'object'
    ? {
        ...axis.ticks,
        stroke: typeof axis.ticks.stroke === 'string' ? resolveCssColor(el, axis.ticks.stroke, theme.grid) : axis.ticks.stroke,
      }
    : axis.ticks;
  return { ...axis, stroke, grid, ticks };
}

export default function UplotChart({
  data, series, opts, height = 200, syncKey, onZoom, onHover, className, spark = false,
}: UplotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onZoomRef = useRef(onZoom);
  const onHoverRef = useRef(onHover);
  onZoomRef.current = onZoom;
  onHoverRef.current = onHover;
  const syncId = useId();
  const [ready, setReady] = useState(false);
  // Bumped by the theme MutationObserver to force a full chart rebuild, since
  // strokes/fills are read from CSS vars at construct time and a bare redraw
  // keeps the stale canvas colors.
  const [themeVersion, setThemeVersion] = useState(0);

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
      stroke: resolvePaint(el, s.stroke ?? (i === 0 ? undefined : theme.chart[(i - 1) % theme.chart.length])),
      fill: resolvePaint(el, s.fill),
      width: s.width ?? 1.5,
    }));

    const user = opts ?? {};
    const {
      cursor: userCursor,
      hooks: userHooks,
      axes: userAxes,
      scales: userScales,
      series: _userSeries,
      width: _w,
      height: _h,
      ...restOpts
    } = user;

    const userCursorOpts = (userCursor ?? {}) as Cursor;
    const baseOpts: Options = {
      ...restOpts,
      width,
      height,
      series: styledSeries,
      // Each chart gets its own cursor channel unless the caller asked to sync.
      // A shared channel is what paints the hairline on charts the pointer isn't over.
      cursor: {
        ...userCursorOpts,
        sync: { key: syncKey ?? syncId, setSeries: false, ...(userCursorOpts.sync ?? {}) },
        points: { show: !spark, ...(userCursorOpts.points ?? {}) },
        bind: {
          ...(userCursorOpts.bind ?? {}),
          // Wrap (don't replace) uPlot's default mouseleave handler, so its
          // own cursor-hiding still runs — otherwise the crosshair line
          // freezes at the edge when the mouse exits left/right.
          mouseleave: (_u, _targ, handler) => (e) => {
            onHoverRef.current?.(null);
            return handler(e);
          },
        },
      } as Cursor,
      scales: { x: { time: true }, ...(userScales ?? {}) },
      axes: (userAxes ?? (spark
        ? [{ show: false }, { show: false }]
        : [
            { stroke: theme.axis, grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid, width: 1 }, font: '11px "JetBrains Mono", ui-monospace, monospace' },
            { stroke: theme.axis, grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid, width: 1 }, font: '11px "JetBrains Mono", ui-monospace, monospace', size: 48 },
          ]
      )).map((axis) => resolveAxis(el, axis, theme)),
      legend: user.legend ?? { show: !spark },
      padding: user.padding ?? (spark ? [2, 2, 2, 2] : [8, 8, 0, 0]),
      hooks: {
        ...userHooks,
        setSelect: [
          ...(userHooks?.setSelect ?? []),
          (u) => {
            const zoom = onZoomRef.current;
            if (!zoom) return;
            const { left, width: w } = u.select;
            if (w < 2) return;
            const fromX = u.posToVal(left, 'x');
            const toX = u.posToVal(left + w, 'x');
            zoom(fromX, toX);
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          },
        ],
        setCursor: [
          ...(userHooks?.setCursor ?? []),
          (u) => {
            const hover = onHoverRef.current;
            if (!hover) return;
            const idx = u.cursor.idx;
            if (idx == null) { hover(null); return; }
            const x = u.data[0][idx];
            hover(typeof x === 'number' ? x : null, u.cursor.left ?? undefined);
          },
        ],
      },
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
    // Rebuilding when series shape (or theme) changes; data-only updates use the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, series.length, height, syncKey, spark, themeVersion]);

  // Cheap data updates (same series shape).
  useEffect(() => {
    if (plotRef.current) plotRef.current.setData(data);
  }, [data]);

  // Theme change listener — bump themeVersion so the build effect above tears the
  // plot down and reconstructs it, re-reading the CSS-var colors. A bare redraw
  // wouldn't pick up new strokes/fills baked in at construct time.
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

  return <div ref={containerRef} className={className} style={{ width: '100%' }} />;
}
