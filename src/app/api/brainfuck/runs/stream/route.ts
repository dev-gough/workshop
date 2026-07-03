import { NextRequest } from 'next/server';
import { subscribeRunEvents, getActiveRunIds, type StreamEvent } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

// Live event stream for the active BrainFuck run(s). Subscribes to the
// in-process fan-out in @/lib/brainfuck — same module singleton the child
// process manager lives in, so this handler sees events from the running
// python child(ren) directly. The page uses this to replace 1s polling; a
// slow (10s) poll remains as a fallback if the stream errors.
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Controller already closed — treat as disconnect.
          closed = true;
        }
      };

      // Prime the client with the current active set so it can render
      // immediately without waiting for the first runner event.
      send({ type: 'hello', activeIds: getActiveRunIds() });

      const unsubscribe = subscribeRunEvents((evt: StreamEvent) => {
        send(evt);
      });

      // Heartbeat comment keeps the connection alive through proxies and lets
      // us notice a dead client (enqueue throws) even during a quiet run.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
