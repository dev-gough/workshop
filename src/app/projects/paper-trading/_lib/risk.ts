export interface RiskPosition {
  symbol: string;
  marketValueCents: number;
  priceCents: number | null;
}

export interface RiskSummary {
  totalValueCents: number;
  investedCents: number;
  investedPct: number;
  cashPct: number;
  positionCount: number;
  unpricedCount: number;
  largestPosition: {
    symbol: string;
    valueCents: number;
    portfolioPct: number;
  } | null;
  concentration: 'low' | 'moderate' | 'high';
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Summarize long-only portfolio exposure from integer-cent values.
 * `marketValueCents` may be cost basis when a quote is unavailable; callers surface
 * that limitation through `unpricedCount`.
 */
export function summarizeRisk(cashCents: number, positions: RiskPosition[]): RiskSummary {
  const cash = Math.max(0, Math.trunc(cashCents));
  const normalized = positions.map((position) => ({
    ...position,
    marketValueCents: Math.max(0, Math.trunc(position.marketValueCents)),
  }));
  const investedCents = normalized.reduce((total, position) => total + position.marketValueCents, 0);
  const totalValueCents = cash + investedCents;
  const largest = normalized.reduce<RiskPosition | null>(
    (current, position) => current == null || position.marketValueCents > current.marketValueCents ? position : current,
    null,
  );
  const largestPct = largest ? percent(largest.marketValueCents, totalValueCents) : 0;

  return {
    totalValueCents,
    investedCents,
    investedPct: percent(investedCents, totalValueCents),
    cashPct: percent(cash, totalValueCents),
    positionCount: normalized.length,
    unpricedCount: normalized.filter((position) => position.priceCents == null).length,
    largestPosition: largest
      ? { symbol: largest.symbol, valueCents: largest.marketValueCents, portfolioPct: largestPct }
      : null,
    concentration: largestPct >= 40 ? 'high' : largestPct >= 20 ? 'moderate' : 'low',
  };
}
