/**
 * System metrics collector — runs every 60s via systemd timer.
 * Collects: CPU, memory, temperature, per-process stats, disk I/O, network I/O.
 * Stores in system_metrics table. Prunes data older than 7 days.
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { Pool } from 'pg';

const pool = new Pool({
  user: 'server',
  password: 'workshop',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

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

const RETENTION_DAYS = 7;

async function collectSystem() {
  // CPU from /proc/stat
  const stat = await fs.readFile('/proc/stat', 'utf-8');
  const cpuLine = stat.split('\n')[0]; // aggregate "cpu" line
  const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;

  // Memory from /proc/meminfo
  const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
  const mem: Record<string, number> = {};
  for (const line of meminfo.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) mem[m[1]] = parseInt(m[2]) * 1024;
  }
  const memTotal = mem['MemTotal'] || 0;
  const memUsed = memTotal - (mem['MemAvailable'] || 0);
  const swapTotal = mem['SwapTotal'] || 0;
  const swapUsed = swapTotal - (mem['SwapFree'] || 0);

  // Load average
  const loadavg = (await fs.readFile('/proc/loadavg', 'utf-8')).trim().split(/\s+/);

  // Temperature
  let cpuTemp: number | null = null;
  try {
    cpuTemp = parseInt(await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8')) / 1000;
  } catch { /* unavailable */ }

  await pool.query(
    `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
    ['system', 'cpu', JSON.stringify({
      user, nice, system, idle, iowait, irq, softirq, steal, total,
      load1: parseFloat(loadavg[0]),
      load5: parseFloat(loadavg[1]),
      load15: parseFloat(loadavg[2]),
    })]
  );

  await pool.query(
    `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
    ['system', 'memory', JSON.stringify({
      total: memTotal,
      used: memUsed,
      available: mem['MemAvailable'] || 0,
      cached: mem['Cached'] || 0,
      buffers: mem['Buffers'] || 0,
      swapTotal,
      swapUsed,
      percentUsed: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
    })]
  );

  if (cpuTemp !== null) {
    await pool.query(
      `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
      ['system', 'temperature', JSON.stringify({ cpu: cpuTemp })]
    );
  }
}

async function collectProcesses() {
  for (const svc of TRACKED_SERVICES) {
    try {
      const output = execSync(
        `systemctl show ${svc}.service --property=MemoryCurrent,CPUUsageNSec,MainPID --no-pager`,
        { timeout: 5000 }
      ).toString();

      const props: Record<string, string> = {};
      for (const line of output.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) props[line.substring(0, eq)] = line.substring(eq + 1);
      }

      const memBytes = parseInt(props['MemoryCurrent'] || '0');
      const cpuNs = parseInt(props['CPUUsageNSec'] || '0');
      const pid = parseInt(props['MainPID'] || '0');

      if (pid === 0) continue; // service not running

      // Get RSS and CPU% from ps for the main PID
      let cpuPercent = 0;
      let rss = memBytes;
      try {
        const ps = execSync(`ps -p ${pid} -o pcpu=,rss= 2>/dev/null`, { timeout: 3000 }).toString().trim();
        const [cpu, rssKb] = ps.split(/\s+/);
        cpuPercent = parseFloat(cpu) || 0;
        if (rssKb) rss = parseInt(rssKb) * 1024;
      } catch { /* use cgroup values */ }

      await pool.query(
        `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
        ['process', svc, JSON.stringify({
          pid,
          memoryBytes: memBytes > 0 && !isNaN(memBytes) ? memBytes : rss,
          cpuNs,
          cpuPercent,
          rss,
        })]
      );
    } catch { /* service may not exist */ }
  }
}

async function collectNetwork() {
  const netDev = await fs.readFile('/proc/net/dev', 'utf-8');
  for (const line of netDev.split('\n')) {
    const match = line.match(/^\s*(eth\w+|enp\w+|wl\w+|eno\w+|tailscale\d+):\s*(.*)/);
    if (!match) continue;
    const iface = match[1];
    const vals = match[2].trim().split(/\s+/).map(Number);
    // Fields: rx_bytes rx_packets rx_errs rx_drop ... tx_bytes tx_packets tx_errs tx_drop ...
    await pool.query(
      `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
      ['network', iface, JSON.stringify({
        rxBytes: vals[0],
        rxPackets: vals[1],
        txBytes: vals[8],
        txPackets: vals[9],
      })]
    );
  }
}

async function collectDisk() {
  const diskstats = await fs.readFile('/proc/diskstats', 'utf-8');
  for (const line of diskstats.split('\n')) {
    // Match whole-disk devices (sda, sdb, nvme0n1 — not partitions)
    const match = line.match(/\s+\d+\s+\d+\s+(sd[a-z]+|nvme\d+n\d+)\s+(.*)/);
    if (!match) continue;
    const device = match[1];
    const fields = match[2].trim().split(/\s+/).map(Number);
    // See https://www.kernel.org/doc/Documentation/block/stat.txt
    // fields: reads_completed reads_merged sectors_read ms_reading writes_completed writes_merged sectors_written ms_writing ...
    await pool.query(
      `INSERT INTO system_metrics (kind, label, data) VALUES ($1, $2, $3)`,
      ['disk', device, JSON.stringify({
        readsCompleted: fields[0],
        sectorsRead: fields[2],
        msReading: fields[3],
        writesCompleted: fields[4],
        sectorsWritten: fields[6],
        msWriting: fields[7],
      })]
    );
  }
}

async function prune() {
  await pool.query(
    `DELETE FROM system_metrics WHERE ts < now() - interval '${RETENTION_DAYS} days'`
  );
}

async function main() {
  try {
    await Promise.all([
      collectSystem(),
      collectProcesses(),
      collectNetwork(),
      collectDisk(),
    ]);
    await prune();
  } catch (err) {
    console.error('Metrics collection error:', err);
  } finally {
    await pool.end();
  }
}

main();
