import { NextResponse } from 'next/server';
import { listTorrents, statusLabel } from '@/lib/transmission';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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

    const transfers = live.map((t) => {
      const hash = t.hashString.toLowerCase();
      const dbRow = byHash.get(hash);
      return {
        id: t.id,
        hash,
        name: t.name,
        status: statusLabel(t.status, t.isFinished),
        percent: t.percentDone,
        totalBytes: t.totalSize,
        downBps: t.rateDownload,
        upBps: t.rateUpload,
        eta: t.eta,
        ratio: t.uploadRatio,
        error: t.errorString || null,
        downloadDir: t.downloadDir,
        mode: dbRow?.mode || (t.downloadDir.includes('/tv') ? 'tv' : 'movie'),
        addedAt: t.addedDate ? new Date(t.addedDate * 1000).toISOString() : null,
        doneAt: t.doneDate ? new Date(t.doneDate * 1000).toISOString() : null,
        dbId: dbRow?.id ?? null,
        dbStatus: dbRow?.status ?? null,
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
