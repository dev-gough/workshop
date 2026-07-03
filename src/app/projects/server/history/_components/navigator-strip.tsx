'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMetrics } from '../_lib/use-metrics';
import { alignFields } from '../_lib/align';
import UplotChart from '@/components/charts/uplot-chart';
import type { Series } from 'uplot';

interface NavigatorStripProps {
  /** Currently-selected window (highlighted in maroon). Unix ms. */
  fromMs: number;
  toMs: number;
  /** Called when the user drags out a new window. Unix ms. */
  onSelect: (fromMs: number, toMs: number) => void;
  /** How far back the strip shows. Defaults to 30 days. */
  retentionDays?: number;
}

/**
 * Full-retention CPU-load chart that the user drags on to pick a window.
 * The currently-selected sub-range is overlaid with a maroon scanline texture.
 */
export default function NavigatorStrip({ fromMs, toMs, onSelect, retentionDays = 30 }: NavigatorStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Strip always shows the full retention window, with the right edge pinned to
  // "now". Re-tick every minute so the edge (and the derived date labels) don't
  // freeze at mount time.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const stripTo = nowMs;
  const stripFrom = stripTo - retentionDays * 86400_000;

  // Coarse data: ~maxPoints across the whole retention window.
  const { data } = useMetrics('system.cpu', stripFrom, stripTo, { maxPoints: 400, liveThresholdMs: 0 });
  const chartData = useMemo(() => alignFields(data, ['load1']), [data]);

  const series: Series[] = useMemo(() => [
    {},
    {
      label: 'load1',
      stroke: 'hsl(184 95% 58%)',
      fill: 'color-mix(in srgb, hsl(184 95% 58%) 14%, transparent)',
      width: 1.25,
      points: { show: false },
    },
  ], []);

  // Observe container width so the scanline overlay can position correctly.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Map the selected window onto x-pixels of the strip.
  const selStartFrac = Math.max(0, Math.min(1, (fromMs - stripFrom) / (stripTo - stripFrom)));
  const selEndFrac = Math.max(0, Math.min(1, (toMs - stripFrom) / (stripTo - stripFrom)));
  const selLeftPx = selStartFrac * containerWidth;
  const selWidthPx = Math.max(2, (selEndFrac - selStartFrac) * containerWidth);

  // Custom drag-to-select on the OVERLAY layer (so we don't fight uPlot's own select).
  const [drag, setDrag] = useState<{ startX: number; curX: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const xToMs = useCallback((x: number) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    const width = rect?.width ?? containerWidth;
    return stripFrom + (x / width) * (stripTo - stripFrom);
  }, [stripFrom, stripTo, containerWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    setDrag({ startX: x, curX: x });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrag((d) => d ? { ...d, curX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)) } : null);
    };
    const onUp = () => {
      setDrag((d) => {
        if (!d) return null;
        if (Math.abs(d.curX - d.startX) < 4) return null; // click, not a drag
        const a = xToMs(Math.min(d.startX, d.curX));
        const b = xToMs(Math.max(d.startX, d.curX));
        onSelect(a, b);
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, xToMs, onSelect]);

  const dragLeft = drag ? Math.min(drag.startX, drag.curX) : 0;
  const dragWidth = drag ? Math.abs(drag.curX - drag.startX) : 0;

  return (
    <div className="cc-card relative overflow-hidden">
      <span className="cc-corner cc-corner-tl" aria-hidden />
      <span className="cc-corner cc-corner-tr" aria-hidden />
      <span className="cc-corner cc-corner-bl" aria-hidden />
      <span className="cc-corner cc-corner-br" aria-hidden />
      <div className="relative z-10 px-4 pt-3 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="cc-led cc-led-ok cc-led-pulse" aria-hidden />
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--cc-dim)]">
            NAVIGATOR · LAST {retentionDays}D · DRAG TO ZOOM
          </div>
        </div>
        <div className="font-mono text-[10px] text-[color:var(--cc-muted)] tabular-nums">
          {new Date(stripFrom).toISOString().slice(0, 10)} → {new Date(stripTo).toISOString().slice(0, 10)}
        </div>
      </div>
      <div ref={containerRef} className="relative z-10 px-2 pb-2">
        <UplotChart
          data={chartData.data}
          series={series}
          height={64}
          opts={{
            axes: [
              {
                stroke: 'var(--muted-foreground)',
                grid: { stroke: 'var(--color-grid)', width: 1 },
                ticks: { show: false },
                size: 22,
              },
              { show: false },
            ],
            legend: { show: false },
            padding: [4, 8, 0, 8],
            cursor: { show: false },
          }}
        />
        {/* Selection scanline overlay */}
        {selWidthPx > 0 && containerWidth > 0 && (
          <div
            className="pointer-events-none absolute top-0 bottom-0"
            style={{
              left: `${selLeftPx + 8}px`,
              width: `${selWidthPx}px`,
              background:
                'repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-brand-maroon) 22%, transparent) 0, color-mix(in oklab, var(--color-brand-maroon) 22%, transparent) 2px, transparent 2px, transparent 6px)',
              borderLeft: '1px solid var(--color-brand-maroon)',
              borderRight: '1px solid var(--color-brand-maroon)',
              boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-brand-darkmaroon) 30%, transparent)',
            }}
          />
        )}
        {/* Drag interaction layer */}
        <div
          ref={overlayRef}
          className="absolute inset-0 left-2 right-2 cursor-crosshair"
          onMouseDown={onMouseDown}
        >
          {dragWidth > 2 && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 bg-primary/15 border-x border-primary/60"
              style={{ left: `${dragLeft}px`, width: `${dragWidth}px` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
