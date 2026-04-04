import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    const lines = Math.min(parseInt(searchParams.get('lines') || '100'), 500);
    const since = searchParams.get('since') || '1h';

    if (!service) {
      return NextResponse.json({ error: 'Missing service parameter' }, { status: 400 });
    }

    if (!ALLOWED_SERVICES.includes(service)) {
      return NextResponse.json({ error: 'Service not allowed' }, { status: 403 });
    }

    // Validate since parameter (e.g., "1h", "30m", "1d", "today")
    if (!/^\d+[smhd]$|^today$|^yesterday$/.test(since)) {
      return NextResponse.json({ error: 'Invalid since parameter' }, { status: 400 });
    }

    const output = execSync(
      `journalctl -u ${service}.service --no-pager -n ${lines} --since "${since} ago" --output=short-iso 2>&1`,
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    ).toString();

    const logLines = output
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('-- '))
      .map(line => {
        // Parse ISO timestamp from journalctl short-iso format
        const match = line.match(/^(\S+)\s+(\S+)\s+(\S+?)(?:\[\d+\])?:\s*(.*)/);
        if (match) {
          return {
            timestamp: match[1],
            hostname: match[2],
            unit: match[3],
            message: match[4],
          };
        }
        return { timestamp: '', hostname: '', unit: '', message: line };
      });

    return NextResponse.json({ service, lines: logLines, count: logLines.length });
  } catch (error) {
    console.error('Logs error:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
