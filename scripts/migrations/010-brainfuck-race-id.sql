-- Parallel runs: a single "Start run" click can spawn N independent runner
-- processes racing for the same target. Each gets its own brainfuck_runs
-- row tagged with a shared race_id so the UI can group them together. NULL
-- means a normal single-process run (the default and pre-existing case).

ALTER TABLE brainfuck_runs
  ADD COLUMN IF NOT EXISTS race_id TEXT;

CREATE INDEX IF NOT EXISTS idx_brainfuck_runs_race ON brainfuck_runs(race_id)
  WHERE race_id IS NOT NULL;
