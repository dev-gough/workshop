import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const KIND_TO_TABLE_LABEL: Record<string, { table: string; col: string }> = {
  'process': { table: 'metric_process', col: 'label' },
  'net':     { table: 'metric_net',     col: 'iface' },
  'disk':    { table: 'metric_disk',    col: 'device' },
  'system.cpu_core': { table: 'metric_system_cpu_core', col: 'core' },
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind');
    const sinceStr = url.searchParams.get('since');
    const spec = kind ? KIND_TO_TABLE_LABEL[kind] : null;

    if (!spec) {
      return NextResponse.json({ error: `Unknown kind: ${kind}. Valid: ${Object.keys(KIND_TO_TABLE_LABEL).join(', ')}` }, { status: 400 });
    }

    const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 3600_000);

    // For metric_process, also return pinned status (any row with pinned=true since `since`).
    if (kind === 'process') {
      const { rows } = await pool.query<{ label: string; comm: string; pinned: boolean; last_seen: Date }>(
        `SELECT label,
                (array_agg(comm ORDER BY ts DESC))[1] AS comm,
                bool_or(pinned) AS pinned,
                max(ts) AS last_seen
         FROM metric_process
         WHERE ts >= $1
         GROUP BY label
         ORDER BY pinned DESC, last_seen DESC`,
        [since],
      );
      return NextResponse.json({ kind, labels: rows });
    }

    const { rows } = await pool.query<{ label: string; last_seen: Date }>(
      `SELECT ${spec.col}::text AS label, max(ts) AS last_seen
       FROM ${spec.table}
       WHERE ts >= $1
       GROUP BY ${spec.col}
       ORDER BY label`,
      [since],
    );
    return NextResponse.json({ kind, labels: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('labels v2 error:', message);
    return NextResponse.json({ error: `labels failed: ${message}` }, { status: 500 });
  }
}
