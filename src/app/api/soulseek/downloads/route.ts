import { NextRequest, NextResponse } from 'next/server';
import { slskdPost, slskdGet } from '@/lib/slskd';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SlskdTransfer {
  id: string;
  username: string;
  direction: string;
  filename: string;
  size: number;
  startOffset: number;
  state: string;
  bytesTransferred: number;
  bytesRemaining: number;
  averageSpeed: number;
  percentComplete: number;
  startedAt?: string;
  endedAt?: string;
  exception?: string;
}

// GET - list downloads (DB history + live slskd transfers)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // filter by status
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    // Get live transfers from slskd (returns nested format, flatten it)
    let liveTransfers: Record<string, SlskdTransfer[]> = {};
    try {
      const raw = await slskdGet<{ username: string; directories: { files: SlskdTransfer[] }[] }[]>('/api/v0/transfers/downloads');
      if (Array.isArray(raw)) {
        for (const group of raw) {
          const files: SlskdTransfer[] = [];
          for (const dir of group.directories || []) {
            if (dir.files) files.push(...dir.files);
          }
          if (files.length > 0) liveTransfers[group.username] = files;
        }
      }
    } catch { /* slskd may be down */ }

    // Get DB records
    let query = 'SELECT * FROM soulseek_downloads';
    const params: (string | number)[] = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);

    return NextResponse.json({
      downloads: rows,
      live: liveTransfers,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch downloads', detail: String(error) }, { status: 500 });
  }
}

// POST - initiate a download
export async function POST(request: NextRequest) {
  try {
    const { username, files } = await request.json();

    if (!username || !files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'username and files[] required' }, { status: 400 });
    }

    // Submit download to slskd
    await slskdPost(`/api/v0/transfers/downloads/${encodeURIComponent(username)}`, files.map((f: { filename: string; size: number }) => ({
      filename: f.filename,
      size: f.size,
    })));

    // Record in DB
    const dbRows = [];
    for (const file of files) {
      const { rows } = await pool.query(
        `INSERT INTO soulseek_downloads (username, remote_path, filename, size_bytes, status, started_at)
         VALUES ($1, $2, $3, $4, 'queued', NOW()) RETURNING *`,
        [username, file.filename, file.filename.split('\\').pop() || file.filename, file.size]
      );
      dbRows.push(rows[0]);
    }

    return NextResponse.json({ downloads: dbRows });
  } catch (error) {
    return NextResponse.json({ error: 'Download failed', detail: String(error) }, { status: 500 });
  }
}
