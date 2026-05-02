-- BrainFuck GA benchmarks: timed runs with no rendering, used to compare the
-- raw speed of different algorithm versions before/after optimization passes.

CREATE TABLE IF NOT EXISTS brainfuck_benchmarks (
  id                SERIAL PRIMARY KEY,
  -- Snapshot of the BF reference repo at benchmark time. Auto-detected via
  -- `git rev-parse --short HEAD` on /home/server/brainfuck-genetic.
  version_hash      TEXT,
  version_subject   TEXT,
  -- Optional human-readable label the user provides ("init", "trim-dead", …).
  version_label     TEXT,
  target            TEXT NOT NULL,
  pop_size          INTEGER NOT NULL,
  max_generations   INTEGER NOT NULL,
  generations       INTEGER NOT NULL DEFAULT 0,
  evaluations       INTEGER NOT NULL DEFAULT 0,
  wall_seconds      DOUBLE PRECISION,
  evals_per_sec     DOUBLE PRECISION,
  gens_per_sec      DOUBLE PRECISION,
  best_fitness      INTEGER,
  found             BOOLEAN,
  status            TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed | stopped
  pid               INTEGER,
  error             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_brainfuck_benchmarks_started ON brainfuck_benchmarks(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_brainfuck_benchmarks_version ON brainfuck_benchmarks(version_hash);
