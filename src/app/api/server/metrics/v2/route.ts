import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── Kind configuration ──────────────────────────────────────────────────────
// Each kind maps to one of the metric_* tables and lists its columns. Counter
// columns are stored cumulatively in the DB; we compute per-second rates via
// LAG() before bucketing. Gauge columns are averaged within a bucket.

type ColType = 'gauge' | 'counter';
interface ColSpec { name: string; col: string; type: ColType }

interface KindSpec {
  table: string;
  labelCol?: string;          // present iff the table has a label dimension
  collectionPeriodSec: number; // minimum bucket size
  cols: ColSpec[];
}

const KINDS: Record<string, KindSpec> = {
  'system.cpu': {
    table: 'metric_system_cpu',
    collectionPeriodSec: 15,
    cols: [
      { name: 'userJiffies', col: 'user_j', type: 'counter' },
      { name: 'niceJiffies', col: 'nice_j', type: 'counter' },
      { name: 'systemJiffies', col: 'system_j', type: 'counter' },
      { name: 'idleJiffies', col: 'idle_j', type: 'counter' },
      { name: 'iowaitJiffies', col: 'iowait_j', type: 'counter' },
      { name: 'irqJiffies', col: 'irq_j', type: 'counter' },
      { name: 'softirqJiffies', col: 'softirq_j', type: 'counter' },
      { name: 'stealJiffies', col: 'steal_j', type: 'counter' },
      { name: 'totalJiffies', col: 'total_j', type: 'counter' },
      { name: 'load1', col: 'load1', type: 'gauge' },
      { name: 'load5', col: 'load5', type: 'gauge' },
      { name: 'load15', col: 'load15', type: 'gauge' },
    ],
  },
  'system.cpu_core': {
    table: 'metric_system_cpu_core',
    labelCol: 'core',
    collectionPeriodSec: 15,
    cols: [
      { name: 'userJiffies', col: 'user_j', type: 'counter' },
      { name: 'systemJiffies', col: 'system_j', type: 'counter' },
      { name: 'idleJiffies', col: 'idle_j', type: 'counter' },
      { name: 'iowaitJiffies', col: 'iowait_j', type: 'counter' },
      { name: 'totalJiffies', col: 'total_j', type: 'counter' },
    ],
  },
  'system.mem': {
    table: 'metric_system_mem',
    collectionPeriodSec: 15,
    cols: [
      { name: 'memTotal', col: 'mem_total', type: 'gauge' },
      { name: 'memUsed', col: 'mem_used', type: 'gauge' },
      { name: 'memAvailable', col: 'mem_available', type: 'gauge' },
      { name: 'cached', col: 'cached', type: 'gauge' },
      { name: 'buffers', col: 'buffers', type: 'gauge' },
      { name: 'swapTotal', col: 'swap_total', type: 'gauge' },
      { name: 'swapUsed', col: 'swap_used', type: 'gauge' },
      { name: 'swapInRate', col: 'swap_in_pages', type: 'counter' },
      { name: 'swapOutRate', col: 'swap_out_pages', type: 'counter' },
      { name: 'pageFaultsMinor', col: 'page_faults_minor', type: 'counter' },
      { name: 'pageFaultsMajor', col: 'page_faults_major', type: 'counter' },
    ],
  },
  'system.misc': {
    table: 'metric_system_misc',
    collectionPeriodSec: 15,
    cols: [
      { name: 'ctxSwitches', col: 'ctx_switches', type: 'counter' },
      { name: 'procsRunning', col: 'procs_running', type: 'gauge' },
      { name: 'procsBlocked', col: 'procs_blocked', type: 'gauge' },
      { name: 'fdOpen', col: 'fd_open', type: 'gauge' },
      { name: 'tcpEstablished', col: 'tcp_established', type: 'gauge' },
      { name: 'tcpTimeWait', col: 'tcp_time_wait', type: 'gauge' },
      { name: 'cpuTempC', col: 'cpu_temp_c', type: 'gauge' },
    ],
  },
  'process': {
    table: 'metric_process',
    labelCol: 'label',
    collectionPeriodSec: 60,
    cols: [
      { name: 'rssBytes', col: 'rss_bytes', type: 'gauge' },
      { name: 'cpuPercent', col: 'cpu_percent', type: 'gauge' },
      { name: 'threads', col: 'threads', type: 'gauge' },
      { name: 'cpuNs', col: 'cpu_ns', type: 'counter' },
      { name: 'ioReadBytes', col: 'io_read_bytes', type: 'counter' },
      { name: 'ioWriteBytes', col: 'io_write_bytes', type: 'counter' },
    ],
  },
  'net': {
    table: 'metric_net',
    labelCol: 'iface',
    collectionPeriodSec: 60,
    cols: [
      { name: 'rxBytesRate', col: 'rx_bytes', type: 'counter' },
      { name: 'txBytesRate', col: 'tx_bytes', type: 'counter' },
      { name: 'rxPacketsRate', col: 'rx_packets', type: 'counter' },
      { name: 'txPacketsRate', col: 'tx_packets', type: 'counter' },
      { name: 'rxErrsRate', col: 'rx_errs', type: 'counter' },
      { name: 'rxDropRate', col: 'rx_drop', type: 'counter' },
      { name: 'txErrsRate', col: 'tx_errs', type: 'counter' },
      { name: 'txDropRate', col: 'tx_drop', type: 'counter' },
    ],
  },
  'disk': {
    table: 'metric_disk',
    labelCol: 'device',
    collectionPeriodSec: 60,
    cols: [
      { name: 'readsRate', col: 'reads_completed', type: 'counter' },
      { name: 'writesRate', col: 'writes_completed', type: 'counter' },
      { name: 'readBytesRate', col: 'sectors_read', type: 'counter' },     // 1 sector = 512 bytes (client multiplies)
      { name: 'writeBytesRate', col: 'sectors_written', type: 'counter' },
      { name: 'msReadingRate', col: 'ms_reading', type: 'counter' },
      { name: 'msWritingRate', col: 'ms_writing', type: 'counter' },
      { name: 'iosInProgress', col: 'ios_in_progress', type: 'gauge' },
      { name: 'msIoRate', col: 'ms_io', type: 'counter' },
    ],
  },
};

