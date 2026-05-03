-- Solved BF programs. One row per (target, gene) pair, deduplicated across
-- runs so a given solution shape is recorded once even if the GA finds it
-- repeatedly. times_found is bumped on rediscovery; last_seen_at tracks the
-- most recent rediscovery for "is this still being found?" sorting.

CREATE TABLE IF NOT EXISTS brainfuck_solutions (
  id                   SERIAL PRIMARY KEY,
  target               TEXT NOT NULL,
  gene                 TEXT NOT NULL,
  output               TEXT NOT NULL,
  -- structural metrics (computed from source)
  gene_length          INTEGER NOT NULL,
  loop_count           INTEGER NOT NULL,
  max_loop_depth       INTEGER NOT NULL,
  unique_instructions  INTEGER NOT NULL,
  -- runtime metrics (one execution, no early output cap)
  ops_executed         INTEGER NOT NULL,
  halted               BOOLEAN NOT NULL,
  output_length        INTEGER NOT NULL,
  cells_used           INTEGER NOT NULL,
  output_exact_match   BOOLEAN NOT NULL,
  -- discovery context
  -- soft reference (no FK): the workshop role doesn't own brainfuck_runs and
  -- can't grant itself REFERENCES, so we keep just the integer. Solutions
  -- outlive the runs that found them anyway, which is the desired behavior
  -- (deleting a run shouldn't erase the program it discovered).
  run_id               INTEGER,
  generations_to_solve INTEGER,
  config_json          JSONB,
  bf_version_hash      TEXT,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  times_found          INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT brainfuck_solutions_target_gene_unique UNIQUE (target, gene)
);
CREATE INDEX IF NOT EXISTS idx_brainfuck_solutions_target ON brainfuck_solutions(target);
CREATE INDEX IF NOT EXISTS idx_brainfuck_solutions_first_seen ON brainfuck_solutions(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_brainfuck_solutions_length ON brainfuck_solutions(target, gene_length);
