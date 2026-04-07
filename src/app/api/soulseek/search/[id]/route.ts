import { NextRequest, NextResponse } from 'next/server';
import { slskdGet } from '@/lib/slskd';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SlskdSearchResponse {
  id: string;
  searchText: string;
  state: string;
  responseCount: number;
  fileCount: number;
  responses: Array<{
    username: string;
    hasFreeUploadSlot: boolean;
    uploadSpeed: number;
    queueLength: number;
    fileCount: number;
    lockedFileCount: number;
    files: Array<{
      filename: string;
      size: number;
      bitRate?: number;
      sampleRate?: number;
      bitDepth?: number;
      length?: number;
      code?: string;
    }>;
  }>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await slskdGet<SlskdSearchResponse>(`/api/v0/searches/${id}`);

    // Update result count in DB
    if (result.fileCount > 0) {
      await pool.query(
        'UPDATE soulseek_searches SET result_count = $1 WHERE slskd_search_id = $2',
        [result.fileCount, id]
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch search results', detail: String(error) }, { status: 500 });
  }
}
