/**
 * Heavy metrics collector — runs every 60s via systemd timer. Writes:
 *  - metric_process (pinned systemd services + user-pinned + dynamic top-N by CPU/RSS)
 *  - metric_net     (per-interface counters)
 *  - metric_disk    (per-whole-disk counters)
 *
 * Also prunes rows older than RETENTION_DAYS in all metric_* tables.
 *
 * CPU% is computed from the delta vs the previous tick's /proc snapshot, cached
 * at $PROC_PREV_CACHE (default /run/devys-metrics/proc-prev.json). PID recycling
 * is handled by keying the cache on `${pid}:${starttime}` from /proc/[pid]/stat.
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { makePool } from '../src/lib/db';

const pool = makePool('workshop');

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
  'minecraft-star-technology',
  'minecraft-tekkit',
];

const RETENTION_DAYS = 30;
const TOP_N_CPU = 15;
const TOP_N_RSS = 15;
const PREV_CACHE = process.env.PROC_PREV_CACHE ?? '/run/devys-metrics/proc-prev.json';
const PAGE_SIZE = BigInt(os.constants.signals ? 4096 : 4096); // /proc reports RSS in pages; Linux x86_64 = 4096
const CLOCK_TICKS = 100n; // sysconf(_SC_CLK_TCK) — 100 on virtually all Linux distros incl. Ubuntu
const NUM_CORES = BigInt(os.cpus().length);

interface ProcSample {
  pid: number;
  comm: string;
  starttime: bigint;  // /proc/<pid>/stat field 22 — jiffies since boot
  utime: bigint;
  stime: bigint;
  rssPages: bigint;
  threads: number;
}

interface CacheEntry { utime: string; stime: string; starttime: string; sampledAt: number }
type Cache = Record<string, CacheEntry>;  // key = `${pid}:${starttime}`

async function readPrevCache(): Promise<{ prev: Cache; prevSampledAt: number }> {
  try {
    const txt = await fs.readFile(PREV_CACHE, 'utf-8');
    const parsed = JSON.parse(txt) as { sampledAt: number; entries: Cache };
    return { prev: parsed.entries ?? {}, prevSampledAt: parsed.sampledAt ?? 0 };
  } catch {
    return { prev: {}, prevSampledAt: 0 };
  }
}

async function writePrevCache(entries: Cache, sampledAt: number): Promise<void> {
  await fs.mkdir(path.dirname(PREV_CACHE), { recursive: true }).catch(() => {});
  await fs.writeFile(PREV_CACHE, JSON.stringify({ sampledAt, entries }), 'utf-8');
}

function parseProcStat(raw: string): Omit<ProcSample, 'pid'> | null {
  // comm is wrapped in parens and can contain spaces and even ')'. Standard trick:
  // find the LAST ')' and split fields after that.
  const closeIdx = raw.lastIndexOf(')');
  const openIdx = raw.indexOf('(');
  if (closeIdx < 0 || openIdx < 0 || openIdx > closeIdx) return null;
  const comm = raw.slice(openIdx + 1, closeIdx);
  const tail = raw.slice(closeIdx + 2).trim().split(/\s+/);
  // After comm, field indices (0-based into `tail`) per proc(5):
  //   tail[0] = state         (field 3 overall)
  //   tail[11] = utime        (field 14)
  //   tail[12] = stime        (field 15)
  //   tail[17] = num_threads  (field 20)
  //   tail[19] = starttime    (field 22)
  //   tail[21] = rss (pages)  (field 24)
  if (tail.length < 22) return null;
  return {
    comm,
    utime: BigInt(tail[11]),
    stime: BigInt(tail[12]),
    threads: parseInt(tail[17]),
    starttime: BigInt(tail[19]),
    rssPages: BigInt(tail[21]),
  };
}

async function walkProcs(): Promise<ProcSample[]> {
  const entries = await fs.readdir('/proc');
  const out: ProcSample[] = [];
  await Promise.all(entries.map(async (name) => {
    if (!/^\d+$/.test(name)) return;
    const pid = parseInt(name);
    try {
      const raw = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
      const parsed = parseProcStat(raw);
      if (!parsed) return;
      if (parsed.rssPages === 0n) return; // skip kernel threads
      out.push({ pid, ...parsed });
    } catch {
      // Process exited mid-read; ignore.
    }
  }));
  return out;
}

interface PinnedTarget { label: string; comm: string }

async function readUserPins(): Promise<PinnedTarget[]> {
  const { rows } = await pool.query<{ label: string; comm: string }>(
    'SELECT label, comm FROM metric_pin_config'
  );
  return rows.map((r) => ({ label: r.label, comm: r.comm }));
}

interface PinnedRow {
  label: string; pid: number; comm: string; rssBytes: bigint;
  cpuNs: bigint; cpuPercent: number; threads: number;
}

async function collectPinnedServices(): Promise<PinnedRow[]> {
  const out: PinnedRow[] = [];
  for (const svc of TRACKED_SERVICES) {
    try {
      const output = execSync(
        `systemctl show ${svc}.service --property=MemoryCurrent,CPUUsageNSec,MainPID,TasksCurrent --no-pager`,
        { timeout: 5000 },
      ).toString();
      const props: Record<string, string> = {};
      for (const line of output.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) props[line.substring(0, eq)] = line.substring(eq + 1);
      }
      const pid = parseInt(props['MainPID'] || '0');
      if (pid === 0) continue;
      const memBytes = BigInt(props['MemoryCurrent'] || '0');
      const cpuNs = BigInt(props['CPUUsageNSec'] || '0');
      const tasks = parseInt(props['TasksCurrent'] || '1') || 1;

      // CPU% comes from comparing cpuNs across ticks via the proc-prev cache.
      // We use a synthetic key for systemd services so they don't collide with /proc pids.
      out.push({ label: svc, pid, comm: svc, rssBytes: memBytes, cpuNs, cpuPercent: 0, threads: tasks });
    } catch { /* service may not exist on this box */ }
  }
  return out;
}

