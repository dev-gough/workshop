import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Solutions list. Optionally filter by ?target=... to drill into one input.
// No pagination yet — the table is bounded by (target, gene) uniqueness and
// each target only collects a handful of distinct shapes in practice.
export async function GET(request: NextRequest) {
  try {
    const target = request.nextUrl.searchParams.get('target');

    if (target) {
      const { rows } = await pool.query(
        `SELECT id, target, gene, output,
                gene_length, loop_count, max_loop_depth, unique_instructions,
                ops_executed, halted, output_length, cells_used, output_exact_match,
                run_id, generations_to_solve, config_json, bf_version_hash,
                first_seen_at, last_seen_at, times_found
         FROM brainfuck_solutions
         WHERE target = $1
         ORDER BY gene_length ASC, ops_executed ASC`,
        [target],
      );
      return NextResponse.json({ solutions: rows });
    }

    // Index view: one row per target with rollup counts. Lets the UI show a
    // list of "things we've solved" without dumping every gene.
    const { rows } = await pool.query(
      `SELECT target,
              COUNT(*)                       AS solution_count,
              MIN(gene_length)               AS shortest_gene,
              MIN(ops_executed)              AS fastest_ops,
              SUM(CASE WHEN halted THEN 1 ELSE 0 END) AS halting_count,
              SUM(CASE WHEN output_exact_match THEN 1 ELSE 0 END) AS exact_match_count,
              SUM(CASE WHEN halted AND output_exact_match THEN 1 ELSE 0 END) AS gold_count,
              MAX(last_seen_at)              AS last_seen_at,
              SUM(times_found)               AS total_discoveries
         FROM brainfuck_solutions
         GROUP BY target
         ORDER BY MAX(last_seen_at) DESC`,
    );
    return NextResponse.json({ targets: rows });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load solutions', detail: String(error) },
      { status: 500 },
    );
  }
}