// Nice bucket sizes in seconds — server snaps to the smallest of these
// that's >= the computed raw bucket and >= the kind's collection period.
const NICE_BUCKETS_SEC = [5, 15, 30, 60, 300, 900, 3600, 21600, 86400];

const MAX_WINDOW_SEC = 30 * 24 * 3600;

function pickBucketSec(spec: KindSpec, fromMs: number, toMs: number, maxPoints: number): number {
  const windowSec = Math.max((toMs - fromMs) / 1000, 1);
  const raw = Math.max(windowSec / maxPoints, spec.collectionPeriodSec);
  for (const n of NICE_BUCKETS_SEC) if (n >= raw) return n;
  return NICE_BUCKETS_SEC[NICE_BUCKETS_SEC.length - 1];
}

// Build the SQL for a kind. We use a CTE that adds LAG-based deltas for counter
// columns, then date_bin + aggregate.
function buildSql(spec: KindSpec, hasLabelFilter: boolean): string {
  const labelExpr = spec.labelCol ?? "''";
  const partitionClause = spec.labelCol ? `PARTITION BY ${spec.labelCol}` : '';
  const counterCols = spec.cols.filter((c) => c.type === 'counter');
  const gaugeCols = spec.cols.filter((c) => c.type === 'gauge');

  const deltaSelects = counterCols.map((c) => {
    // Rate = (col - LAG(col)) / EXTRACT(EPOCH FROM ts - LAG(ts)); guard reset.
    return `CASE WHEN ${c.col} >= LAG(${c.col}) OVER (${partitionClause} ORDER BY ts)
              THEN (${c.col} - LAG(${c.col}) OVER (${partitionClause} ORDER BY ts))::float8
                / NULLIF(EXTRACT(EPOCH FROM ts - LAG(ts) OVER (${partitionClause} ORDER BY ts)), 0)
              ELSE NULL END AS "${c.name}_rate"`;
  });

  const aggSelects: string[] = [
    `date_bin($3::interval, ts, TIMESTAMPTZ 'epoch') AS bucket`,
    spec.labelCol ? `${spec.labelCol}::text AS label` : `''::text AS label`,
    ...counterCols.map((c) => `avg("${c.name}_rate") AS "${c.name}"`),
    ...gaugeCols.map((c) => `avg(${c.col}::float8) AS "${c.name}"`),
  ];

  const filterClause = hasLabelFilter && spec.labelCol ? `AND ${spec.labelCol}::text = ANY($4::text[])` : '';

  return `
    WITH ranked AS (
      SELECT ts, ${spec.labelCol ? `${spec.labelCol},` : ''}
             ${gaugeCols.map((c) => c.col).join(', ')}${gaugeCols.length && counterCols.length ? ',' : ''}
             ${deltaSelects.join(',\n             ')}
      FROM ${spec.table}
      WHERE ts BETWEEN $1 AND $2 ${filterClause}
    )
    SELECT ${aggSelects.join(',\n           ')}
    FROM ranked
    GROUP BY bucket${spec.labelCol ? `, ${spec.labelCol}` : ''}
    ORDER BY bucket ASC${spec.labelCol ? `, label` : ''}
  `;
}

