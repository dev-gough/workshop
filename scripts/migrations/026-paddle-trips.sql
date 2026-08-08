-- Paddle Planner: saved trips.
--
-- A trip is user data, not derived data — it must outlive network re-ingests
-- (segment ids are reassigned on every build), so waypoints persist as bare
-- geometry [[lon, lat, dayEnd(0|1)], ...] and are re-snapped to the current
-- network on load. `slug` doubles as the share token for
-- /projects/paddle?trip=<slug>.

CREATE TABLE IF NOT EXISTS paddle_trips (
  id          serial PRIMARY KEY,
  park        text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  waypoints   jsonb NOT NULL,          -- [[lon, lat, dayEnd], ...]
  cost        jsonb NOT NULL,          -- CostParams snapshot
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paddle_trips_park ON paddle_trips (park, updated_at DESC);
