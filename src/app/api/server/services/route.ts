import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { getConfig } from '@/lib/config';
import { requireSetupToken } from '@/lib/admin-auth';
import { sendRconCommand } from '@/lib/rcon';
import {
  TRACKED_SERVICES,
  createServiceSnapshotCache,
  parseSystemctlSnapshot,
  type SystemdServiceState,
} from '@/lib/server-services';

export const dynamic = 'force-dynamic';

function jellyfinPort(): number {
  const j = getConfig().services.jellyfin;
  if (!j) return 8096;
  try { return Number(new URL(j.baseUrl).port) || 8096; } catch { return 8096; }
}

interface ServiceEndpoint {
  port: number;
  protocol?: string;
  label?: string;
}

const SERVICE_ENDPOINTS: Record<string, ServiceEndpoint[]> = {
  'nginx':                  [{ port: 80, protocol: 'http', label: 'Workshop' }],
  'jellyfin':               [{ port: jellyfinPort(), protocol: 'http', label: 'Jellyfin' }],
  'ssh':                    [{ port: 22, protocol: 'ssh' }],
  'postgresql@16-main':     [{ port: 5432, protocol: 'postgres', label: 'localhost only' }],
  'minecraft-atm10':        [{ port: 25565, label: 'Minecraft' }],
  'minecraft-atm6':         [{ port: 25565, label: 'Minecraft (shared port)' }],
  'minecraft-stoneblock3':  [{ port: 25567, label: 'Minecraft' }],
  'minecraft-meatballcraft': [{ port: 25568, label: 'Minecraft' }],
  'minecraft-atm9sky':      [{ port: 25569, label: 'Minecraft' }],
  'minecraft-above-beyond': [{ port: 25565, label: 'Minecraft (shared port)' }],
  'minecraft-star-technology': [{ port: 25566, label: 'Minecraft' }],
  'minecraft-tekkit':       [{ port: 25570, label: 'Minecraft (Tekkit Classic 1.2.5)' }],
  'minecraft-mcdev':        [{ port: 25571, label: 'Minecraft (MineColonies dev)' }, { port: 25601, protocol: 'http', label: 'World data (localhost only)' }],
};

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
  endpoints: ServiceEndpoint[] | null;
}

const SYSTEMCTL_PROPERTIES = [
  'Id',
  'ActiveState',
  'SubState',
  'Description',
  'MainPID',
  'MemoryCurrent',
  'ActiveEnterTimestamp',
  'UnitFileState',
  'ExecMainStatus',
].join(',');

function readSystemdServices(names: readonly string[]): SystemdServiceState[] {
  try {
    const output = execFileSync(
      'systemctl',
      ['show', ...names.map((name) => `${name}.service`), '--no-pager', `--property=${SYSTEMCTL_PROPERTIES}`],
      { timeout: 5000, encoding: 'utf8' },
    );
    return parseSystemctlSnapshot(output, names);
  } catch {
    return parseSystemctlSnapshot('', names);
  }
}

const snapshotCache = createServiceSnapshotCache({
  load: () => readSystemdServices(TRACKED_SERVICES),
});

function toServiceInfo(service: SystemdServiceState): ServiceInfo {
  const { memoryBytes, ...base } = service;
  return {
    ...base,
    memory: memoryBytes ? formatBytes(memoryBytes) : null,
    uptime: service.startedAt && service.status === 'running' ? service.startedAt : null,
    endpoints: SERVICE_ENDPOINTS[service.name] || null,
  };
}

function getServiceInfo(name: string): ServiceInfo {
  return toServiceInfo(readSystemdServices([name])[0]);
}

async function gracefulMinecraftStop(service: string): Promise<void> {
  const mc = getConfig().minecraftServers.find((s) => s.name === service);
  if (!mc) return;
  if (getServiceInfo(service).status !== 'running') return;

  try {
    await sendRconCommand(mc.host, mc.port, mc.password, 'stop');
  } catch (err) {
    console.warn(`RCON /stop failed for ${service}; falling back to systemctl:`, err);
    return;
  }

  // Wait for the unit to leave the active state (java finishing chunk saves).
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (getServiceInfo(service).status !== 'running') return;
  }
  console.warn(`RCON /stop for ${service} did not finish within 150s; systemctl will SIGTERM`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export async function GET() {
  try {
    const snapshot = snapshotCache.get();
    return NextResponse.json({
      services: snapshot.services.map(toServiceInfo),
      snapshot: {
        capturedAt: snapshot.capturedAt,
        cacheHit: snapshot.cacheHit,
        ttlMs: 4_000,
      },
    });
  } catch (error) {
    console.error('Services error:', error);
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireSetupToken(request);
  if (denied) return denied;

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

    snapshotCache.invalidate();

    // For Minecraft, prefer RCON /stop so the world saves cleanly and the unit
    // exits 0 instead of being SIGTERM'd to status 143.
    if ((action === 'stop' || action === 'restart') && service.startsWith('minecraft-')) {
      await gracefulMinecraftStop(service);
    }

    execFileSync('sudo', ['systemctl', action, `${service}.service`], { timeout: 180000 });

    // Wait a moment for state to settle
    await new Promise(r => setTimeout(r, 1000));

    const snapshot = snapshotCache.get(true);
    const info = snapshot.services.find((candidate) => candidate.name === service);
    return NextResponse.json({
      success: true,
      service: info ? toServiceInfo(info) : getServiceInfo(service),
      services: snapshot.services.map(toServiceInfo),
      snapshot: { capturedAt: snapshot.capturedAt, cacheHit: false, ttlMs: 4_000 },
    });
  } catch (error) {
    snapshotCache.invalidate();
    console.error('Service action error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Action failed: ${message}` }, { status: 500 });
  }
}
