// Pure expense-splitting utilities. v1 only supports equal splits;
// other modes (exact, percentage, shares, adjustments) come in v2.

export interface Share {
  userId: number;
  shareCents: number;
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
