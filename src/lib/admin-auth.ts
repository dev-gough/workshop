/**
 * Shared server-side gate for privileged endpoints (service control, RCON,
 * setup probes, settings writes).
 *
 * The site is publicly reachable, so any mutating endpoint must check the
 * `X-Setup-Token` header against `setupToken` in config.json — the same single
 * shared token that gates `/api/config` writes from the in-app /setup page.
 *
 * `requireSetupToken` returns a ready-to-return NextResponse on failure
 * (403 when no token is configured, 401 on mismatch) or `null` when the request
 * is authorized and the caller may proceed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

export function requireSetupToken(req: NextRequest): NextResponse | null {
  let setupToken: string | null;
  try {
    setupToken = getConfig().setupToken;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if (!setupToken) {
    return NextResponse.json(
      { error: 'config.json has no setupToken — cannot accept privileged requests. Edit config.json directly to set one.' },
      { status: 403 },
    );
  }
  if (req.headers.get('x-setup-token') !== setupToken) {
    return NextResponse.json({ error: 'invalid setup token' }, { status: 401 });
  }
  return null;
}
