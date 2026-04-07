import { NextRequest, NextResponse } from 'next/server';
import { slskdGet } from '@/lib/slskd';

export const dynamic = 'force-dynamic';

interface BrowseResponse {
  directories: Array<{
    name: string;
    fileCount: number;
    files: Array<{
      filename: string;
      size: number;
      bitRate?: number;
      length?: number;
      sampleRate?: number;
      bitDepth?: number;
      code?: string;
    }>;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json({ error: 'username parameter required' }, { status: 400 });
    }

    const result = await slskdGet<BrowseResponse>(
      `/api/v0/users/${encodeURIComponent(username)}/browse`
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to browse user', detail: String(error) }, { status: 500 });
  }
}
