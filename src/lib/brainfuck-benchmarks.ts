/**
 * Benchmark cases the Tape Lab runs, and the fixed-v1 contract around them.
 *
 * Throughput cases time one seeded generation budget with no early exit, then
 * repeat it until `minSeconds`. Solve cases run `trials` independent searches
 * inside one process. Both stay valid when a target falls in a few hundred
 * generations or when the same algorithm is rebuilt in C, C++, or Rust: the
 * work unit does not shrink just because the search got lucky or the binary
 * got fast, and nothing here races lanes across cores (that race reports the
 * minimum of N samples and splits the machine's clocks).
 *
 * Quick rungs only. Measured with in-process trials on this machine: "hi"
 * solves about 28/30 times, median ~500 generations; "devy" about 19/20,
 * median ~3k. "genome" looked reliable only because a 4-way race kept the
 * luckiest lane (2/12 trials actually solved under a 25k cap), so it is not
 * in this click. Longer targets stay on the job card.
 */

export interface BenchCase {
  target: string;
  popSize: number;
  maxGen: number;
  /** Always 1. Kept so older batch cards that raced lanes still have a field. */
  lanes: number;
  /** Solve: independent in-process searches. Throughput: unused (1). */
  trials: number;
  /** Throughput: untimed generations discarded before the window. */
  warmupGens: number;
  /** Throughput: repeat the seeded budget until the timed window reaches this. 0 = once. */
  minSeconds: number;
  seed: number;
}

export const BENCH_SEED = 1;

export const THROUGHPUT_PRESET: BenchCase[] = [
  {
    // Inner loop. On PyPy one pass is already a couple of seconds; a much
    // faster binary repeats this same seed until minSeconds so the rate is
    // not a single noisy millisecond.
    target: 'sparqsys',
    popSize: 100,
    maxGen: 8_000,
    lanes: 1,
    trials: 1,
    warmupGens: 1_000,
    minSeconds: 2,
    seed: BENCH_SEED,
  },
  {
    // Longer genes. Restarts and migration sit far past this budget, so the
    // number is the steady search, not the diversity machinery.
    target: 'sparqsys',
    popSize: 100,
    maxGen: 40_000,
    lanes: 1,
    trials: 1,
    warmupGens: 2_000,
    minSeconds: 2,
    seed: BENCH_SEED,
  },
];

export const SOLVE_PRESET: BenchCase[] = [
  {
    target: 'hi',
    popSize: 100,
    maxGen: 5_000,
    lanes: 1,
    trials: 30,
    warmupGens: 0,
    minSeconds: 0,
    seed: BENCH_SEED,
  },
  {
    target: 'devy',
    popSize: 100,
    maxGen: 20_000,
    lanes: 1,
    trials: 20,
    warmupGens: 0,
    minSeconds: 0,
    seed: BENCH_SEED,
  },
];

/** CLI tail for one case. Comes last so --max-gen / --pop-size beat a config override. */
export function benchCaseArgs(suite: 'throughput' | 'solve', c: BenchCase): string[] {
  const args = [
    '--benchmark',
    '--bench-mode', suite,
    '--target', c.target,
    '--seed', String(c.seed),
    '--max-gen', String(c.maxGen),
    '--pop-size', String(c.popSize),
  ];
  if (suite === 'solve') {
    args.push('--trials', String(c.trials));
  } else {
    args.push('--warmup-gens', String(c.warmupGens), '--min-seconds', String(c.minSeconds));
  }
  return args;
}
