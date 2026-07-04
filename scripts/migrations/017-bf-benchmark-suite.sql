-- Benchmark suites: 'throughput' (the original evals/s sweep) vs 'solve'
-- (repeated runs per target measuring solve rate and gens-to-solve).
-- Existing rows are all throughput runs.
ALTER TABLE brainfuck_benchmarks
  ADD COLUMN IF NOT EXISTS suite text NOT NULL DEFAULT 'throughput';
