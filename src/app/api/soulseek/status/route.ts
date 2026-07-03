import { NextResponse } from 'next/server';
import { slskdGet } from '@/lib/slskd';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const app = await slskdGet<{
      version: { current: string };
      server: { state: string; isConnected: boolean };
    }>('/api/v0/application');
    const state = app.server?.state ?? '';
    return NextResponse.json({
      connected: app.server?.isConnected ?? state.split(',').map(s => s.trim()).includes('Connected'),
      state,
      version: app.version?.current ?? '',
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to connect to slskd', detail: String(error) },
      { status: 502 }
    );
  }
}
