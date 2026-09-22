import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRisk } from './risk';

test('summarizes cash, invested exposure, and the largest position from cents', () => {
  const summary = summarizeRisk(2_000_00, [
    { symbol: 'AAA', marketValueCents: 5_000_00, priceCents: 10_000 },
    { symbol: 'BBB', marketValueCents: 3_000_00, priceCents: 7_500 },
  ]);

  assert.equal(summary.totalValueCents, 10_000_00);
  assert.equal(summary.investedCents, 8_000_00);
  assert.equal(summary.investedPct, 80);
  assert.equal(summary.cashPct, 20);
  assert.deepEqual(summary.largestPosition, {
    symbol: 'AAA',
    valueCents: 5_000_00,
    portfolioPct: 50,
  });
  assert.equal(summary.concentration, 'high');
});

test('counts unpriced positions because their values use cost basis', () => {
  const summary = summarizeRisk(6_000, [
    { symbol: 'MARKED', marketValueCents: 2_000, priceCents: 2_000 },
    { symbol: 'STALE', marketValueCents: 2_000, priceCents: null },
  ]);

  assert.equal(summary.unpricedCount, 1);
  assert.equal(summary.concentration, 'moderate');
});

test('handles an all-cash account without division errors', () => {
  const summary = summarizeRisk(25_000, []);

  assert.equal(summary.totalValueCents, 25_000);
  assert.equal(summary.investedPct, 0);
  assert.equal(summary.cashPct, 100);
  assert.equal(summary.largestPosition, null);
  assert.equal(summary.concentration, 'low');
});
