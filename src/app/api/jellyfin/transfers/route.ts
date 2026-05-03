import { NextResponse } from 'next/server';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { listTorrents, statusLabel, ensureSeedForeverSettings } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const TORRENT_ARCHIVE_DIR = '/Media/.torrents';

// One-shot guard so we only push session settings once per process.
let seedSettingsApplied = false;

async function applySessionSettingsOnce(): Promise<void> {
  if (seedSettingsApplied) return;
  try {
    await ensureSeedForeverSettings();
    seedSettingsApplied = true;
  } catch { /* daemon may be unreachable; retry next call */ }
}

/**
 * For any torrent whose .torrent file we haven't archived yet, copy
 * transmission's copy to /Media/.torrents/<hash>.torrent and record the path.
 * Best-effort — magnets without metadata yet won't have a usable torrentFile.
 */
async function backfillArchives(
  live: { hashString: string; torrentFile: string }[],
  dbRows: { hash: string; torrent_file_path: string | null }[],
): Promise<void> {
  const needs = new Set<string>();
  for (const r of dbRows) {
    if (!r.torrent_file_path && r.hash) needs.add(r.hash);
  }
  if (needs.size === 0) return;

  await mkdir(TORRENT_ARCHIVE_DIR, { recursive: true }).catch(() => {});

  for (const t of live) {
    const hash = t.hashString.toLowerCase();
    if (!needs.has(hash)) continue;
    if (!t.torrentFile) continue;

    const dest = path.join(TORRENT_ARCHIVE_DIR, `${hash}.torrent`);
    try {
      await copyFile(t.torrentFile, dest);
      await pool.query(
        `UPDATE jellyfin_torrents SET torrent_file_path = $1 WHERE hash = $2 AND torrent_file_path IS NULL`,
        [dest, hash],
      );
    } catch { /* skip — try again next refresh */ }
  }
}

export async function GET() {
  try {
    await applySessionSettingsOnce();
    const live = await listTorrents().catch(() => []);

    // Join live torrents with our DB rows by hash
    const hashes = live.map((t) => t.hashString.toLowerCase());
    const { rows: dbRows } = hashes.length
      ? await pool.query(
          `SELECT * FROM jellyfin_torrents WHERE hash = ANY($1::text[])`,
          [hashes],
        )
      : { rows: [] };
    const byHash = new Map(dbRows.map((r) => [r.hash, r]));

    backfillArchives(live, dbRows).catch(() => {});

    const transfers = live.map((t) => {
      const hash = t.hashString.toLowerCase();
      const dbRow = byHash.get(hash);
      return {
        id: t.id,
        hash,
        name: t.name,
        status: statusLabel(t.status, t.isFinished),
        rawStatus: t.status,
        percent: t.percentDone,
        totalBytes: t.totalSize,
        downBps: t.rateDownload,
        upBps: t.rateUpload,
        eta: t.eta,
        ratio: t.uploadRatio,
        uploadedEver: t.uploadedEver,
        secondsSeeding: t.secondsSeeding,
        error: t.errorString || null,
        downloadDir: t.downloadDir,
        mode: dbRow?.mode || (t.downloadDir.includes('/tv') ? 'tv' : 'movie'),
        addedAt: t.addedDate ? new Date(t.addedDate * 1000).toISOString() : null,
        doneAt: t.doneDate ? new Date(t.doneDate * 1000).toISOString() : null,
        dbId: dbRow?.id ?? null,
        dbStatus: dbRow?.status ?? null,
        archived: !!dbRow?.torrent_file_path,
      };
    });

    return NextResponse.json({ transfers });
  } catch (error) {
    return NextResponse.json(
      { transfers: [], error: 'Failed to fetch transfers', detail: String(error) },
      { status: 200 }, // soft error so the page can still render
    );
  }
}
