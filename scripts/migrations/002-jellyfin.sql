-- Jellyfin fetcher: track torrent submissions and post-completion ingestion

CREATE TABLE IF NOT EXISTS jellyfin_torrents (
  id SERIAL PRIMARY KEY,
  transmission_id INTEGER,
  hash TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('tv', 'movie')),
  link TEXT NOT NULL,
  original_name TEXT,
  staging_path TEXT,
  cleaned_title TEXT,
  cleaned_year INTEGER,
  cleaned_season INTEGER,
  final_path TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jellyfin_torrents_status ON jellyfin_torrents(status);
CREATE INDEX IF NOT EXISTS idx_jellyfin_torrents_hash ON jellyfin_torrents(hash);
CREATE INDEX IF NOT EXISTS idx_jellyfin_torrents_submitted ON jellyfin_torrents(submitted_at DESC);

CREATE TABLE IF NOT EXISTS jellyfin_ingest_files (
  id SERIAL PRIMARY KEY,
  torrent_id INTEGER NOT NULL REFERENCES jellyfin_torrents(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  dest_path TEXT NOT NULL,
  size_bytes BIGINT,
  kind TEXT NOT NULL DEFAULT 'video',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jellyfin_ingest_torrent ON jellyfin_ingest_files(torrent_id);
