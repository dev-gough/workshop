// Start, stop, and inspect the laptop 3060 census. One board at a time.
// Progress is streamed from /api/gol/census/gpu/stream; this route is the control plane.

import { NextRequest, NextResponse } from 'next/server';
import { MAX_AXIS } from '@/workers/gol-census-core';
import { gpuJobView, startGpuCensus, stopGpuCensus } from '@/lib/gol-gpu';

export const dynamic = 'force-dynamic';

function axis(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_AXIS ? (n as number) : null;
}

export async function GET() {
  const job = gpuJobView();
  return NextResponse.json({ job });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { w?: unknown; h?: unknown; fresh?: unknown } | null;
  const w = axis(body?.w);
  const h = axis(body?.h);
  if (w === null || h === null) {
    return NextResponse.json({ error: 'invalid size' }, { status: 400 });
  }
  if (w * h >= 64) {
    return NextResponse.json({ error: 'board does not fit in a 64-bit state' }, { status: 400 });
  }
  try {
    await startGpuCensus(w, h, body?.fresh === true);
    return NextResponse.json({ ok: true, job: gpuJobView() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The 3060 census failed to start.';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { w?: unknown; h?: unknown; checkpoint?: unknown } | null;
  const w = axis(body?.w);
  const h = axis(body?.h);
  if (w === null || h === null) {
    return NextResponse.json({ error: 'invalid size' }, { status: 400 });
  }
  try {
    await stopGpuCensus(w, h, body?.checkpoint === true);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'stop failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
