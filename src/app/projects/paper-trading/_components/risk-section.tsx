'use client';

import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fmtMoney } from '../_lib/format';
import { summarizeRisk } from '../_lib/risk';
import type { Position } from './holding-row';

const CONCENTRATION_LABEL = {
  low: 'Low concentration',
  moderate: 'Moderate concentration',
  high: 'High concentration',
} as const;

export default function RiskSection({ cashCents, positions }: { cashCents: number; positions: Position[] }) {
  const risk = useMemo(() => summarizeRisk(cashCents, positions), [cashCents, positions]);
  const concentrationClass = risk.concentration === 'high'
    ? 'pt-loss'
    : risk.concentration === 'moderate'
      ? 'text-primary'
      : 'pt-gain';

  return (
    <section className="mb-10" aria-labelledby="risk-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Exposure</p>
          <h2 id="risk-heading" className="ws-serif text-xl font-semibold tracking-tight">Risk snapshot</h2>
        </div>
        <span className={`text-xs font-semibold ${concentrationClass}`}>
          {CONCENTRATION_LABEL[risk.concentration]}
        </span>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${risk.investedPct.toFixed(1)}% invested and ${risk.cashPct.toFixed(1)}% cash`}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, risk.investedPct)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{risk.investedPct.toFixed(1)}% invested</span>
          <span>{risk.cashPct.toFixed(1)}% cash</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Largest position</p>
            {risk.largestPosition ? (
              <>
                <p className="mt-1 font-semibold tabular-nums">
                  {risk.largestPosition.symbol} · {risk.largestPosition.portfolioPct.toFixed(1)}%
                </p>
                <p className="text-[11px] text-muted-foreground">{fmtMoney(risk.largestPosition.valueCents)}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No market exposure</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cash reserve</p>
            <p className="mt-1 font-semibold tabular-nums">{fmtMoney(cashCents)}</p>
            <p className="text-[11px] text-muted-foreground">{risk.positionCount} open position{risk.positionCount === 1 ? '' : 's'}</p>
          </div>
        </div>

        {risk.unpricedCount > 0 && (
          <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {risk.unpricedCount} position{risk.unpricedCount === 1 ? '' : 's'} missing a current quote; cost basis is used for that exposure.
          </p>
        )}
      </div>
    </section>
  );
}
