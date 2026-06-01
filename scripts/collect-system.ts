/**
 * Lightweight system-level metrics collector. Runs every 15s via systemd timer.
 * Writes to metric_system_cpu, metric_system_cpu_core, metric_system_mem,
 * metric_system_misc. All four inserts share one transaction so they get an
 * identical NOW() and downstream joins line up.
 */

import { promises as fs } from 'fs';
import { makePool } from '../src/lib/db';

const pool = makePool('workshop');

async function readAggregateAndCoreCpu(): Promise<{
  agg: { user: bigint; nice: bigint; system: bigint; idle: bigint; iowait: bigint; irq: bigint; softirq: bigint; steal: bigint; total: bigint };
  cores: Array<{ core: number; user: bigint; system: bigint; idle: bigint; iowait: bigint; total: bigint }>;
}> {
  const stat = await fs.readFile('/proc/stat', 'utf-8');
  const lines = stat.split('\n');
  let agg!: { user: bigint; nice: bigint; system: bigint; idle: bigint; iowait: bigint; irq: bigint; softirq: bigint; steal: bigint; total: bigint };
  const cores: Array<{ core: number; user: bigint; system: bigint; idle: bigint; iowait: bigint; total: bigint }> = [];

  for (const line of lines) {
    if (!line.startsWith('cpu')) break;
    const parts = line.trim().split(/\s+/);
    const tag = parts[0];
    const v = parts.slice(1).map((x) => BigInt(x));
    const [user, nice, system, idle, iowait, irq, softirq, steal] = v;
    const total = user + nice + system + idle + iowait + irq + softirq + steal;
    if (tag === 'cpu') {
      agg = { user, nice, system, idle, iowait, irq, softirq, steal, total };
    } else {
      const core = parseInt(tag.slice(3));
      if (!Number.isNaN(core)) cores.push({ core, user, system, idle, iowait, total });
    }
  }
  return { agg, cores };
}

async function readLoadavg(): Promise<[number, number, number]> {
  const txt = (await fs.readFile('/proc/loadavg', 'utf-8')).trim().split(/\s+/);
  return [parseFloat(txt[0]), parseFloat(txt[1]), parseFloat(txt[2])];
}

async function readMeminfo(): Promise<Record<string, bigint>> {
  const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
  const out: Record<string, bigint> = {};
  for (const line of meminfo.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) out[m[1]] = BigInt(m[2]) * 1024n; // kB → bytes
  }
  return out;
}

async function readVmstat(): Promise<Record<string, bigint>> {
  const vmstat = await fs.readFile('/proc/vmstat', 'utf-8');
  const out: Record<string, bigint> = {};
  for (const line of vmstat.split('\n')) {
    const m = line.match(/^(\S+)\s+(\d+)/);
    if (m) out[m[1]] = BigInt(m[2]);
  }
  return out;
}

async function readLoadProcsAndCtx(): Promise<{ ctx: bigint; procsRunning: number; procsBlocked: number }> {
  const stat = await fs.readFile('/proc/stat', 'utf-8');
  let ctx = 0n;
  let procsRunning = 0;
  let procsBlocked = 0;
  for (const line of stat.split('\n')) {
    if (line.startsWith('ctxt ')) ctx = BigInt(line.slice(5).trim());
    else if (line.startsWith('procs_running ')) procsRunning = parseInt(line.slice(14).trim());
    else if (line.startsWith('procs_blocked ')) procsBlocked = parseInt(line.slice(14).trim());
  }
  return { ctx, procsRunning, procsBlocked };
}

async function readFdOpen(): Promise<number> {
  try {
    const txt = (await fs.readFile('/proc/sys/fs/file-nr', 'utf-8')).trim();
    return parseInt(txt.split(/\s+/)[0]);
  } catch { return 0; }
}

