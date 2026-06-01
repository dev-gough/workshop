'use client';

import type { AlignedData } from 'uplot';
import UplotChart from './uplot-chart';

export interface SparklineProps {
  /** Values aligned with `xs`. Nulls are gaps. */
  ys: Array<number | null>;
  /** Unix seconds, same length as ys. */
  xs: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  className?: string;
}

/**
 * Tiny inline chart for service rows and process explorer cells. Single series,
 * no axes, no legend, no cursor. Renders a thin filled line.
 */
export default function Sparkline({ ys, xs, width = 80, height = 24, color, fill, className }: SparklineProps) {
  if (xs.length < 2) {
    return <div className={className} style={{ width, height, opacity: 0.3 }} />;
  }
  const data: AlignedData = [xs, ys];
  return (
    <div className={className} style={{ width, height, display: 'inline-block' }}>
      <UplotChart
        spark
        height={height}
        data={data}
        series={[
          {},
          {
            stroke: color ?? 'var(--primary)',
            fill: fill ?? 'color-mix(in oklab, var(--primary) 12%, transparent)',
            width: 1.25,
            points: { show: false },
          },
        ]}
      />
    </div>
  );
}
