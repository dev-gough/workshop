-- Group benchmark rows that were kicked off as a single suite together.
-- Each "Run benchmark" click now sweeps multiple configs; rows from the same
-- click share a batch_id (epoch ms as text). NULL for legacy rows.

ALTER TABLE brainfuck_benchmarks
  ADD COLUMN IF NOT EXISTS batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_brainfuck_benchmarks_batch ON brainfuck_benchmarks(batch_id);
