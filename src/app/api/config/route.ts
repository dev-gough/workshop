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
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig, resetConfigCache, type Config } from '@/lib/config';
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
  let cfg: Config;
  try {
    cfg = getConfig();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const token = req.headers.get('x-setup-token');
  if (!cfg.setupToken) {
    return NextResponse.json(
      { error: 'config.json has no setupToken — cannot accept writes from /setup. Edit config.json directly to set one.' },
      { status: 403 },
    );
  }
  if (token !== cfg.setupToken) {
    return NextResponse.json({ error: 'invalid setup token' }, { status: 401 });
  }

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
  const configPath = path.join(process.cwd(), 'config.json');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  for (const k of Object.keys(body)) raw[k] = body[k];

  // Atomic write
  const tmp = configPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, configPath);

  // Reset cache so the next getConfig() picks up the new values; also re-validate
  // by reading immediately. If validation fails, surface the error (the file is
  // already written, but the in-memory cache will be invalid).
  resetConfigCache();
  try {
    getConfig();
  } catch (e) {
    return NextResponse.json(
      { error: `validation failed after write: ${(e as Error).message}`, written: true },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true });
}
