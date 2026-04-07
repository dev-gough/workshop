import { NextRequest } from 'next/server';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';

const ALLOWED_SERVICES = [
  'workshop',
  'challenge-poller',
  'nginx',
  'postgresql@16-main',
  'jellyfin',
  'plexmediaserver',
  'tailscaled',
  'ssh',
  'minecraft-atm6',
  'minecraft-atm10',
  'minecraft-stoneblock3',
  'minecraft-meatballcraft',
  'minecraft-atm9sky',
  'minecraft-above-beyond',
];

function parseLine(line: string) {
  const match = line.match(/^(\S+)\s+(\S+)\s+(\S+?)(?:\[\d+\])?:\s*(.*)/);
  if (match) {
    return { timestamp: match[1], hostname: match[2], unit: match[3], message: match[4] };
  }
  return { timestamp: '', hostname: '', unit: '', message: line };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service');

  if (!service || !ALLOWED_SERVICES.includes(service)) {
    return new Response('Invalid service', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn('journalctl', [
        '-u', `${service}.service`,
        '--no-pager',
        '-n', '0',
        '--output=short-iso',
        '-f',
      ]);

      let buffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('-- ')) continue;
          const parsed = parseLine(trimmed);
          const data = `data: ${JSON.stringify(parsed)}\n\n`;
          try {
            controller.enqueue(new TextEncoder().encode(data));
          } catch {
            proc.kill();
          }
        }
      });

      proc.stderr.on('data', () => {});

      proc.on('close', () => {
        try { controller.close(); } catch {}
      });

      // Clean up when client disconnects
      request.signal.addEventListener('abort', () => {
        proc.kill();
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
