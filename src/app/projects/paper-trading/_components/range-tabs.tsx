'use client';

import { motion } from 'motion/react';

export type Range = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

export const RANGES: Range[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

/** Lookback windows in seconds; ALL is unbounded. */
export const RANGE_SECONDS: Record<Range, number> = {
  '1D': 86_400,
  '1W': 7 * 86_400,
  '1M': 30 * 86_400,
  '3M': 90 * 86_400,
  '1Y': 365 * 86_400,
  ALL: Infinity,
};

export const RANGE_LABEL: Record<Range, string> = {
  '1D': 'Today',
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  '1Y': 'Past year',
  ALL: 'All time',
};

export default function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex items-center gap-1">
      {RANGES.map((r) => {
        const active = r === value;
        return (
          <button key={r} onClick={() => onChange(r)}
            className="relative isolate rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{ color: active ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)' }}>
            {active && (
              <motion.span layoutId="pt-range-pill" className="absolute inset-0 -z-10 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }} />
            )}
            {r}
          </button>
        );
      })}
    </div>
  );
}
