// Pure expense-splitting utilities. v1 only supports equal splits;
// other modes (exact, percentage, shares, adjustments) come in v2.

export interface Share {
  userId: number;
  shareCents: number;
}

export interface SettlementBalance {
  id: number;
  balanceCents: string;
}

export interface Settlement {
  fromUserId: number;
  toUserId: number;
  amountCents: string;
}

export interface GroupSummaryRow {
  balance_cents?: string | number | bigint | null;
  [key: string]: unknown;
}

/**
 * Split totalCents evenly across userIds. Distributes any remainder cents
 * one-by-one to the first N users so the sum always equals totalCents exactly.
 */
export function splitEqual(totalCents: number, userIds: number[]): Share[] {
  const n = userIds.length;
  if (n === 0) return [];
  if (totalCents <= 0) {
    return userIds.map((userId) => ({ userId, shareCents: 0 }));
  }
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return userIds.map((userId, i) => ({
    userId,
    shareCents: base + (i < remainder ? 1 : 0),
  }));
}

function centsString(value: string | number | bigint | null | undefined): string {
  if (value == null) return '0';
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || !Number.isInteger(value))) {
    throw new Error('cents must be a safe integer');
  }
  const normalized = String(value);
  if (!/^-?\d+$/.test(normalized)) throw new Error('cents must be an integer');
  return BigInt(normalized).toString();
}

/**
 * Normalize PostgreSQL aggregate rows for JSON. BIGINT values remain decimal
 * strings, avoiding precision loss when the response reaches JavaScript.
 */
export function shapeGroupSummaries<T extends GroupSummaryRow>(
  rows: T[],
): Array<Omit<T, 'balance_cents'> & { balance_cents: string }> {
  return rows.map((row) => ({
    ...row,
    balance_cents: centsString(row.balance_cents),
  }));
}

/**
 * Find a minimum-transfer settlement using only debtor → creditor payments.
 *
 * The search considers every counterparty when one side is exhausted. This is
 * exponential in the number of non-zero balances, which is appropriate for
 * the small friend groups SplitWiser serves, and memoization removes repeated
 * states. Ties are deterministic by user id.
 */
export function minimalSettlements(input: SettlementBalance[]): Settlement[] {
  const totals = new Map<number, bigint>();
  for (const balance of input) {
    totals.set(balance.id, (totals.get(balance.id) ?? 0n) + BigInt(centsString(balance.balanceCents)));
  }

  const entries = [...totals.entries()].sort(([a], [b]) => a - b);
  const sum = entries.reduce((total, [, balance]) => total + balance, 0n);
  if (sum !== 0n) throw new Error('balances must sum to zero');

  const debtors = entries
    .filter(([, balance]) => balance < 0n)
    .map(([id, balance]) => ({ id, amount: -balance }));
  const creditors = entries
    .filter(([, balance]) => balance > 0n)
    .map(([id, amount]) => ({ id, amount }));
  const memo = new Map<string, Settlement[] | null>();

  function solve(debts: bigint[], credits: bigint[]): Settlement[] | null {
    const debtorIndex = debts.findIndex((amount) => amount > 0n);
    if (debtorIndex === -1) return [];

    const key = `${debts.join(',')}|${credits.join(',')}`;
    if (memo.has(key)) return memo.get(key)!;

    let best: Settlement[] | null = null;
    const seenCreditAmounts = new Set<string>();
    for (let creditorIndex = 0; creditorIndex < credits.length; creditorIndex += 1) {
      if (credits[creditorIndex] === 0n) continue;
      const creditKey = credits[creditorIndex].toString();
      if (seenCreditAmounts.has(creditKey)) continue;
      seenCreditAmounts.add(creditKey);

      const amount = debts[debtorIndex] < credits[creditorIndex]
        ? debts[debtorIndex]
        : credits[creditorIndex];
      const nextDebts = [...debts];
      const nextCredits = [...credits];
      nextDebts[debtorIndex] -= amount;
      nextCredits[creditorIndex] -= amount;
      const rest = solve(nextDebts, nextCredits);
      if (!rest) continue;

      const candidate: Settlement[] = [{
        fromUserId: debtors[debtorIndex].id,
        toUserId: creditors[creditorIndex].id,
        amountCents: amount.toString(),
      }, ...rest];
      if (!best || candidate.length < best.length) best = candidate;
    }

    memo.set(key, best);
    return best;
  }

  return solve(
    debtors.map(({ amount }) => amount),
    creditors.map(({ amount }) => amount),
  ) ?? [];
}