function dedupByComm(samples: ProcSample[], cpuMap: Map<string, number>): Map<string, {
  comm: string; totalCpu: number; totalRss: bigint; totalThreads: number; primaryPid: number; totalCpuNs: bigint;
}> {
  // CPU ns per pid: approximation — cumulative (utime+stime) * (1e9 / CLOCK_TICKS).
  const groups = new Map<string, { comm: string; totalCpu: number; totalRss: bigint; totalThreads: number; primaryPid: number; primaryRss: bigint; totalCpuNs: bigint }>();
  for (const s of samples) {
    const key = `${s.pid}:${s.starttime}`;
    const cpu = cpuMap.get(key) ?? 0;
    const cpuNs = (s.utime + s.stime) * (1_000_000_000n / CLOCK_TICKS);
    const rssBytes = s.rssPages * PAGE_SIZE;
    const existing = groups.get(s.comm);
    if (!existing) {
      groups.set(s.comm, {
        comm: s.comm, totalCpu: cpu, totalRss: rssBytes, totalThreads: s.threads,
        primaryPid: s.pid, primaryRss: rssBytes, totalCpuNs: cpuNs,
      });
    } else {
      existing.totalCpu += cpu;
      existing.totalRss += rssBytes;
      existing.totalThreads += s.threads;
      existing.totalCpuNs += cpuNs;
      if (rssBytes > existing.primaryRss) {
        existing.primaryPid = s.pid;
        existing.primaryRss = rssBytes;
      }
    }
  }
  return groups;
}

async function collectNet(client: import('pg').PoolClient): Promise<void> {
  const netDev = await fs.readFile('/proc/net/dev', 'utf-8');
  const ifaces: Array<{ iface: string; rxBytes: bigint; rxPackets: bigint; rxErrs: bigint; rxDrop: bigint; txBytes: bigint; txPackets: bigint; txErrs: bigint; txDrop: bigint }> = [];
  for (const line of netDev.split('\n')) {
    const m = line.match(/^\s*([^\s:]+):\s*(.*)/);
    if (!m) continue;
    const iface = m[1];
    if (iface === 'lo') continue;
    const v = m[2].trim().split(/\s+/).map((x) => BigInt(x));
    // rx_bytes, rx_packets, rx_errs, rx_drop, [skip 4], tx_bytes, tx_packets, tx_errs, tx_drop
    ifaces.push({
      iface,
      rxBytes: v[0], rxPackets: v[1], rxErrs: v[2], rxDrop: v[3],
      txBytes: v[8], txPackets: v[9], txErrs: v[10], txDrop: v[11],
    });
  }
  if (ifaces.length === 0) return;
  await client.query(
    `INSERT INTO metric_net (iface, rx_bytes, tx_bytes, rx_packets, tx_packets, rx_errs, rx_drop, tx_errs, tx_drop)
     SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[])`,
    [
      ifaces.map((x) => x.iface),
      ifaces.map((x) => x.rxBytes),
      ifaces.map((x) => x.txBytes),
      ifaces.map((x) => x.rxPackets),
      ifaces.map((x) => x.txPackets),
      ifaces.map((x) => x.rxErrs),
      ifaces.map((x) => x.rxDrop),
      ifaces.map((x) => x.txErrs),
      ifaces.map((x) => x.txDrop),
    ],
  );
}

