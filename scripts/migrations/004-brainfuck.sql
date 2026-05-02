-- BrainFuck genetic algorithm: track GA runs and their best discovered programs

CREATE TABLE IF NOT EXISTS brainfuck_runs (
  id              SERIAL PRIMARY KEY,
  target          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  pid             INTEGER,
  pop_size        INTEGER NOT NULL DEFAULT 100,
  max_generations INTEGER NOT NULL DEFAULT 1000000,
  generations     INTEGER NOT NULL DEFAULT 0,
  best_fitness    INTEGER,
  best_gene       TEXT,
  best_output     TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_brainfuck_runs_started ON brainfuck_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_brainfuck_runs_status ON brainfuck_runs(status);