async function readTcpCounts(): Promise<{ established: number; timeWait: number }> {
  let established = 0;
  let timeWait = 0;
  try {
    const snmp = await fs.readFile('/proc/net/snmp', 'utf-8');
    // Two consecutive "Tcp:" lines — first is the header, second is values.
    const tcpLines = snmp.split('\n').filter((l) => l.startsWith('Tcp:'));
    if (tcpLines.length >= 2) {
      const header = tcpLines[0].split(/\s+/);
      const values = tcpLines[1].split(/\s+/);
      const idx = header.indexOf('CurrEstab');
      if (idx > 0) established = parseInt(values[idx]) || 0;
    }
  } catch { /* skip */ }
  try {
    const sockstat = await fs.readFile('/proc/net/sockstat', 'utf-8');
    for (const line of sockstat.split('\n')) {
      // "TCP: inuse N orphan N tw N alloc N mem N"
      if (line.startsWith('TCP:')) {
        const m = line.match(/tw\s+(\d+)/);
        if (m) timeWait = parseInt(m[1]) || 0;
      }
    }
  } catch { /* skip */ }
  return { established, timeWait };
}

async function readCpuTemp(): Promise<number | null> {
  try {
    const t = parseInt(await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8'));
    if (!Number.isFinite(t)) return null;
    return t / 1000;
  } catch { return null; }
}

async function main() {
  try {
    const [
      { agg, cores },
      load,
      mem,
      vm,
      ctxAndProcs,
      fdOpen,
      tcp,
      cpuTemp,
    ] = await Promise.all([
      readAggregateAndCoreCpu(),
      readLoadavg(),
      readMeminfo(),
      readVmstat(),
      readLoadProcsAndCtx(),
      readFdOpen(),
      readTcpCounts(),
      readCpuTemp(),
    ]);

    const memTotal = mem['MemTotal'] ?? 0n;
    const memAvailable = mem['MemAvailable'] ?? 0n;
    const memUsed = memTotal - memAvailable;
    const swapTotal = mem['SwapTotal'] ?? 0n;
    const swapUsed = swapTotal - (mem['SwapFree'] ?? 0n);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO metric_system_cpu
         (user_j, nice_j, system_j, idle_j, iowait_j, irq_j, softirq_j, steal_j, total_j, load1, load5, load15)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [agg.user, agg.nice, agg.system, agg.idle, agg.iowait, agg.irq, agg.softirq, agg.steal, agg.total,
          load[0], load[1], load[2]],
      );

      // Per-core: one row per core in a single INSERT with UNNEST.
      if (cores.length > 0) {
        await client.query(
          `INSERT INTO metric_system_cpu_core (core, user_j, system_j, idle_j, iowait_j, total_j)
           SELECT * FROM UNNEST($1::smallint[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[])`,
          [
            cores.map((c) => c.core),
            cores.map((c) => c.user),
            cores.map((c) => c.system),
            cores.map((c) => c.idle),
            cores.map((c) => c.iowait),
            cores.map((c) => c.total),
          ],
        );
      }

      await client.query(
        `INSERT INTO metric_system_mem
         (mem_total, mem_used, mem_available, cached, buffers, swap_total, swap_used,
          swap_in_pages, swap_out_pages, page_faults_minor, page_faults_major)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          memTotal, memUsed, memAvailable,
          mem['Cached'] ?? 0n, mem['Buffers'] ?? 0n,
          swapTotal, swapUsed,
          vm['pswpin'] ?? 0n, vm['pswpout'] ?? 0n,
          (vm['pgfault'] ?? 0n) - (vm['pgmajfault'] ?? 0n),
          vm['pgmajfault'] ?? 0n,
        ],
      );

      await client.query(
        `INSERT INTO metric_system_misc
         (ctx_switches, procs_running, procs_blocked, fd_open, tcp_established, tcp_time_wait, cpu_temp_c)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctxAndProcs.ctx, ctxAndProcs.procsRunning, ctxAndProcs.procsBlocked,
          fdOpen, tcp.established, tcp.timeWait, cpuTemp],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('collect-system error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
