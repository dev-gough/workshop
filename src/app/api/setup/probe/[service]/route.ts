/**
 * Per-service connectivity probes for the /setup page's "Test connection" buttons.
 * Each probe uses the *current* config, so the user must save before testing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { getConfig, pgClientConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

type Result = { ok: true; detail?: string } | { ok: false; error: string };

async function probePostgres(): Promise<Result> {
  const c = pgClientConfig('workshop');
  const client = new Client(c);
  try {
    await client.connect();
    const r = await client.query<{ version: string }>('SELECT version() AS version');
    return { ok: true, detail: r.rows[0].version.split(',')[0] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    await client.end().catch(() => {});
  }
}

async function probeBrainfuck(): Promise<Result> {
  const c = getConfig();
  if (!existsSync(c.paths.brainfuckRepo)) {
    return { ok: false, error: `repo path does not exist: ${c.paths.brainfuckRepo}` };
  }
  if (!existsSync(c.paths.pythonBin)) {
    return { ok: false, error: `python interpreter does not exist: ${c.paths.pythonBin}` };
  }
  try {
    const v = execFileSync(c.paths.pythonBin, ['--version'], { encoding: 'utf-8', timeout: 3000 }).trim();
    return { ok: true, detail: v };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function probeMusicDir(): Promise<Result> {
  const c = getConfig();
  if (!c.paths.musicDirectory) return { ok: false, error: 'paths.musicDirectory is unset' };
  if (!existsSync(c.paths.musicDirectory)) return { ok: false, error: `directory does not exist: ${c.paths.musicDirectory}` };
  return { ok: true, detail: c.paths.musicDirectory };
}

async function probeJellyfin(): Promise<Result> {
  const j = getConfig().services.jellyfin;
  if (!j) return { ok: false, error: 'jellyfin is not configured' };
  try {
    const r = await fetch(`${j.baseUrl}/System/Info/Public`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}` };
    const info = await r.json() as { ServerName?: string; Version?: string };
    return { ok: true, detail: `${info.ServerName ?? 'jellyfin'} ${info.Version ?? ''}`.trim() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function probeTransmission(): Promise<Result> {
  const t = getConfig().services.transmission;
  if (!t) return { ok: false, error: 'transmission is not configured' };
  try {
    const auth = 'Basic ' + Buffer.from(`${t.username}:${t.password}`).toString('base64');
    let r = await fetch(t.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ method: 'session-get' }),
      signal: AbortSignal.timeout(5000),
    });
    // CSRF dance
    if (r.status === 409) {
      const sid = r.headers.get('X-Transmission-Session-Id');
      if (sid) {
        r = await fetch(t.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth, 'X-Transmission-Session-Id': sid },
          body: JSON.stringify({ method: 'session-get' }),
          signal: AbortSignal.timeout(5000),
        });
      }
    }
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}` };
    const j = await r.json() as { arguments?: { version?: string } };
    return { ok: true, detail: `transmission ${j.arguments?.version ?? '?'}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function probeSlskd(): Promise<Result> {
  const s = getConfig().services.slskd;
  if (!s) return { ok: false, error: 'slskd is not configured' };
  try {
    const r = await fetch(`${s.baseUrl}/api/v0/server`, {
      headers: { 'X-API-Key': s.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}` };
    const j = await r.json() as { state?: string };
    return { ok: true, detail: `slskd ${j.state ?? 'connected'}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function probeRiot(): Promise<Result> {
  const r = getConfig().riot;
  if (!r) return { ok: false, error: 'riot is not configured' };
  try {
    const url = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(r.gameName)}/${encodeURIComponent(r.tagLine)}`;
    const res = await fetch(url, {
      headers: { 'X-Riot-Token': r.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    const j = await res.json() as { gameName?: string; tagLine?: string };
    return { ok: true, detail: `${j.gameName}#${j.tagLine}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const PROBES: Record<string, () => Promise<Result>> = {
  postgres:     probePostgres,
  brainfuck:    probeBrainfuck,
  music:        probeMusicDir,
  jellyfin:     probeJellyfin,
  transmission: probeTransmission,
  slskd:        probeSlskd,
  riot:         probeRiot,
};

export async function POST(_req: NextRequest, ctx: { params: Promise<{ service: string }> }) {
  const { service } = await ctx.params;
  const probe = PROBES[service];
  if (!probe) return NextResponse.json({ ok: false, error: `unknown service: ${service}` }, { status: 404 });
  const result = await probe();
  return NextResponse.json(result);
}
