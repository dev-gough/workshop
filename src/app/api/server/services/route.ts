import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

// Services to show on the dashboard
const TRACKED_SERVICES = [
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

interface ServiceInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
  enabled: boolean;
  description: string;
  activeState: string;
  subState: string;
  pid: number | null;
  memory: string | null;
  uptime: string | null;
  startedAt: string | null;
}

function getServiceInfo(name: string): ServiceInfo {
  try {
    const output = execSync(
      `systemctl show ${name}.service --no-pager --property=ActiveState,SubState,Description,MainPID,MemoryCurrent,ActiveEnterTimestamp,UnitFileState 2>/dev/null`,
      { timeout: 5000 }
    ).toString();

    const props: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        props[line.substring(0, eq)] = line.substring(eq + 1);
      }
    }

    const activeState = props['ActiveState'] || 'unknown';
    const pid = parseInt(props['MainPID'] || '0');
    const memBytes = parseInt(props['MemoryCurrent'] || '0');
    const startedAt = props['ActiveEnterTimestamp'] || null;

    let status: ServiceInfo['status'] = 'unknown';
    if (activeState === 'active') status = 'running';
    else if (activeState === 'inactive' || activeState === 'deactivating') status = 'stopped';
    else if (activeState === 'failed') status = 'failed';

    return {
      name,
      displayName: props['Description'] || name,
      status,
      enabled: props['UnitFileState'] === 'enabled',
      description: props['Description'] || '',
      activeState,
      subState: props['SubState'] || '',
      pid: pid > 0 ? pid : null,
      memory: memBytes > 0 && !isNaN(memBytes) ? formatBytes(memBytes) : null,
      uptime: startedAt && status === 'running' ? startedAt : null,
      startedAt,
    };
  } catch {
    return {
      name,
      displayName: name,
      status: 'unknown',
      enabled: false,
      description: '',
      activeState: 'unknown',
      subState: '',
      pid: null,
      memory: null,
      uptime: null,
      startedAt: null,
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export async function GET() {
  try {
    const services = TRACKED_SERVICES.map(getServiceInfo);
    return NextResponse.json({ services });
  } catch (error) {
    console.error('Services error:', error);
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, action } = await request.json();

    if (!service || !action) {
      return NextResponse.json({ error: 'Missing service or action' }, { status: 400 });
    }

    if (!TRACKED_SERVICES.includes(service)) {
      return NextResponse.json({ error: 'Service not tracked' }, { status: 403 });
    }

    if (!['start', 'stop', 'restart'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Don't allow stopping the workshop service from the dashboard (it would kill itself)
    if (service === 'workshop' && action === 'stop') {
      return NextResponse.json({ error: 'Cannot stop the workshop service from the dashboard' }, { status: 400 });
    }

    execSync(`sudo systemctl ${action} ${service}.service`, { timeout: 30000 });

    // Wait a moment for state to settle
    await new Promise(r => setTimeout(r, 1000));

    const info = getServiceInfo(service);
    return NextResponse.json({ success: true, service: info });
  } catch (error) {
    console.error('Service action error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Action failed: ${message}` }, { status: 500 });
  }
}
