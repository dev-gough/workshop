import { NextRequest } from 'next/server';
import { slskdGet } from '@/lib/slskd';

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

interface SlskdTransferGroup {
  username: string;
  directories: { directory: string; fileCount: number; files: SlskdTransferFile[] }[];
}

// slskd returns [{ username, directories: [{ files: [...] }] }]
// Flatten to { username: Transfer[] } for the frontend
function flattenTransfers(raw: unknown): Record<string, SlskdTransferFile[]> {
  const result: Record<string, SlskdTransferFile[]> = {};
  if (!Array.isArray(raw)) return result;
  for (const group of raw as SlskdTransferGroup[]) {
    const files: SlskdTransferFile[] = [];
    if (group.directories) {
      for (const dir of group.directories) {
        if (dir.files) files.push(...dir.files);
      }
    }
    if (files.length > 0) {
      result[group.username] = files;
    }
  }
  return result;
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
          const downloads = flattenTransfers(rawDownloads);
          const uploads = flattenTransfers(rawUploads);
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
