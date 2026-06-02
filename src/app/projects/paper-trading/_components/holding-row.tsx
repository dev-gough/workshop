'use client';

import { fmtMoney, fmtPct, pnlColor } from '../_lib/format';

export interface Position {
  symbol: string; name: string | null; qty: number; avgCostCents: number;
  priceCents: number | null; marketValueCents: number; unrealizedPnlCents: number;
  unrealizedPnlPct: number; dayChangeCents: number | null;
}

// Warm, brand-adjacent monogram palette — picked deterministically per ticker.
const MONO_COLORS = ['#c8472e', '#e0a82e', '#1f9254', '#2f6fb0', '#8a5cc4', '#c2477f', '#3a9d8f'];
function colorFor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return MONO_COLORS[h % MONO_COLORS.length];
}

function Monogram({ symbol }: { symbol: string }) {
  const color = colorFor(symbol);
  return (
    <span
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
      // 22 = ~13% alpha tint that reads on both warm-light and warm-dark surfaces.
      style={{ backgroundColor: `${color}22`, color }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

export default function HoldingRow({ position, onClick }: { position: Position; onClick: () => void }) {
  const p = position;
  const up = p.unrealizedPnlCents >= 0;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted"
    >
      <Monogram symbol={p.symbol} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-tight">{p.symbol}</div>
        <div className="truncate text-xs text-muted-foreground">
          {p.qty} {p.qty === 1 ? 'share' : 'shares'}{p.name ? ` · ${p.name}` : ''}
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className="font-semibold leading-tight">{fmtMoney(p.marketValueCents)}</div>
        <div className={`text-xs ${pnlColor(p.unrealizedPnlCents)}`}>
          {up ? '▲' : '▼'} {fmtPct(Math.abs(p.unrealizedPnlPct))}
        </div>
      </div>
    </button>
  );
}
