import { NextRequest, NextResponse } from 'next/server';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { addTorrent, listTorrents } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const STAGING = {
  tv: '/Media/.staging/tv',
  movie: '/Media/.staging/movies',
} as const;

const TORRENT_ARCHIVE_DIR = '/Media/.torrents';

// Best-effort archive of the .torrent metainfo. Magnet adds usually don't have
// a usable .torrent file yet — those get picked up by the transfers backfill.
async function tryArchive(hash: string): Promise<string | null> {
  try {
    const lc = hash.toLowerCase();
    const torrents = await listTorrents();
    const match = torrents.find((t) => t.hashString.toLowerCase() === lc);
    if (!match?.torrentFile) return null;

    await mkdir(TORRENT_ARCHIVE_DIR, { recursive: true });
    const dest = path.join(TORRENT_ARCHIVE_DIR, `${lc}.torrent`);
    await copyFile(match.torrentFile, dest);
    return dest;
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const { link, mode } = await request.json();

    if (!link || typeof link !== 'string') {
      return NextResponse.json({ error: 'link required' }, { status: 400 });
    }
    if (mode !== 'tv' && mode !== 'movie') {
      return NextResponse.json({ error: 'mode must be "tv" or "movie"' }, { status: 400 });
    }
    const safeMode: 'tv' | 'movie' = mode;

    const trimmed = link.trim();
    const isValid =
      trimmed.startsWith('magnet:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://');
    if (!isValid) {
      return NextResponse.json({ error: 'link must be a magnet: or http(s) URL' }, { status: 400 });
    }

    const added = await addTorrent(trimmed, STAGING[safeMode]);
    const archivePath = await tryArchive(added.hashString);

    const { rows } = await pool.query(
      `INSERT INTO jellyfin_torrents (transmission_id, hash, mode, link, original_name, staging_path, status, torrent_file_path)
       VALUES ($1, $2, $3, $4, $5, $6, 'downloading', $7)
       RETURNING *`,
      [added.id, added.hashString.toLowerCase(), mode, trimmed, added.name, STAGING[safeMode], archivePath],
    );

    return NextResponse.json({ torrent: rows[0], transmission: added });
  } catch (error) {
    return NextResponse.json(
      { error: 'Add failed', detail: String(error) },
      { status: 500 },
    );
  }
}
