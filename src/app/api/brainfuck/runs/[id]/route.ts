import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getActiveRunId } from '@/lib/brainfuck';

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
              best_fitness, best_gene, best_output, started_at, completed_at, error
       FROM brainfuck_runs WHERE id = $1`,
      [runId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const { rows: trail } = await pool.query(
      `SELECT gen, best_fitness FROM brainfuck_progress
       WHERE run_id = $1 ORDER BY gen ASC`,
      [runId],
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
    if (getActiveRunId() === runId) {
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
