-- Mission Control (RM 17): SpaceX tonnage-to-orbit tracker.
--
-- One row per launch, mirrored from Launch Library 2 (ll.thespacedevs.com).
-- LL2 is the source of truth for the *flight record* (vehicle, date, outcome,
-- orbit); it does NOT publish payload masses, so `mass_kg` is computed at
-- ingest by src/lib/spaceflight/estimate.ts — a rules engine (curated lookup,
-- Starlink batch parsing, Dragon capsule masses, orbit-class fallbacks) whose
-- verdict is recorded in `mass_source`/`mass_note` so the UI can be honest
-- about what is measured versus estimated. Re-running the sync re-estimates,
-- so improving the rules retroactively fixes history — nothing here is
-- hand-edited.
--
-- Upcoming launches are stored in the same table (`is_upcoming = true`) to
-- feed the next-launch countdown; charts filter them out.

CREATE TABLE IF NOT EXISTS spaceflight_launches (
  ll2_id        text PRIMARY KEY,
  name          text NOT NULL,
  mission_name  text,
  -- Marketing-name grouping the room charts by: Falcon 1, Falcon 9,
  -- Falcon Heavy, Starship. Derived from the LL2 config, never shown raw.
  vehicle       text NOT NULL,
  config_name   text NOT NULL,          -- e.g. "Falcon 9 Block 5", "Starship V3"
  net           timestamptz NOT NULL,   -- launch time (LL2 "no earlier than")
  status        text NOT NULL,          -- Success | Failure | Partial Failure | Go | TBC | TBD…
  is_upcoming   boolean NOT NULL DEFAULT false,
  orbit_abbrev  text,                   -- LEO/GTO/Sub/… "Sub" is how test flights
  orbit_name    text,                   -- are excluded from delivered-to-orbit mode.
  pad_name      text,
  pad_location  text,
  description   text,
  image_url     text,
  mass_kg       real,                   -- NULL = no rule matched (counts 0, flagged in UI)
  mass_source   text NOT NULL DEFAULT 'none',  -- lookup | starlink | dragon | coarse | none
  mass_note     text,
  last_updated  timestamptz,            -- LL2's own record timestamp
  synced_at     timestamptz NOT NULL DEFAULT now()
);

-- Every chart is "over time within a vehicle"; the tile wants per-vehicle sums.
CREATE INDEX IF NOT EXISTS spaceflight_launches_net_idx
  ON spaceflight_launches (vehicle, net);

-- last_full_sync / last_sync bookkeeping + manual-refresh cooldown.
CREATE TABLE IF NOT EXISTS spaceflight_meta (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
