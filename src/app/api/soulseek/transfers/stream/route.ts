import { NextRequest } from 'next/server';
import { slskdGet } from '@/lib/slskd';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const poll = async () => {
        try {
          const [downloads, uploads] = await Promise.all([
            slskdGet('/api/v0/transfers/downloads').catch(() => ({})),
            slskdGet('/api/v0/transfers/uploads').catch(() => ({})),
          ]);
          const data = `data: ${JSON.stringify({ downloads, uploads })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // skip this tick
        }
      };

      // Initial poll
      poll();
      const interval = setInterval(poll, 2000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
