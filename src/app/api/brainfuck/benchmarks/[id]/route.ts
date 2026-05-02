import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { stopBenchmark, getActiveBenchmarkId } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const benchId = parseInt(id, 10);
    if (!Number.isFinite(benchId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT id, version_hash, version_subject, version_label,
              target, pop_size, max_generations,
              generations, evaluations, wall_seconds,
              evals_per_sec, gens_per_sec,
              best_fitness, found, status, error,
              started_at, completed_at
       FROM brainfuck_benchmarks WHERE id = $1`,
      [benchId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ benchmark: rows[0], activeId: getActiveBenchmarkId() });
  } catch (error) {
    return NextResponse.json({ error: 'fetch failed', detail: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const benchId = parseInt(id, 10);
    if (!Number.isFinite(benchId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    if (getActiveBenchmarkId() === benchId) {
      return NextResponse.json(
        { error: 'cannot delete an active benchmark; stop it first' },
        { status: 409 },
      );
    }
    await pool.query(`DELETE FROM brainfuck_benchmarks WHERE id = $1`, [benchId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'delete failed', detail: String(error) }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // POST /api/brainfuck/benchmarks/[id] is a stop signal.
  try {
    const { id } = await ctx.params;
    const benchId = parseInt(id, 10);
    if (!Number.isFinite(benchId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const ok = stopBenchmark(benchId);
    if (!ok) {
      return NextResponse.json({ error: 'not the active benchmark' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'stop failed', detail: String(error) }, { status: 500 });
  }
}
