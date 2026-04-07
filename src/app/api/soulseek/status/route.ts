import { NextResponse } from 'next/server';
import { slskdGet } from '@/lib/slskd';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await slskdGet<{ state: string; version: string }>('/api/v0/application');
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to connect to slskd', detail: String(error) },
      { status: 502 }
    );
  }
}
