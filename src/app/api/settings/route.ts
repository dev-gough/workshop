/**
 * User-facing settings surfaced on the /profile page.
 *
 * GET is open and returns a non-secret slice of the NESTED config
 * (riot.gameName/tagLine/region and services.slskd.autoIngest). PATCH is gated
 * by the shared setup token and writes those same values back into the nested
 * config via the shared `writeConfigPatch` writer.
 *
 * (The previous implementation read/wrote a legacy FLAT schema — `riotGameName`,
 * top-level `slskd` — that getConfig() never reads, so saves silently did
 * nothing.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConfig, writeConfigPatch } from '@/lib/config';
import { requireSetupToken } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// GET - return user-facing settings from the nested config
export async function GET() {
  try {
    const cfg = getConfig();
    return NextResponse.json({
      musicDirectory: cfg.paths.musicDirectory ?? '',
      slskd: {
        autoIngest: cfg.services.slskd?.autoIngest ?? false,
      },
      riotGameName: cfg.riot?.gameName ?? '',
      riotTagLine: cfg.riot?.tagLine ?? '',
      riotRegion: cfg.riot?.region ?? '',
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read settings', detail: String(error) }, { status: 500 });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// PATCH - update specific settings (token-gated)
export async function PATCH(request: NextRequest) {
  const denied = requireSetupToken(request);
  if (denied) return denied;

  let updates: Record<string, unknown>;
  try {
    updates = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const result = await writeConfigPatch((raw) => {
    if ('autoIngest' in updates) {
      if (!isObject(raw.services)) raw.services = {};
      const services = raw.services as Record<string, unknown>;
      if (!isObject(services.slskd)) services.slskd = {};
      (services.slskd as Record<string, unknown>).autoIngest = Boolean(updates.autoIngest);
    }
    const riotFields: Record<string, string> = {
      riotGameName: 'gameName',
      riotTagLine: 'tagLine',
      riotRegion: 'region',
    };
    for (const [inKey, outKey] of Object.entries(riotFields)) {
      if (typeof updates[inKey] === 'string') {
        if (!isObject(raw.riot)) raw.riot = {};
        (raw.riot as Record<string, unknown>)[outKey] = updates[inKey];
      }
    }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, written: result.written }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}
