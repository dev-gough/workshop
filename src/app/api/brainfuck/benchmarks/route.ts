import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { startBenchmarkBatch, getActiveBenchmarkId, parseRunConfig, BENCHMARK_PRESET, SOLVE_PRESET } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

const MAX_LABEL_LENGTH = 64;

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, version_hash, version_subject, version_label, batch_id, suite, lanes,
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
      solvePreset: SOLVE_PRESET,
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
    const suite = body.suite === 'solve' ? 'solve' : 'throughput';

    // Optional GA config override (hyperparam-sweep cells). Validated by
    // the same parser as run configs; invalid knobs 400 here rather than
    // silently benchmarking defaults.
    let config = null;
    if (body.config != null) {
      if (typeof body.config !== 'object' || Array.isArray(body.config)) {
        return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
      }
      try {
        config = parseRunConfig(body.config as Record<string, unknown>);
      } catch (e) {
        return NextResponse.json({ error: String((e as Error).message) }, { status: 400 });
      }
    }

    const { batchId, rowIds } = await startBenchmarkBatch(label, suite, config);
    return NextResponse.json({ batchId, rowIds });
  } catch (error) {
    return NextResponse.json(
      { error: 'Start failed', detail: String(error) },
      { status: 500 },
    );
  }
}
