import { NextRequest } from 'next/server';
import { slskdGet, flattenTransfers } from '@/lib/slskd';

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
      const poll = async () => {
        try {
          const [rawDownloads, rawUploads] = await Promise.all([
            slskdGet('/api/v0/transfers/downloads').catch(() => []),
            slskdGet('/api/v0/transfers/uploads').catch(() => []),
          ]);
          const downloads = flattenTransfers<SlskdTransferFile>(rawDownloads);
          const uploads = flattenTransfers<SlskdTransferFile>(rawUploads);
          const data = `data: ${JSON.stringify({ downloads, uploads })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // skip this tick
        }
      };

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
