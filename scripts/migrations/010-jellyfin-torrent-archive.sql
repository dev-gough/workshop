-- Jellyfin fetcher: track an archived copy of the .torrent file so we can
-- re-seed from disk if transmission's config dir is ever wiped.

ALTER TABLE jellyfin_torrents ADD COLUMN IF NOT EXISTS torrent_file_path TEXT;