async function collectDisk(client: import('pg').PoolClient): Promise<void> {
  const diskstats = await fs.readFile('/proc/diskstats', 'utf-8');
  const devs: Array<{ device: string; readsCompleted: bigint; sectorsRead: bigint; msReading: bigint; writesCompleted: bigint; sectorsWritten: bigint; msWriting: bigint; iosInProgress: number; msIo: bigint }> = [];
  for (const line of diskstats.split('\n')) {
    const m = line.match(/\s+\d+\s+\d+\s+(sd[a-z]+|nvme\d+n\d+|vd[a-z]+)\s+(.*)/);
    if (!m) continue;
    const device = m[1];
    const f = m[2].trim().split(/\s+/);
    devs.push({
      device,
      readsCompleted: BigInt(f[0]),
      sectorsRead: BigInt(f[2]),
      msReading: BigInt(f[3]),
      writesCompleted: BigInt(f[4]),
      sectorsWritten: BigInt(f[6]),
      msWriting: BigInt(f[7]),
      iosInProgress: parseInt(f[8]) || 0,
      msIo: BigInt(f[9] ?? '0'),
    });
  }
  if (devs.length === 0) return;
  await client.query(
    `INSERT INTO metric_disk (device, reads_completed, sectors_read, ms_reading, writes_completed, sectors_written, ms_writing, ios_in_progress, ms_io)
     SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[], $8::int[], $9::bigint[])`,
    [
      devs.map((x) => x.device),
      devs.map((x) => x.readsCompleted),
      devs.map((x) => x.sectorsRead),
      devs.map((x) => x.msReading),
      devs.map((x) => x.writesCompleted),
      devs.map((x) => x.sectorsWritten),
      devs.map((x) => x.msWriting),
      devs.map((x) => x.iosInProgress),
      devs.map((x) => x.msIo),
    ],
  );
}

async function pruneOld(client: import('pg').PoolClient): Promise<void> {
  const tables = ['metric_system_cpu', 'metric_system_cpu_core', 'metric_system_mem', 'metric_system_misc', 'metric_process', 'metric_net', 'metric_disk'];
  for (const t of tables) {
    await client.query(`DELETE FROM ${t} WHERE ts < now() - interval '${RETENTION_DAYS} days'`);
  }
}

