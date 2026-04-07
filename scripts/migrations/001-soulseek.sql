-- Soulseek integration tables

CREATE TABLE IF NOT EXISTS soulseek_downloads (
  id SERIAL PRIMARY KEY,
  slskd_id TEXT,
  username TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  size_bytes BIGINT,
  speed_bytes_per_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  local_path TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slskd_downloads_status ON soulseek_downloads(status);
CREATE INDEX IF NOT EXISTS idx_slskd_downloads_username ON soulseek_downloads(username);
CREATE INDEX IF NOT EXISTS idx_slskd_downloads_created ON soulseek_downloads(created_at DESC);

CREATE TABLE IF NOT EXISTS soulseek_uploads (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  filename TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  size_bytes BIGINT,
  speed_bytes_per_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slskd_uploads_username ON soulseek_uploads(username);
CREATE INDEX IF NOT EXISTS idx_slskd_uploads_created ON soulseek_uploads(created_at DESC);

CREATE TABLE IF NOT EXISTS soulseek_searches (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  slskd_search_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slskd_searches_created ON soulseek_searches(created_at DESC);

-- Add source tracking to albums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='albums' AND column_name='source') THEN
    ALTER TABLE albums ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='albums' AND column_name='added_at') THEN
    ALTER TABLE albums ADD COLUMN added_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;
