/**
 * Client for the MineColonies dev server's world data service.
 *
 * Our fork of MineColonies runs a small read-only HTTP service inside the game
 * server (`com.minecolonies.devtools.web.DevWebServer`) that exposes the running
 * world — health now, and chunk geometry plus a live citizen event stream in
 * later phases of the village viewer.
 *
 * That service binds the IPv4 loopback address only, so it is unreachable from
 * anywhere but this box and needs no auth of its own. These routes are the only
 * way in, which is why they are all thin proxies rather than anything clever:
 * the browser cannot talk to the mod directly and never should be able to.
 *
 * Reads are deliberately ungated, matching the rest of the dashboard (GET is
 * open, mutations carry the setup token). Nothing here is secret — it is a
 * scratch Minecraft world — and requiring a token would mean the viewer page
 * prompting for one just to draw a village.
 *
 * The literal `127.0.0.1` is load-bearing: `localhost` can resolve to `::1`,
 * where nothing is listening.
 */
const BASE_URL = 'http://127.0.0.1:25601';

/** Wire-format version this client understands; see HealthHandler.API_VERSION. */
export const EXPECTED_API_VERSION = 1;

export interface VillageHealth {
  ok: boolean;
  api: number;
  minecraft: string;
  modVersion: string;
  tickCount: number;
  averageTickMs: number;
  playersOnline: number;
  levels: { dimension: string; forcedChunks: number }[];
  colonies: {
    id: number;
    name: string;
    dimension: string;
    center: { x: number; y: number; z: number };
    /** False means the colony is not ticking — the viewer would show a frozen world. */
    active: boolean;
    loadedChunks: number;
    citizens: number;
    buildings: number;
  }[];
}

export class VillageServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'VillageServiceError';
  }
}

/**
 * Fetch a path from the mod's service.
 *
 * Connection refused is by far the most likely failure — the dev server is not
 * enabled at boot and is stopped whenever the box needs the memory — so it is
 * translated into a 503 with an actionable message rather than surfacing as an
 * opaque `fetch failed`.
 */
export async function villageFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { cache: 'no-store', ...init });
  } catch (e) {
    throw new VillageServiceError(
      `MineColonies dev server is not reachable on ${BASE_URL} — is minecraft-mcdev running? (${(e as Error).message})`,
      503,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      detail = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      // Not JSON; use the raw body.
    }
    throw new VillageServiceError(detail || `mod service returned ${res.status}`, res.status);
  }

  return res;
}

export async function fetchHealth(): Promise<VillageHealth> {
  const res = await villageFetch('/health');
  return (await res.json()) as VillageHealth;
}
