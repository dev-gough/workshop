-- Racing lanes for benchmark rows: solve-suite rows spawn N runner
-- processes and record the winner. Kept per-row so raced results are
-- never silently compared against historical single-lane rows.
ALTER TABLE brainfuck_benchmarks
  ADD COLUMN IF NOT EXISTS lanes integer NOT NULL DEFAULT 1;