async function main() {
  const now = Date.now();
  try {
    const [samples, { prev, prevSampledAt }, userPins, pinnedRows] = await Promise.all([
      walkProcs(),
      readPrevCache(),
      readUserPins(),
      collectPinnedServices(),
    ]);

    // Build CPU% map from prev cache.
    const elapsedSec = Math.max((now - prevSampledAt) / 1000, 0.001);
    const elapsedJiffies = BigInt(Math.round(elapsedSec * Number(CLOCK_TICKS)));
    const cpuMap = new Map<string, number>();
    const nextCache: Cache = {};
    for (const s of samples) {
      const key = `${s.pid}:${s.starttime}`;
      nextCache[key] = { utime: s.utime.toString(), stime: s.stime.toString(), starttime: s.starttime.toString(), sampledAt: now };
      const prevEntry = prev[key];
      if (prevEntry && elapsedJiffies > 0n) {
        const dj = (s.utime + s.stime) - (BigInt(prevEntry.utime) + BigInt(prevEntry.stime));
        if (dj >= 0n) {
          // Percent of one core, then normalize by core count to express as % of one logical CPU.
          // Use percent-of-one-core convention (top -1 style): can exceed 100% on multi-threaded processes.
          const pct = Number(dj) / Number(elapsedJiffies) * 100;
          cpuMap.set(key, pct);
        }
      }
    }

    // Group dynamic processes by comm.
    const grouped = dedupByComm(samples, cpuMap);

    // Build pinned comm set so we don't double-count when picking dynamic top-N.
    const pinnedCommSet = new Set<string>([
      ...pinnedRows.map((r) => r.comm),
      ...userPins.map((p) => p.comm),
    ]);

    // Apply user pins: pull them out of the grouped map into pinned-style rows.
    const userPinRows: PinnedRow[] = [];
    for (const p of userPins) {
      const g = grouped.get(p.comm);
      if (!g) continue;
      userPinRows.push({
        label: p.label, pid: g.primaryPid, comm: g.comm,
        rssBytes: g.totalRss, cpuNs: g.totalCpuNs, cpuPercent: g.totalCpu, threads: g.totalThreads,
      });
    }

    // Dynamic top-N: union of top-15 by CPU + top-15 by RSS, excluding pinned comms.
    const candidates = Array.from(grouped.values()).filter((g) => !pinnedCommSet.has(g.comm));
    const topCpu = [...candidates].sort((a, b) => b.totalCpu - a.totalCpu).slice(0, TOP_N_CPU);
    const topRss = [...candidates].sort((a, b) => Number(b.totalRss - a.totalRss)).slice(0, TOP_N_RSS);
    const dynamicSet = new Map<string, typeof topCpu[0]>();
    for (const x of [...topCpu, ...topRss]) dynamicSet.set(x.comm, x);
    const dynamicRows: PinnedRow[] = Array.from(dynamicSet.values()).map((g) => ({
      label: g.comm, pid: g.primaryPid, comm: g.comm,
      rssBytes: g.totalRss, cpuNs: g.totalCpuNs, cpuPercent: g.totalCpu, threads: g.totalThreads,
    }));

    // Estimate CPU% for pinned systemd services from CPUUsageNSec delta.
    // We need a prev cache for these too — reuse PREV_CACHE under synthetic keys.
    const pinnedKeyFor = (label: string) => `svc:${label}`;
    for (const row of pinnedRows) {
      const key = pinnedKeyFor(row.label);
      const prevEntry = prev[key];
      nextCache[key] = { utime: row.cpuNs.toString(), stime: '0', starttime: '0', sampledAt: now };
      if (prevEntry && now - prevEntry.sampledAt > 0) {
        const dNs = row.cpuNs - BigInt(prevEntry.utime);
        if (dNs >= 0n) {
          const elapsedNs = BigInt((now - prevEntry.sampledAt)) * 1_000_000n;
          if (elapsedNs > 0n) {
            row.cpuPercent = Number(dNs) / Number(elapsedNs) * 100;
          }
        }
      }
    }

    // Write everything in one transaction so all rows share NOW().
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const allProcessRows: Array<PinnedRow & { pinned: boolean }> = [
        ...pinnedRows.map((r) => ({ ...r, pinned: true })),
        ...userPinRows.map((r) => ({ ...r, pinned: true })),
        ...dynamicRows.map((r) => ({ ...r, pinned: false })),
      ];

      if (allProcessRows.length > 0) {
        await client.query(
          `INSERT INTO metric_process (label, pid, comm, pinned, rss_bytes, cpu_ns, cpu_percent, io_read_bytes, io_write_bytes, threads)
           SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::bool[], $5::bigint[], $6::bigint[], $7::real[], $8::bigint[], $9::bigint[], $10::int[])`,
          [
            allProcessRows.map((r) => r.label),
            allProcessRows.map((r) => r.pid),
            allProcessRows.map((r) => r.comm),
            allProcessRows.map((r) => r.pinned),
            allProcessRows.map((r) => r.rssBytes),
            allProcessRows.map((r) => r.cpuNs),
            allProcessRows.map((r) => r.cpuPercent),
            allProcessRows.map(() => 0n),
            allProcessRows.map(() => 0n),
            allProcessRows.map((r) => r.threads),
          ],
        );
      }

      await collectNet(client);
      await collectDisk(client);
      await pruneOld(client);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await writePrevCache(nextCache, now);
  } catch (err) {
    console.error('collect-heavy error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
