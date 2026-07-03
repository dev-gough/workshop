/**
 * Config introspection + per-field updates from the in-app /setup page.
 *
 * GET   returns a non-secret view (URLs and shapes; never passwords/keys),
 *       merged with `getAllProjectStatuses()` so the UI can render readiness.
 * PATCH accepts a partial diff against an explicit allowlist, validates the
 *       resulting config, writes atomically, and resets the loader cache.
 *       Gated by the X-Setup-Token header matching `setupToken` in config.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConfig, writeConfigPatch, type Config } from '@/lib/config';
import { requireSetupToken } from '@/lib/admin-auth';
import { getAllProjectStatuses } from '@/lib/config-status';

export const dynamic = 'force-dynamic';

// Mask any value that looks secret. We *never* return raw passwords/keys.
function maskSecrets(c: Config) {
  const mask = (s: string | null | undefined) =>
    s ? `${'•'.repeat(Math.max(0, Math.min(s.length, 8)))}${s.length > 8 ? '…' : ''}` : null;

  return {
    postgres: {
      host: c.postgres.host,
      port: c.postgres.port,
      database: c.postgres.database,
      roles: {
        workshop:         { user: c.postgres.roles.workshop.user,         password: mask(c.postgres.roles.workshop.password) },
        soulseek_ingest:  { user: c.postgres.roles.soulseek_ingest.user,  password: mask(c.postgres.roles.soulseek_ingest.password) },
        challenge_poller: { user: c.postgres.roles.challenge_poller.user, password: mask(c.postgres.roles.challenge_poller.password) },
      },
    },
    paths: c.paths,
    services: {
      jellyfin: c.services.jellyfin && {
        baseUrl: c.services.jellyfin.baseUrl,
        apiKey: mask(c.services.jellyfin.apiKey),
      },
      transmission: c.services.transmission && {
        rpcUrl: c.services.transmission.rpcUrl,
        username: c.services.transmission.username,
        password: mask(c.services.transmission.password),
      },
      slskd: c.services.slskd && {
        baseUrl: c.services.slskd.baseUrl,
        apiKey: mask(c.services.slskd.apiKey),
        autoIngest: c.services.slskd.autoIngest,
      },
    },
    riot: c.riot && {
      apiKey: mask(c.riot.apiKey),
      gameName: c.riot.gameName,
      tagLine: c.riot.tagLine,
      region: c.riot.region,
    },
    minecraftServers: c.minecraftServers.map((s) => ({
      name: s.name, host: s.host, port: s.port, password: mask(s.password),
    })),
    setupTokenSet: c.setupToken != null,
  };
}

export async function GET() {
  try {
    const cfg = getConfig();
    return NextResponse.json({
      config: maskSecrets(cfg),
      projects: getAllProjectStatuses(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Top-level allowlist: which keys may a PATCH body include.
const PATCH_ALLOWED = new Set([
  'paths', 'services', 'riot', 'minecraftServers',
]);

export async function PATCH(req: NextRequest) {
  const denied = requireSetupToken(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  for (const k of Object.keys(body)) {
    if (!PATCH_ALLOWED.has(k)) {
      return NextResponse.json({ error: `key "${k}" is not allowed via PATCH` }, { status: 400 });
    }
  }

  // Read raw file (preserves any keys we don't model, like _doc/_comment),
  // shallow-merge top-level allowed keys, validate by re-loading.
  const result = await writeConfigPatch((raw) => {
    for (const k of Object.keys(body)) raw[k] = body[k];
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, written: result.written }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
