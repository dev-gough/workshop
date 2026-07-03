// Shared formatting helpers for SplitWiser pages.

export function fmtMoney(cents: number | string): string {
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
