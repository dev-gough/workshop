import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/server/metrics?kind=system&label=cpu&range=1h&resolution=60
 *
 * kind: system | process | network | disk
 * label: cpu, memory, temperature, workshop, enp4s0, sdb, etc.
 * range: 1h, 6h, 24h, 7d
 * resolution: target number of points (data is bucketed by time_bucket)
 */

const RANGE_MAP: Record<string, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '7d': '7 days',
};

const BUCKET_MAP: Record<string, string> = {
  '1h': '1 minute',
  '6h': '5 minutes',
  '24h': '15 minutes',
  '7d': '1 hour',
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind') || 'system';
    const label = searchParams.get('label') || 'cpu';
    const range = searchParams.get('range') || '1h';

    if (!RANGE_MAP[range]) {
      return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
    }

    // Validate kind/label to prevent injection
    if (!/^[a-z]+$/.test(kind) || !/^[a-z0-9@_-]+$/.test(label)) {
      return NextResponse.json({ error: 'Invalid kind or label' }, { status: 400 });
    }

    const interval = RANGE_MAP[range];
    const bucket = BUCKET_MAP[range];

    // Use time bucketing for larger ranges to reduce data points
    const { rows } = await pool.query(
      `SELECT
         date_trunc('minute', ts) AS bucket_ts,
         data,
         ts
       FROM system_metrics
       WHERE kind = $1 AND label = $2 AND ts > now() - interval '${interval}'
       ORDER BY ts ASC`,
      [kind, label]
    );

    // Client-side bucketing for simplicity — group by time bucket
    const bucketMs = parseBucketMs(bucket);
    const bucketed: { ts: string; data: Record<string, number> }[] = [];
    let currentBucket = 0;
    let currentData: Record<string, number[]> = {};

    for (const row of rows) {
      const t = new Date(row.ts).getTime();
      const b = Math.floor(t / bucketMs) * bucketMs;

      if (b !== currentBucket && currentBucket !== 0) {
        // Emit averaged bucket
        const avg: Record<string, number> = {};
        for (const [k, vals] of Object.entries(currentData)) {
          avg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        bucketed.push({ ts: new Date(currentBucket).toISOString(), data: avg });
        currentData = {};
      }
      currentBucket = b;

      const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'number') {
          if (!currentData[k]) currentData[k] = [];
          currentData[k].push(v);
        }
      }
    }

    // Emit last bucket
    if (currentBucket !== 0 && Object.keys(currentData).length > 0) {
      const avg: Record<string, number> = {};
      for (const [k, vals] of Object.entries(currentData)) {
        avg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      bucketed.push({ ts: new Date(currentBucket).toISOString(), data: avg });
    }

    return NextResponse.json({
      kind,
      label,
      range,
      points: bucketed,
      count: bucketed.length,
    });
  } catch (error) {
    console.error('Metrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}

function parseBucketMs(bucket: string): number {
  const match = bucket.match(/^(\d+)\s+(minute|hour|second)s?$/);
  if (!match) return 60000;
  const n = parseInt(match[1]);
  switch (match[2]) {
    case 'second': return n * 1000;
    case 'minute': return n * 60000;
    case 'hour': return n * 3600000;
    default: return 60000;
  }
}
