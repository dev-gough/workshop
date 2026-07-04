-- Game of Life census checkpoints: one row per board size, shared by every
-- browser. `result` is the client's CensusResult JSON verbatim; `processed`
-- and `done` are lifted out so the upsert guard can refuse regressions
-- (a stale tab can never clobber a further-along run).
CREATE TABLE IF NOT EXISTS gol_census (
  w          integer NOT NULL CHECK (w BETWEEN 1 AND 7),
  h          integer NOT NULL CHECK (h BETWEEN 1 AND 7),
  processed  double precision NOT NULL DEFAULT 0,  -- exact ≤ 2^49 (7×7)
  done       boolean NOT NULL DEFAULT false,
  result     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (w, h)
);
