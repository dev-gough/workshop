import { NextResponse } from 'next/server';
import { EXPECTED_API_VERSION, fetchManifest, VillageServiceError } from '@/lib/village';

export const dynamic = 'force-dynamic';

/**
 * GET /api/village/world[?colony=N] — which chunks the viewer should fetch.
 *
 * A thin proxy plus the two warnings the mod cannot produce for itself: wire
 * format drift (the mod and this workshop deploy on independent schedules), and
 * orphaned force-loads. The second one is not hypothetical — this world had 81
 * chunks held resident by a colony deleted weeks earlier, which the manifest now
 * excludes from the render but reports here so it does not stay invisible.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('colony');
  const colony = raw === null ? undefined : Number(raw);
  if (colony !== undefined && !Number.isInteger(colony)) {
    return NextResponse.json({ ok: false, error: `colony must be an integer, got: ${raw}` }, { status: 400 });
  }

  try {
    const manifest = await fetchManifest(colony);

    const warnings: string[] = [];
    if (manifest.api !== EXPECTED_API_VERSION) {
      warnings.push(
        `mod speaks API v${manifest.api}, this workshop build expects v${EXPECTED_API_VERSION} — redeploy whichever is older`,
      );
    }
    if (!manifest.colony.active) {
      warnings.push(
        `colony ${manifest.colony.id} (${manifest.colony.name}) is not ticking — the view will be a still photograph`,
      );
    }
    if (manifest.orphanChunks > 0) {
      warnings.push(
        `${manifest.orphanChunks} force-loaded chunk(s) belong to no colony — likely a stale force-load ticking for nothing; ` +
          `check with \`/forceload query\` and release with \`/forceload remove\``,
      );
    }

    return NextResponse.json({ ...manifest, warnings });
  } catch (e) {
    if (e instanceof VillageServiceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
