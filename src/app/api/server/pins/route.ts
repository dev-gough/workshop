import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await pool.query<{ label: string; comm: string; cmdline_hint: string | null; added_at: Date }>(
    `SELECT label, comm, cmdline_hint, added_at FROM metric_pin_config ORDER BY added_at`,
  );
  return NextResponse.json({ pins: rows });
}

export async function POST(req: NextRequest) {
  try {
    const { label, comm, cmdlineHint } = await req.json();
    if (!label || !comm) {
      return NextResponse.json({ error: 'label and comm are required' }, { status: 400 });
    }
    await pool.query(
      `INSERT INTO metric_pin_config (label, comm, cmdline_hint)
       VALUES ($1, $2, $3)
       ON CONFLICT (label) DO UPDATE SET comm = EXCLUDED.comm, cmdline_hint = EXCLUDED.cmdline_hint`,
      [label, comm, cmdlineHint ?? null],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { label } = await req.json();
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
    await pool.query(`DELETE FROM metric_pin_config WHERE label = $1`, [label]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
