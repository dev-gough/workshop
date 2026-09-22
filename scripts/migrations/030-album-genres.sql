-- Keep both the album-wide genre index and the per-file tags. The latter lets
-- BarFoo build accurate automatic playlists for compilations whose tracks have
-- different genres, while genres keeps filtering and inspection simple.
ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS genres TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS song_genres JSONB NOT NULL DEFAULT '{}'::jsonb;
