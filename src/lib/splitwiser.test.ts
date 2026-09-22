import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minimalSettlements, shapeGroupSummaries } from './splitwiser';

describe('minimalSettlements', () => {
  it('finds the two-payment solution instead of taking the first greedy match', () => {
    const result = minimalSettlements([
      { id: 1, balanceCents: '-600' },
      { id: 2, balanceCents: '-400' },
      { id: 3, balanceCents: '400' },
      { id: 4, balanceCents: '600' },
    ]);

    assert.deepEqual(result, [
      { fromUserId: 1, toUserId: 4, amountCents: '600' },
      { fromUserId: 2, toUserId: 3, amountCents: '400' },
    ]);
  });

  it('preserves cents larger than Number.MAX_SAFE_INTEGER', () => {
    const huge = '900719925474099312345';
    assert.deepEqual(minimalSettlements([
      { id: 10, balanceCents: `-${huge}` },
      { id: 20, balanceCents: huge },
      { id: 30, balanceCents: '0' },
    ]), [
      { fromUserId: 10, toUserId: 20, amountCents: huge },
    ]);
  });

  it('rejects a balance set that cannot settle to zero', () => {
    assert.throws(
      () => minimalSettlements([
        { id: 1, balanceCents: '-100' },
        { id: 2, balanceCents: '99' },
      ]),
      /sum to zero/,
    );
  });
});

describe('shapeGroupSummaries', () => {
  it('normalizes empty and BIGINT balances to JSON-safe decimal strings', () => {
    assert.deepEqual(shapeGroupSummaries([
      { id: 1, name: 'Cabin', balance_cents: null },
      { id: 2, name: 'Road trip', balance_cents: 900719925474099312345n },
    ]), [
      { id: 1, name: 'Cabin', balance_cents: '0' },
      { id: 2, name: 'Road trip', balance_cents: '900719925474099312345' },
    ]);
  });
});
