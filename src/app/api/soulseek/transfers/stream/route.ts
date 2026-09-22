import { NextRequest } from 'next/server';
import { slskdGet, flattenTransfers } from '@/lib/slskd';
import { changedTransferFrame } from '@/lib/soulseek-transfers';

export const dynamic = 'force-dynamic';

interface SlskdTransferFile {
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
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let stopped = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let previousSnapshot: string | null = null;

      const enqueue = (value: string) => {
        if (!stopped) controller.enqueue(encoder.encode(value));
      };

      const poll = async () => {
        try {
          const [rawDownloads, rawUploads] = await Promise.all([
            slskdGet('/api/v0/transfers/downloads').catch(() => []),
            slskdGet('/api/v0/transfers/uploads').catch(() => []),
          ]);
          const downloads = flattenTransfers<SlskdTransferFile>(rawDownloads);
          const uploads = flattenTransfers<SlskdTransferFile>(rawUploads);
          const next = changedTransferFrame({ downloads, uploads }, previousSnapshot);
          previousSnapshot = next.serialized;
          if (next.frame) enqueue(next.frame);
        } catch {
          // skip this tick
        } finally {
          // Schedule after both upstream requests settle so slow slskd calls
          // cannot create overlapping polls.
          if (!stopped) pollTimer = setTimeout(poll, 2000);
        }
      };

      void poll();
      // Comments keep proxies from considering a quiet, unchanged wire dead
      // without causing EventSource message handlers or React state updates.
      const heartbeat = setInterval(() => enqueue(': keep-alive\n\n'), 15000);

      request.signal.addEventListener('abort', () => {
        stopped = true;
        if (pollTimer) clearTimeout(pollTimer);
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      }, { once: true });
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
