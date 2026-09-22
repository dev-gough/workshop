// Single source of truth for the systemd services the dashboard tracks and is
// allowed to read logs from. The services route consumes the full list for its
// dashboard view; the logs routes derive their allow-list of names from it.
export const TRACKED_SERVICES = [
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
  'minecraft-star-technology',
  'minecraft-tekkit',
  // Scratch server for the MineColonies fork. Kept off this list while it was
  // purely a build target; it earns a place now that the village viewer reads
  // from it and "is it running" becomes a question worth answering from here.
  'minecraft-mcdev',
];

// Names permitted for log reads/streams (identical set to TRACKED_SERVICES).
export const ALLOWED_SERVICES = TRACKED_SERVICES;

export type ServiceStatus = 'running' | 'stopped' | 'failed' | 'unknown';

export interface SystemdServiceState {
  name: string;
  displayName: string;
  status: ServiceStatus;
  enabled: boolean;
  description: string;
  activeState: string;
  subState: string;
  pid: number | null;
  memoryBytes: number | null;
  startedAt: string | null;
}

export interface ServiceSnapshot {
  services: SystemdServiceState[];
  capturedAt: string;
  cacheHit: boolean;
}

interface SnapshotCacheOptions {
  load: () => SystemdServiceState[];
  ttlMs?: number;
  now?: () => number;
}

function unknownService(name: string): SystemdServiceState {
  return {
    name,
    displayName: name,
    status: 'unknown',
    enabled: false,
    description: '',
    activeState: 'unknown',
    subState: '',
    pid: null,
    memoryBytes: null,
    startedAt: null,
  };
}

function stateFromProperties(name: string, props: Record<string, string>): SystemdServiceState {
  const activeState = props.ActiveState || 'unknown';
  const exitCode = Number.parseInt(props.ExecMainStatus || '0', 10);
  const pid = Number.parseInt(props.MainPID || '0', 10);
  const memoryBytes = Number.parseInt(props.MemoryCurrent || '0', 10);

  let status: ServiceStatus = 'unknown';
  if (activeState === 'active') status = 'running';
  else if (activeState === 'inactive' || activeState === 'deactivating') status = 'stopped';
  else if (activeState === 'failed' && exitCode === 143) status = 'stopped';
  else if (activeState === 'failed') status = 'failed';

  return {
    name,
    displayName: props.Description || name,
    status,
    enabled: props.UnitFileState === 'enabled',
    description: props.Description || '',
    activeState,
    subState: props.SubState || '',
    pid: pid > 0 ? pid : null,
    memoryBytes: memoryBytes > 0 && Number.isFinite(memoryBytes) ? memoryBytes : null,
    startedAt: props.ActiveEnterTimestamp || null,
  };
}

/**
 * Parse one `systemctl show` invocation containing multiple units. Results are
 * returned in requested order and missing units remain visible as unknown.
 */
export function parseSystemctlSnapshot(
  output: string,
  names: readonly string[] = TRACKED_SERVICES,
): SystemdServiceState[] {
  const byName = new Map<string, SystemdServiceState>();

  for (const block of output.trim().split(/\n\s*\n/)) {
    const props: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const equals = line.indexOf('=');
      if (equals > 0) props[line.slice(0, equals)] = line.slice(equals + 1);
    }

    const id = props.Id;
    if (!id) continue;
    const name = id.endsWith('.service') ? id.slice(0, -'.service'.length) : id;
    if (names.includes(name)) byName.set(name, stateFromProperties(name, props));
  }

  return names.map((name) => byName.get(name) ?? unknownService(name));
}

/**
 * Small dependency-injected cache used by the services route. `invalidate`
 * deliberately drops the whole batch because systemd actions can affect
 * dependent units as well as the unit directly acted on.
 */
export function createServiceSnapshotCache({
  load,
  ttlMs = 4_000,
  now = Date.now,
}: SnapshotCacheOptions) {
  let cached: { services: SystemdServiceState[]; capturedAtMs: number } | null = null;

  return {
    get(force = false): ServiceSnapshot {
      const currentTime = now();
      if (!force && cached && currentTime - cached.capturedAtMs < ttlMs) {
        return {
          services: cached.services,
          capturedAt: new Date(cached.capturedAtMs).toISOString(),
          cacheHit: true,
        };
      }

      const services = load();
      const capturedAtMs = now();
      cached = { services, capturedAtMs };
      return {
        services,
        capturedAt: new Date(capturedAtMs).toISOString(),
        cacheHit: false,
      };
    },
    invalidate(): void {
      cached = null;
    },
  };
}
