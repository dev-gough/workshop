-- 015: Fix soulseek_uploads hourly duplication.
--
-- The ingest poller deduped uploads only by (username, filename) within a
-- 1-hour window, so every completed upload still sitting in slskd's transfer
-- list was re-inserted once per hour (single files duplicated 885x, inflating
-- upload totals to ~7.5 TB). Downloads never had this problem because they
-- key on slskd's transfer id.
--
-- 1) Collapse duplicates: re-inserts of the same slskd transfer carry the
--    same (username, filename, started_at), so keep the earliest row per key.
-- 2) Add slskd_id so the poller can dedupe uploads exactly like downloads.

DELETE FROM soulseek_uploads
WHERE id NOT IN (
  SELECT min(id)
  FROM soulseek_uploads
  GROUP BY username, filename, started_at
);

ALTER TABLE soulseek_uploads ADD COLUMN IF NOT EXISTS slskd_id TEXT;

-- Plain (non-partial) unique index so ON CONFLICT (slskd_id) works; legacy
-- rows stay NULL and Postgres allows multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_slskd_uploads_slskd_id
  ON soulseek_uploads (slskd_id);
