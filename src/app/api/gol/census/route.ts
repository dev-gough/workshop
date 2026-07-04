// Shared persistence for the Game of Life census heatmap.
//
// One row per board size. Writes are MONOTONIC: an upsert only lands if it
// carries strictly more progress (higher contiguous `processed` cursor, or
// done over not-done), so concurrent browsers can all checkpoint freely and
// the furthest-along run always wins. The response returns the row that
// actually won, letting a behind client fast-forward.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { MAX_AXIS, STILL_EXAMPLE_CAP, type OscExample } from '@/workers/gol-census-core';
import type { CensusResult } from '@/workers/gol-census-shared';

export const dynamic = 'force-dynamic';

const PERIOD_CAP = 4096;   // distinct periods per board — far above anything real

function parseAxis(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_AXIS ? (n as number) : null;
}

/** Rebuild a CensusResult from untrusted JSON — reject rather than trust. */
function sanitize(body: unknown): CensusResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const w = parseAxis(b.w);
  const h = parseAxis(b.h);
  if (w === null || h === null) return null;
  const total = Math.pow(2, w * h);

  const count = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= total ? v : null;

  const processed = count(b.processed);
  const dies = count(b.dies);
  const stillLifes = count(b.stillLifes);
  const unresolved = count(b.unresolved);
  const elapsedMs = typeof b.elapsedMs === 'number' && Number.isFinite(b.elapsedMs) && b.elapsedMs >= 0
    ? b.elapsedMs : null;
  const done = typeof b.done === 'boolean' ? b.done : null;
  if (processed === null || dies === null || stillLifes === null || unresolved === null
    || elapsedMs === null || done === null) return null;
  if (done && processed !== total) return null;

  if (typeof b.periods !== 'object' || b.periods === null || Array.isArray(b.periods)) return null;
  const periods: Record<number, number> = {};
  const entries = Object.entries(b.periods as Record<string, unknown>);
  if (entries.length > PERIOD_CAP) return null;
  for (const [k, v] of entries) {
    const p = Number(k);
    const c = count(v);
    if (!Number.isInteger(p) || p < 2 || c === null) return null;
    periods[p] = c;
  }

  const state = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v < total ? v : null;

  if (!Array.isArray(b.oscExamples) || b.oscExamples.length > PERIOD_CAP) return null;
  const oscExamples: OscExample[] = [];
  for (const raw of b.oscExamples) {
    const e = raw as Record<string, unknown>;
    const s = state(e?.state);
    const period = typeof e?.period === 'number' && Number.isInteger(e.period) && e.period >= 2 ? e.period : null;
    const population = typeof e?.population === 'number' && Number.isInteger(e.population)
      && e.population >= 0 && e.population <= w * h ? e.population : null;
    if (s === null || period === null || population === null) return null;
    oscExamples.push({ period, state: s, population });
  }

  if (!Array.isArray(b.stillLifeExamples) || b.stillLifeExamples.length > STILL_EXAMPLE_CAP) return null;
  const stillLifeExamples: number[] = [];
  for (const raw of b.stillLifeExamples) {
    const s = state(raw);
    if (s === null) return null;
    stillLifeExamples.push(s);
  }

  const result: CensusResult = {
    w, h, total, processed, dies, stillLifes, unresolved,
    periods, oscExamples, stillLifeExamples, done, elapsedMs,
  };
  if (b.via === 'transpose') result.via = 'transpose';
  return result;
}

export async function GET() {
  try {
    const { rows } = await pool.query<{ result: CensusResult }>(
      'SELECT result FROM gol_census ORDER BY h, w',
    );
    return NextResponse.json({ results: rows.map(r => r.result) });
  } catch (error) {
    return NextResponse.json({ error: 'fetch failed', detail: String(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const r = sanitize(body);
    if (!r) {
      return NextResponse.json({ error: 'invalid census result' }, { status: 400 });
    }
    const { rows } = await pool.query<{ result: CensusResult }>(
      `INSERT INTO gol_census (w, h, processed, done, result, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (w, h) DO UPDATE
         SET processed = EXCLUDED.processed,
             done = EXCLUDED.done,
             result = EXCLUDED.result,
             updated_at = now()
         WHERE EXCLUDED.processed > gol_census.processed
            OR (EXCLUDED.done AND NOT gol_census.done)
       RETURNING result`,
      [r.w, r.h, r.processed, r.done, JSON.stringify(r)],
    );
    if (rows.length > 0) {
      return NextResponse.json({ stored: true, result: rows[0].result });
    }
    // Guard refused the write — hand back the further-along row.
    const existing = await pool.query<{ result: CensusResult }>(
      'SELECT result FROM gol_census WHERE w = $1 AND h = $2', [r.w, r.h],
    );
    return NextResponse.json({ stored: false, result: existing.rows[0]?.result ?? null });
  } catch (error) {
    return NextResponse.json({ error: 'save failed', detail: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const w = parseAxis(params.get('w'));
    const h = parseAxis(params.get('h'));
    if (w === null || h === null) {
      return NextResponse.json({ error: 'invalid size' }, { status: 400 });
    }
    await pool.query('DELETE FROM gol_census WHERE w = $1 AND h = $2', [w, h]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'delete failed', detail: String(error) }, { status: 500 });
  }
}
