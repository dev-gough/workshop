import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { startRun, getActiveRunId, parseRunConfig } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

const MAX_TARGET_LENGTH = 64;

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, target, status, pop_size, max_generations, generations,
              best_fitness, best_gene, best_output, started_at, completed_at, error,
              config_json
       FROM brainfuck_runs
       ORDER BY started_at DESC
       LIMIT 50`,
    );
    return NextResponse.json({ runs: rows, activeId: getActiveRunId() });
  } catch (error) {
    return NextResponse.json(
      { runs: [], error: 'Failed to load runs', detail: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const target = typeof body.target === 'string' ? body.target : '';

    if (!target || target.length > MAX_TARGET_LENGTH) {
      return NextResponse.json(
        { error: `target must be 1..${MAX_TARGET_LENGTH} chars` },
        { status: 400 },
      );
    }

    let config;
    try {
      config = parseRunConfig(body);
    } catch (e) {
      return NextResponse.json({ error: String((e as Error).message) }, { status: 400 });
    }

    const { id } = await startRun(target, config);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: 'Start failed', detail: String(error) },
      { status: 500 },
    );
  }
}
