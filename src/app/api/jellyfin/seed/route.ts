import { NextRequest, NextResponse } from 'next/server';
import { startTorrent, stopTorrent } from '@/lib/transmission';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { id, action } = await request.json();
    if (typeof id !== 'number') {
      return NextResponse.json({ error: 'id (transmission id) required' }, { status: 400 });
    }
    if (action !== 'start' && action !== 'stop') {
      return NextResponse.json({ error: 'action must be "start" or "stop"' }, { status: 400 });
    }

    if (action === 'start') await startTorrent(id);
    else await stopTorrent(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Seed toggle failed', detail: String(error) },
      { status: 500 },
    );
  }
}
