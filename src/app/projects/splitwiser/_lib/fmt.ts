// Shared formatting helpers for SplitWiser pages.

export function fmtMoney(cents: number | string | bigint): string {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : '';
  return `${sign}$${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function fmtCentsInput(cents: string | bigint): string {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
