import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { startBenchmarkBatch, getActiveBenchmarkId, BENCHMARK_PRESET } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

const MAX_LABEL_LENGTH = 64;

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, version_hash, version_subject, version_label, batch_id,
              target, pop_size, max_generations,
              generations, evaluations, wall_seconds,
              evals_per_sec, gens_per_sec,
              best_fitness, found, status, error,
              started_at, completed_at
       FROM brainfuck_benchmarks
       ORDER BY started_at DESC
       LIMIT 100`,
    );
    return NextResponse.json({
      benchmarks: rows,
      activeId: getActiveBenchmarkId(),
      preset: BENCHMARK_PRESET,
    });
  } catch (error) {
    return NextResponse.json(
      { benchmarks: [], error: 'Failed to load benchmarks', detail: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const label =
      typeof body.label === 'string' && body.label.trim().length > 0
        ? body.label.trim().slice(0, MAX_LABEL_LENGTH)
        : null;

    const { batchId, rowIds } = await startBenchmarkBatch(label);
    return NextResponse.json({ batchId, rowIds });
  } catch (error) {
    return NextResponse.json(
      { error: 'Start failed', detail: String(error) },
      { status: 500 },
    );
  }
}
