// Formatting helpers for the paper-trading UI. All inputs are integer cents.

export function fmtMoney(cents: number, opts: { sign?: boolean } = {}): string {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = neg ? '-$' : opts.sign ? '+$' : '$';
  return `${prefix}${body}`;
}

export function fmtPct(pct: number, opts: { sign?: boolean } = {}): string {
  const s = pct.toFixed(2);
  if (opts.sign && pct > 0) return `+${s}%`;
  return `${s}%`;
}

/** Text color class for a P&L value (token-driven via the .ws-theme scope). */
export function pnlColor(cents: number): string {
  if (cents > 0) return 'pt-gain';
  if (cents < 0) return 'pt-loss';
  return 'text-muted-foreground';
}

export function fmtDateTime(iso: string | number): string {
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
