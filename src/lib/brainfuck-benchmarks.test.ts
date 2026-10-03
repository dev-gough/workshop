import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SOLVE_PRESET, THROUGHPUT_PRESET, benchCaseArgs } from './brainfuck-benchmarks';

describe('brainfuck benchmark presets', () => {
  it('times throughput on a fixed seeded budget long enough for a fast binary', () => {
    assert.ok(THROUGHPUT_PRESET.length >= 1);
    for (const c of THROUGHPUT_PRESET) {
      assert.equal(c.lanes, 1);
      assert.equal(c.trials, 1);
      assert.ok(c.maxGen >= 1_000);
      assert.ok(c.warmupGens > 0);
      assert.ok(c.warmupGens < c.maxGen);
      assert.ok(c.minSeconds >= 2);
      assert.equal(c.seed, THROUGHPUT_PRESET[0].seed);
    }
    const args = benchCaseArgs('throughput', THROUGHPUT_PRESET[0]);
    assert.ok(args.includes('--bench-mode'));
    assert.ok(args.includes('throughput'));
    assert.equal(args.at(-1), String(THROUGHPUT_PRESET[0].minSeconds));
  });

  it('gives quick targets many in-process trials and does not race lanes', () => {
    assert.ok(SOLVE_PRESET.length >= 2);
    for (const c of SOLVE_PRESET) {
      assert.equal(c.lanes, 1);
      assert.ok(c.trials >= 10);
      assert.ok(c.maxGen >= 1_000);
      assert.equal(c.minSeconds, 0);
      assert.ok(c.target.length <= 8);
    }
    const args = benchCaseArgs('solve', SOLVE_PRESET[0]);
    assert.ok(args.includes('solve'));
    assert.ok(args.includes('--trials'));
    assert.equal(args[args.indexOf('--max-gen') + 1], String(SOLVE_PRESET[0].maxGen));
  });
});
