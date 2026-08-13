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

/** One force-loaded chunk belonging to the rendered colony, with its own vertical slice. */
export interface VillageChunkRef {
  x: number;
  z: number;
  /** Inclusive. Each chunk is clipped to its own surface shell, so these differ per chunk. */
  minY: number;
  maxY: number;
}

export interface VillageManifest {
  ok: boolean;
  api: number;
  dimension: string;
  colony: { id: number; name: string; active: boolean; center: { x: number; y: number; z: number } };
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  chunks: VillageChunkRef[];
  chunkCount: number;
  /**
   * Force-loaded chunks claimed by some other colony, or none at all. Non-zero means something is
   * holding chunks resident that this colony does not own — a stale force-load from a deleted
   * colony is the case that actually happened here, and it cost a square kilometre of ticking ocean.
   */
  orphanChunks: number;
}

/** A palette entry: a block state, plus for Domum Ornamentum the vanilla blocks it is dressed in. */
export interface VillagePaletteEntry {
  block: string;
  properties?: Record<string, string>;
  materials?: Record<string, string>;
}

export interface VillageChunk {
  ok: boolean;
  api: number;
  x: number;
  z: number;
  minY: number;
  maxY: number;
  height: number;
  solidBlocks: number;
  /** Index 0 is always air. */
  palette: VillagePaletteEntry[];
  /** base64 little-endian uint16, indexed `((y - minY) * 16 + z) * 16 + x`. */
  data: string;
}

export async function fetchManifest(colony?: number): Promise<VillageManifest> {
  const query = colony === undefined ? '' : `?colony=${colony}`;
  const res = await villageFetch(`/world/manifest${query}`);
  return (await res.json()) as VillageManifest;
}

export async function fetchChunk(x: number, z: number): Promise<VillageChunk> {
  const res = await villageFetch(`/world/chunk?x=${x}&z=${z}`);
  return (await res.json()) as VillageChunk;
}

/**
 * The slow half of the event stream — who exists, and what they are for.
 *
 * Sent on connect and re-sent only when it changes, so the 10 Hz frames can be
 * pure numbers instead of retransmitting every citizen's name ten times a
 * second. Joined to frames on `id`.
 */
export interface VillageRoster {
  colony: number;
  name: string;
  active: boolean;
  citizens: {
    id: number;
    name: string;
    /**
     * Job class simple name, e.g. `JobBuilder`. Absent for an unemployed citizen — the mod's Gson
     * omits nulls rather than writing them, so these fields are missing, not null.
     */
    job?: string;
    /** False when the citizen's chunk is not loaded — nothing to draw. */
    loaded: boolean;
    home?: { x: number; y: number; z: number };
    work?: { x: number; y: number; z: number };
  }[];
}

/** One citizen in one frame. Loaded citizens only. */
export interface VillageCitizenFrame {
  id: number;
  /** Exact entity position, not block-snapped: the viewer interpolates between frames. */
  x: number;
  y: number;
  z: number;
  /** Body yaw in degrees, Minecraft convention: 0 is +Z (south), increasing clockwise. */
  yaw: number;
  /** Head yaw, which leads the body — citizens look at their work before turning to it. */
  headYaw: number;
  pitch: number;
  eye: number;
  saturation: number;
  asleep: boolean;
  idle: boolean;
  /** Pathfinding stuck level; rises as pathing keeps failing. Absent for a citizen with no navigator. */
  stuck?: number;
  /** Citizen "brain" state — the sleep/eat/work decision. */
  brain?: string;
  /** Job AI state — the work loop itself. */
  state?: string;
}

export interface VillageFrame {
  tick: number;
  gameTime: number;
  citizens: VillageCitizenFrame[];
}
