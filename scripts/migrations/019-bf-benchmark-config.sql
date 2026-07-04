-- Config-carrying benchmark rows (hyperparam-sweep prep): when a batch is
-- started with a GA config override, each row records the full config it
-- ran, so sweep cells are self-describing. NULL = repo defaults.
ALTER TABLE brainfuck_benchmarks
  ADD COLUMN IF NOT EXISTS config_json jsonb;
