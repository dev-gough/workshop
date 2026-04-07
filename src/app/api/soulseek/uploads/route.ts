import { NextRequest, NextResponse } from 'next/server';
import { slskdGet } from '@/lib/slskd';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  size: number;
  state: string;
  bytesTransferred: number;
  averageSpeed: number;
  percentComplete: number;
  startedAt?: string;
  endedAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    // Get live uploads from slskd (returns nested format, flatten it)
    let liveTransfers: Record<string, SlskdTransfer[]> = {};
    try {
      const raw = await slskdGet<{ username: string; directories: { files: SlskdTransfer[] }[] }[]>('/api/v0/transfers/uploads');
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

    // Get DB history
    const { rows } = await pool.query(
      'SELECT * FROM soulseek_uploads ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    return NextResponse.json({
      uploads: rows,
      live: liveTransfers,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch uploads', detail: String(error) }, { status: 500 });
  }
}
