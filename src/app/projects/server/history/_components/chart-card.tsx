'use client';

import type { ReactNode } from 'react';

export type CardStatus = 'ok' | 'warn' | 'crit' | 'idle';

interface ChartCardProps {
  label: string;
  value?: string;
  sub?: string;
  /** Right-aligned secondary value (e.g. peak, avg, bucket). */
  badge?: string;
  /** LED color in the header. */
  status?: CardStatus;
  /** Accent color for the big number (CSS color string, e.g. 'var(--cc-cyan)'). */
  accent?: string;
  children: ReactNode;
  className?: string;
}

export default function ChartCard({
  label,
  value,
  sub,
  badge,
  status = 'idle',
  accent,
  children,
  className,
}: ChartCardProps) {
  return (
    <div className={`cc-card ${className ?? ''}`}>
      <span className="cc-corner cc-corner-tl" aria-hidden />
      <span className="cc-corner cc-corner-tr" aria-hidden />
      <span className="cc-corner cc-corner-bl" aria-hidden />
      <span className="cc-corner cc-corner-br" aria-hidden />

      <div className="relative z-10 px-4 pt-3 pb-2 flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`cc-led cc-led-${status} ${status !== 'idle' ? 'cc-led-pulse' : ''}`} aria-hidden />
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--cc-dim)] truncate">
              {label}
            </div>
          </div>
          {value && (
            <div
              className="cc-readout text-3xl leading-none truncate"
              style={{ color: accent ?? 'var(--cc-text)' }}
            >
              {value}
            </div>
          )}
          {sub && (
            <div className="text-[11px] font-mono text-[color:var(--cc-muted)] tabular-nums truncate">
              {sub}
            </div>
          )}
        </div>
        {badge && (
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-[color:var(--cc-muted)] tabular-nums shrink-0 mt-0.5">
            {badge}
          </div>
        )}
      </div>

      <div className="relative z-10 px-2 pb-2">{children}</div>
    </div>
  );
}
