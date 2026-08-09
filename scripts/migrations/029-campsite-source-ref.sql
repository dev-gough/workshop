-- Campsites gain a stable external reference (e.g. OSM 'node/123456789')
-- so open-data imports are idempotent upserts: re-imports refresh name and
-- position but never touch status/notes — hand curation in the room's UI
-- survives, same contract as everything else in this table. Manual rows
-- keep source_ref NULL (the unique index is partial).
ALTER TABLE paddle_campsites ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS paddle_campsites_source_ref
  ON paddle_campsites (park, source_ref) WHERE source_ref IS NOT NULL;
