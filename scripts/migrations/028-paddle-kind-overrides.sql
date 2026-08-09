-- Imagery-arbitrated kind review queue (RM 18). The orthophoto corridor is
-- a witness, never an author: scripts/flag-imagery-kinds.ts writes PROPOSALS
-- here, the room's Review tab approves/rejects them, and only approved rows
-- mutate paddle_segments — immediately on approval, and re-applied after
-- every re-ingest. Geometry-anchored (same rule as trips): segment ids
-- reassign on every rebuild, so the section is stored as coordinates.
CREATE TABLE IF NOT EXISTS paddle_kind_overrides (
  id           serial PRIMARY KEY,
  park         text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  seg_hint     integer,               -- segment id at proposal time (display only)
  before_kind  text NOT NULL,         -- kind the scorer saw ('paddle' | 'portage')
  coords       jsonb NOT NULL,        -- [[lon,lat],...] — the whole flagged section
  pieces       jsonb NOT NULL,        -- [{coords:[[lon,lat],...], kind}] proposed result
  evidence     jsonb NOT NULL,        -- {waterFrac, samples, lengthM, confidence, ...}
  status       text NOT NULL DEFAULT 'proposed',  -- proposed|approved|rejected|unclear
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  applied_at   timestamptz            -- last time an approval was applied to segments
);
CREATE INDEX IF NOT EXISTS paddle_kind_overrides_park ON paddle_kind_overrides (park, status);
