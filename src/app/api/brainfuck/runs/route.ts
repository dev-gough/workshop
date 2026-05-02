import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { startRun, getActiveRunId } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

const MAX_TARGET_LENGTH = 64;
const MAX_GEN_CAP = 10_000_000;
const MAX_POP_CAP = 500;

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, target, status, pop_size, max_generations, generations,
              best_fitness, best_gene, best_output, started_at, completed_at, error
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
    const maxGen = Number.isFinite(body.max_generations) ? Number(body.max_generations) : 1_000_000;
    const popSize = Number.isFinite(body.pop_size) ? Number(body.pop_size) : 100;

    if (!target || target.length > MAX_TARGET_LENGTH) {
      return NextResponse.json(
        { error: `target must be 1..${MAX_TARGET_LENGTH} chars` },
        { status: 400 },
      );
    }
    if (maxGen < 100 || maxGen > MAX_GEN_CAP) {
      return NextResponse.json(
        { error: `max_generations must be in [100, ${MAX_GEN_CAP}]` },
        { status: 400 },
      );
    }
    if (popSize < 10 || popSize > MAX_POP_CAP) {
      return NextResponse.json(
        { error: `pop_size must be in [10, ${MAX_POP_CAP}]` },
        { status: 400 },
      );
    }

    const { id } = await startRun(target, maxGen, popSize);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: 'Start failed', detail: String(error) },
      { status: 500 },
    );
  }
}
