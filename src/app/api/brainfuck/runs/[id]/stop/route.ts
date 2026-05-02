import { NextRequest, NextResponse } from 'next/server';
import { stopRun } from '@/lib/brainfuck';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = parseInt(id, 10);
    if (!Number.isFinite(runId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const ok = stopRun(runId);
    if (!ok) {
      return NextResponse.json({ error: 'not the active run' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'stop failed', detail: String(error) }, { status: 500 });
  }
}
