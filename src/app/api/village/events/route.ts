import { NextResponse } from 'next/server';
import { villageFetch, VillageServiceError } from '@/lib/village';

export const dynamic = 'force-dynamic';

/**
 * GET /api/village/events?colony=N — the live citizen stream, piped from the mod.
 *
 * A pass-through by design: the mod already speaks SSE, so this hands its body
 * straight to the browser rather than parsing and re-emitting frames. Nothing is
 * buffered, nothing is reshaped, and a format change in the mod needs no change
 * here.
 *
 * Forwarding the abort signal is the load-bearing part. Each stream parks one of
 * the mod's handler threads for its whole life and only three may be open at
 * once, so a closed browser tab that left the upstream connection dangling would
 * burn a slot until the game server restarted. Passing `request.signal` through
 * means the socket closes the moment the viewer goes away, the mod's next write
 * throws, and the slot comes back.
 */
export async function GET(request: Request) {
  const colony = new URL(request.url).searchParams.get('colony');
  if (colony !== null && !/^-?\d+$/.test(colony)) {
    return NextResponse.json({ ok: false, error: 'colony must be an integer' }, { status: 400 });
  }

  try {
    const upstream = await villageFetch(`/events${colony === null ? '' : `?colony=${colony}`}`, {
      signal: request.signal,
    });

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Nothing proxies this today, but an SSE stream through a buffering
        // reverse proxy arrives in one lump when the connection ends, which
        // looks exactly like a stream that never started.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    if (e instanceof VillageServiceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
