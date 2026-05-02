import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const { rows } = await pool.query(
      `SELECT id, target, status, generations, best_fitness, started_at, completed_at
       FROM brainfuck_runs
       WHERE status IN ('found', 'done', 'stopped', 'failed', 'interrupted')
         AND completed_at IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT $1`,
      [limit],
    );
    return NextResponse.json({ activity: rows });
  } catch (error) {
    return NextResponse.json(
      { activity: [], error: 'Failed', detail: String(error) },
      { status: 500 },
    );
  }
}
