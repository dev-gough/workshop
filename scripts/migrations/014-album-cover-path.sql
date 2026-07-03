-- Album art out of the DB.
--
-- Covers used to live in albums.thumbnail as base64 data-URIs (~8-20KB each),
-- and /api/music shipped ALL of them inline (megabytes on a cold load). We now
-- write the resized jpeg to <musicDir>/.covers/<albumId>.jpg and store only the
-- relative path here; /api/music/cover/[id] streams the file with long caching.
--
-- The old thumbnail column is intentionally LEFT IN PLACE: it stays populated by
-- older code paths and lets us roll back without data loss, but nothing reads it
-- anymore. A future cleanup migration should:
--     ALTER TABLE albums DROP COLUMN thumbnail;
-- once every deploy is confirmed on the file-backed covers.
--
-- Compat window: cover_path is NULL for every album until `npm run scan-music`
-- is re-run (the scanner backfills the files + this column on rescan). The API/UI
-- degrade to placeholders while it is NULL — they do NOT fall back to thumbnail.

ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_path TEXT;
