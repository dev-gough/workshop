import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getActiveRunId, getActiveRunIds } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = parseInt(id, 10);
    if (!Number.isFinite(runId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT id, target, status, pop_size, max_generations, generations,
              best_fitness, best_gene, best_output, started_at, completed_at, error,
              config_json
       FROM brainfuck_runs WHERE id = $1`,
      [runId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    // Bounded progress trail. A long run accumulates tens of thousands of
    // progress points; shipping the whole thing every poll is wasteful and
    // the sparkline can't resolve it anyway. Keep the newest ~250 rows at full
    // resolution (the part the user is actively watching) plus an evenly
    // spaced downsample of the older rows so the early shape is preserved.
    // Total is capped at ~500 points regardless of run length.
    const RECENT = 250;
    const OLDER = 250;
    const { rows: trail } = await pool.query(
      `WITH ranked AS (
         SELECT gen, best_fitness,
                row_number() OVER (ORDER BY gen DESC) AS rn_desc,
                row_number() OVER (ORDER BY gen ASC)  AS rn_asc,
                count(*)     OVER ()                  AS total
         FROM brainfuck_progress
         WHERE run_id = $1
       )
       SELECT gen, best_fitness FROM ranked
       WHERE rn_desc <= $2
          OR (rn_desc > $2
              AND (rn_asc - 1) % GREATEST(1, CEIL((total - $2)::numeric / $3)) = 0)
       ORDER BY gen ASC`,
      [runId, RECENT, OLDER],
    );
    return NextResponse.json({ run: rows[0], progress: trail, activeId: getActiveRunId() });
  } catch (error) {
    return NextResponse.json({ error: 'fetch failed', detail: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = parseInt(id, 10);
    if (!Number.isFinite(runId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    if (getActiveRunIds().includes(runId)) {
      return NextResponse.json(
        { error: 'cannot delete an active run; stop it first' },
        { status: 409 },
      );
    }
    await pool.query(`DELETE FROM brainfuck_runs WHERE id = $1`, [runId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'delete failed', detail: String(error) }, { status: 500 });
  }
}
