import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

function parseCpuLine(line: string): CpuTimes {
  const parts = line.trim().split(/\s+/);
  return {
    user: parseInt(parts[1]),
    nice: parseInt(parts[2]),
    system: parseInt(parts[3]),
    idle: parseInt(parts[4]),
    iowait: parseInt(parts[5]) || 0,
    irq: parseInt(parts[6]) || 0,
    softirq: parseInt(parts[7]) || 0,
    steal: parseInt(parts[8]) || 0,
  };
}

function cpuPercent(t: CpuTimes): number {
  const total = t.user + t.nice + t.system + t.idle + t.iowait + t.irq + t.softirq + t.steal;
  const idle = t.idle + t.iowait;
  return total > 0 ? Math.round(((total - idle) / total) * 1000) / 10 : 0;
}

export async function GET() {
  try {
    // Memory
    const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
    const memLines: Record<string, number> = {};
    for (const line of meminfo.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (match) memLines[match[1]] = parseInt(match[2]) * 1024; // convert kB to bytes
    }
    const memTotal = memLines['MemTotal'] || 0;
    const memAvailable = memLines['MemAvailable'] || 0;
    const memUsed = memTotal - memAvailable;
    const swapTotal = memLines['SwapTotal'] || 0;
    const swapFree = memLines['SwapFree'] || 0;

    // CPU - use load averages (instant snapshot, no delay needed)
    const loadavg = (await fs.readFile('/proc/loadavg', 'utf-8')).trim().split(/\s+/);
    const cpuCount = parseInt(execSync('nproc').toString().trim());

    // Per-CPU usage snapshot from /proc/stat
    const stat = await fs.readFile('/proc/stat', 'utf-8');
    const cpuLines = stat.split('\n').filter(l => l.startsWith('cpu'));
    const cpuTotal = parseCpuLine(cpuLines[0]); // aggregate "cpu" line
    const perCore = cpuLines.slice(1).map(parseCpuLine);

    // Uptime
    const uptimeRaw = (await fs.readFile('/proc/uptime', 'utf-8')).trim().split(/\s+/);
    const uptimeSeconds = Math.floor(parseFloat(uptimeRaw[0]));

    // Disk
    const dfOutput = execSync('df -B1 --output=source,size,used,avail,pcent,target 2>/dev/null || df -k').toString();
    const disks = dfOutput
      .split('\n')
      .slice(1)
      .filter(l => l.startsWith('/dev/'))
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          device: parts[0],
          total: parseInt(parts[1]),
          used: parseInt(parts[2]),
          available: parseInt(parts[3]),
          percentUsed: parseInt(parts[4]),
          mountPoint: parts[5],
        };
      });

    // CPU temperature (if available)
    let cpuTemp: number | null = null;
    try {
      const temp = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
      cpuTemp = parseInt(temp.trim()) / 1000;
    } catch { /* not available */ }

    // Hostname
    const hostname = (await fs.readFile('/etc/hostname', 'utf-8')).trim();

    // OS info
    let osInfo = 'Linux';
    try {
      const release = await fs.readFile('/etc/os-release', 'utf-8');
      const pretty = release.match(/PRETTY_NAME="(.+)"/);
      if (pretty) osInfo = pretty[1];
    } catch { /* fallback */ }

    // Kernel
    const kernel = execSync('uname -r').toString().trim();

    return NextResponse.json({
      hostname,
      os: osInfo,
      kernel,
      cpuCount,
      cpuTemp,
      loadAverage: {
        '1m': parseFloat(loadavg[0]),
        '5m': parseFloat(loadavg[1]),
        '15m': parseFloat(loadavg[2]),
      },
      cpuUsage: cpuPercent(cpuTotal),
      perCoreUsage: perCore.map(cpuPercent),
      memory: {
        total: memTotal,
        used: memUsed,
        available: memAvailable,
        percentUsed: Math.round((memUsed / memTotal) * 1000) / 10,
      },
      swap: {
        total: swapTotal,
        used: swapTotal - swapFree,
        free: swapFree,
      },
      disks,
      uptimeSeconds,
    });
  } catch (error) {
    console.error('Server stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch server stats' }, { status: 500 });
  }
}
