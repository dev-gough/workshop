-- RM 16 became a 2D side-scroller (generator v2), and a run is now a time
-- rather than a points total. The note/ramp counters described a game that no
-- longer exists, so they go rather than linger as columns nobody can read.
--
-- Dropping rather than keeping is safe here and only here: groove_scores has
-- never held a real run. The v1 leaderboard was cleared after tuning, so there
-- is no history to preserve — if there had been, this would have been an
-- additive migration and the old columns would have stayed for the old
-- generator_version to keep meaning something.

ALTER TABLE groove_scores
  DROP COLUMN IF EXISTS score,
  DROP COLUMN IF EXISTS max_score,
  DROP COLUMN IF EXISTS notes_hit,
  DROP COLUMN IF EXISTS notes_total,
  DROP COLUMN IF EXISTS ramps_hit,
  DROP COLUMN IF EXISTS ramps_total,
  DROP COLUMN IF EXISTS best_combo;

ALTER TABLE groove_scores
  -- Wall-clock for the run. Kept even for an unfinished attempt, so "how far
  -- did I get and how long did it take" is answerable either way.
  ADD COLUMN IF NOT EXISTS time_ms    integer NOT NULL DEFAULT 0 CHECK (time_ms >= 0),
  -- Par: the record's own running time, recomputed server-side from the
  -- cached analysis rather than reported by whoever was riding.
  ADD COLUMN IF NOT EXISTS par_ms     integer NOT NULL DEFAULT 1 CHECK (par_ms > 0),
  ADD COLUMN IF NOT EXISTS finished   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distance   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS course_len integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS crashes    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS air_ms     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flips      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS style      integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS groove_scores_best_idx;

-- "Best run for this song on this generator" now means: finished ones first,
-- then quickest. An unfinished attempt never outranks a completed one however
-- briefly it lasted.
CREATE INDEX IF NOT EXISTS groove_scores_best_idx
  ON groove_scores (artist, album, song, generator_version, finished DESC, time_ms ASC);
