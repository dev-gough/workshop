-- BrainFuck progress trail: one row per emitted progress event, used to draw
-- the fitness sparkline overlay during and after a run.

CREATE TABLE IF NOT EXISTS brainfuck_progress (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES brainfuck_runs(id) ON DELETE CASCADE,
  gen          INTEGER NOT NULL,
  best_fitness INTEGER NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brainfuck_progress_run ON brainfuck_progress(run_id, gen);
