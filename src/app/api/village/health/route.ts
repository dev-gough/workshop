import { NextResponse } from 'next/server';
import { EXPECTED_API_VERSION, fetchHealth, VillageServiceError } from '@/lib/village';

export const dynamic = 'force-dynamic';

/**
 * GET /api/village/health — is the village viewer's data source alive and worth
 * pointing a browser at?
 *
 * Adds two things the mod cannot know on its own: whether its wire format still
 * matches what this workshop build expects (the two deploy on independent
 * schedules and will drift), and a plain-language summary of why the viewer
 * would come up empty. A colony that is not `active` is not ticking, so the
 * viewer would render a still photograph with no hint that anything is wrong.
 */
export async function GET() {
  try {
    const health = await fetchHealth();

    const warnings: string[] = [];
    if (health.api !== EXPECTED_API_VERSION) {
      warnings.push(
        `mod speaks API v${health.api}, this workshop build expects v${EXPECTED_API_VERSION} — redeploy whichever is older`,
      );
    }
    if (health.colonies.length === 0) {
      warnings.push('no colonies exist — create one with `./colony.py found <name> <x> <z>`');
    }
    for (const colony of health.colonies) {
      if (!colony.active) {
        warnings.push(
          `colony ${colony.id} (${colony.name}) is not ticking — run \`./colony.py forceload\`, or wait 10s for the keep-alive`,
        );
      }
    }

    return NextResponse.json({ ...health, warnings });
  } catch (e) {
    if (e instanceof VillageServiceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
