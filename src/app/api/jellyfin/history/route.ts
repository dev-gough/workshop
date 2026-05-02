import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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
    return NextResponse.json({ history: rows });
  } catch (error) {
    return NextResponse.json(
      { history: [], error: 'Failed to fetch history', detail: String(error) },
      { status: 200 },
    );
  }
}