interface BucketRow {
  bucket: Date;
  label: string;
  [field: string]: number | string | Date | null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind');
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const maxPointsStr = url.searchParams.get('maxPoints');
    const labelsStr = url.searchParams.get('labels');

    if (!kind || !(kind in KINDS)) {
      return NextResponse.json({ error: `Unknown kind: ${kind}. Valid: ${Object.keys(KINDS).join(', ')}` }, { status: 400 });
    }
    const spec = KINDS[kind];

    const now = Date.now();
    const to = toStr ? new Date(toStr).getTime() : now;
    const from = fromStr ? new Date(fromStr).getTime() : (to - 3600_000);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) {
      return NextResponse.json({ error: 'Invalid from/to' }, { status: 400 });
    }
    if ((to - from) / 1000 > MAX_WINDOW_SEC) {
      return NextResponse.json({ error: `Window exceeds ${MAX_WINDOW_SEC / 3600}h max` }, { status: 400 });
    }

    const maxPoints = Math.max(1, Math.min(parseInt(maxPointsStr || '500'), 5000));
    const bucketSec = pickBucketSec(spec, from, to, maxPoints);

    const labels = labelsStr ? labelsStr.split(',').map((s) => s.trim()).filter(Boolean) : null;
    const sql = buildSql(spec, !!labels);
    const params: unknown[] = [new Date(from), new Date(to), `${bucketSec} seconds`];
    if (labels) params.push(labels);

    const result = await pool.query<BucketRow>(sql, params);

    // Shape into { series: { label: [{ts, ...fields}] } }
    const series: Record<string, Array<Record<string, number | string | null>>> = {};
    for (const row of result.rows) {
      const label = row.label ?? '';
      if (!series[label]) series[label] = [];
      const point: Record<string, number | string | null> = { ts: (row.bucket as Date).toISOString() };
      for (const c of spec.cols) {
        const v = row[c.name];
        point[c.name] = v === null || v === undefined ? null : Number(v);
      }
      series[label].push(point);
    }

    return NextResponse.json({
      kind,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      bucketSec,
      multiLabel: !!spec.labelCol,
      series,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('metrics v2 error:', message);
    return NextResponse.json({ error: `metrics failed: ${message}` }, { status: 500 });
  }
}
