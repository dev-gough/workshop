import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/server/metrics/multi?kind=process&range=1h
 *
 * Returns all labels for a given kind, bucketed by time.
 * Useful for per-process charts where you need all services at once.
 */

const RANGE_MAP: Record<string, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '7d': '7 days',
};

const BUCKET_MS: Record<string, number> = {
  '1h': 60000,
  '6h': 300000,
  '24h': 900000,
  '7d': 3600000,
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind') || 'process';
    const range = searchParams.get('range') || '1h';

    if (!RANGE_MAP[range]) {
      return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
    }
    if (!/^[a-z]+$/.test(kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    const interval = RANGE_MAP[range];
    const bucketMs = BUCKET_MS[range];

    const { rows } = await pool.query(
      `SELECT label, ts, data
       FROM system_metrics
       WHERE kind = $1 AND ts > now() - interval '${interval}'
       ORDER BY ts ASC`,
      [kind]
    );

    // Group by label, then bucket by time
    const byLabel: Record<string, { ts: string; data: Record<string, number> }[]> = {};

    // Accumulate per label
    const accum: Record<string, { bucket: number; entries: Record<string, number[]> }> = {};

    for (const row of rows) {
      const label = row.label;
      const t = new Date(row.ts).getTime();
      const b = Math.floor(t / bucketMs) * bucketMs;
      const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

      if (!accum[label]) accum[label] = { bucket: 0, entries: {} };

      if (b !== accum[label].bucket && accum[label].bucket !== 0) {
        // Emit bucket
        if (!byLabel[label]) byLabel[label] = [];
        const avg: Record<string, number> = {};
        for (const [k, vals] of Object.entries(accum[label].entries)) {
          avg[k] = vals.reduce((a, c) => a + c, 0) / vals.length;
        }
        byLabel[label].push({ ts: new Date(accum[label].bucket).toISOString(), data: avg });
        accum[label].entries = {};
      }
      accum[label].bucket = b;

      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'number') {
          if (!accum[label].entries[k]) accum[label].entries[k] = [];
          accum[label].entries[k].push(v);
        }
      }
    }

    // Emit final buckets
    for (const [label, acc] of Object.entries(accum)) {
      if (acc.bucket !== 0 && Object.keys(acc.entries).length > 0) {
        if (!byLabel[label]) byLabel[label] = [];
        const avg: Record<string, number> = {};
        for (const [k, vals] of Object.entries(acc.entries)) {
          avg[k] = vals.reduce((a, c) => a + c, 0) / vals.length;
        }
        byLabel[label].push({ ts: new Date(acc.bucket).toISOString(), data: avg });
      }
    }

    return NextResponse.json({
      kind,
      range,
      series: byLabel,
      labels: Object.keys(byLabel),
    });
  } catch (error) {
    console.error('Multi metrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
