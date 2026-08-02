import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveItemsByPath } from '@/lib/jellyfin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const mode = searchParams.get('mode'); // optional: 'tv' | 'movie'

    let sql = `
      SELECT t.*,
             COALESCE(json_agg(json_build_object(
               'id', f.id, 'source', f.source_path, 'dest', f.dest_path, 'size', f.size_bytes
             )) FILTER (WHERE f.id IS NOT NULL), '[]') AS files
      FROM jellyfin_torrents t
      LEFT JOIN jellyfin_ingest_files f ON f.torrent_id = t.id
    `;
    const params: (string | number)[] = [];
    if (mode === 'tv' || mode === 'movie') {
      sql += ' WHERE t.mode = $1';
      params.push(mode);
    }
    sql += ' GROUP BY t.id ORDER BY t.submitted_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const { rows } = await pool.query(sql, params);

    // Best-effort: attach real Jellyfin item ids to ingested rows so the UI
    // can deep-link to the item instead of a search page. Needs an API key
    // in services.jellyfin; silently skipped otherwise.
    try {
      const paths = [...new Set(
        rows
          .filter((r) => r.status === 'ingested' && typeof r.final_path === 'string')
          .map((r) => r.final_path as string),
      )];
      const resolved = await resolveItemsByPath(paths);
      for (const r of rows) {
        const hit = r.final_path ? resolved.get(r.final_path) : undefined;
        r.jellyfin_item_id = hit?.itemId ?? null;
        r.jellyfin_server_id = hit?.serverId ?? null;
      }
    } catch { /* history still renders without deep links */ }

    return NextResponse.json({ history: rows });
  } catch (error) {
    return NextResponse.json(
      { history: [], error: 'Failed to fetch history', detail: String(error) },
      { status: 200 },
    );
  }
}
