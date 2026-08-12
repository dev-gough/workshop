import { NextResponse } from 'next/server';
import { fetchChunk, VillageServiceError } from '@/lib/village';

export const dynamic = 'force-dynamic';

/**
 * GET /api/village/chunk?x=N&z=N — one chunk column of block data.
 *
 * The viewer fires ~81 of these in parallel and meshes each as it lands, so this
 * stays a pass-through with no added work. Chunk payloads are immutable for a
 * given world state and carry their own palette, so they would cache freely —
 * but the world is live and a chunk changes whenever a builder places a block,
 * and there is no version token to invalidate against yet. Caching that is
 * corrected only by a hard refresh is worse than refetching 830 KB over
 * loopback, so this stays uncached until the phase 3 event stream can say when
 * a chunk is actually stale.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const x = Number(params.get('x'));
  const z = Number(params.get('z'));
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    return NextResponse.json(
      { ok: false, error: 'x and z are required integer chunk coordinates' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await fetchChunk(x, z));
  } catch (e) {
    if (e instanceof VillageServiceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
