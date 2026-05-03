import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { startRun, getActiveRunId, getActiveRunIds, parseRunConfig } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

const MAX_TARGET_LENGTH = 64;

export async function GET() {
  try {
    // LEFT JOIN with brainfuck_solutions so the UI can flag "gold standard"
    // runs (halted + output_exact_match) without a second round-trip per row.
    // Solutions are written only on 'found', so non-found runs match nothing
    // and the flags come back NULL — handled fine on the client.
    const { rows } = await pool.query(
      `SELECT r.id, r.target, r.status, r.pop_size, r.max_generations, r.generations,
              r.best_fitness, r.best_gene, r.best_output, r.started_at, r.completed_at,
              r.error, r.config_json, r.race_id,
              s.halted, s.output_exact_match
       FROM brainfuck_runs r
       LEFT JOIN brainfuck_solutions s
         ON s.target = r.target AND s.gene = r.best_gene
       ORDER BY r.started_at DESC
       LIMIT 50`,
    );
    return NextResponse.json({
      runs: rows,
      activeId: getActiveRunId(),
      activeIds: getActiveRunIds(),
    });
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

    const { ids, raceId } = await startRun(target, config);
    // Back-compat: clients reading `id` get the first lane's id; multi-lane
    // clients use `ids` to track the whole race.
    return NextResponse.json({ id: ids[0], ids, raceId });
  } catch (error) {
    return NextResponse.json(
      { error: 'Start failed', detail: String(error) },
      { status: 500 },
    );
  }
}
