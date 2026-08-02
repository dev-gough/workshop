import { getConfig } from '@/lib/config';

// Thin Jellyfin client used to resolve ingested media paths to real library
// items so the fetcher UI can deep-link to /web/#/details instead of a search.
// Everything degrades to null when Jellyfin is unreachable or no API key is
// configured — callers must treat resolution as best-effort.

interface JellyfinItem {
  Id: string;
  Path?: string;
  Type: string;
}

function jellyfinConfig() {
  return getConfig().services.jellyfin;
}

// ── Server id (public, no auth) ──

let serverIdCache: { id: string | null; at: number } = { id: null, at: 0 };

export async function getServerId(): Promise<string | null> {
  const cfg = jellyfinConfig();
  if (!cfg) return null;
  if (serverIdCache.id && Date.now() - serverIdCache.at < 10 * 60_000) return serverIdCache.id;
  try {
    const res = await fetch(`${cfg.baseUrl}/System/Info/Public`, {
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return serverIdCache.id;
    const info = await res.json();
    serverIdCache = { id: typeof info.Id === 'string' ? info.Id : null, at: Date.now() };
    return serverIdCache.id;
  } catch {
    return serverIdCache.id;
  }
}

// ── Library path index (needs an API key) ──

// One bulk query of Movies/Series/Seasons with paths, cached briefly. A home
// library is small enough (hundreds of items) that this beats per-row lookups
// against the 6s history polling.
let pathIndexCache: { items: JellyfinItem[]; at: number } | null = null;

async function getPathIndex(): Promise<JellyfinItem[] | null> {
  const cfg = jellyfinConfig();
  if (!cfg?.apiKey) return null;
  if (pathIndexCache && Date.now() - pathIndexCache.at < 60_000) return pathIndexCache.items;
  try {
    const url =
      `${cfg.baseUrl}/Items?recursive=true&includeItemTypes=Movie,Series,Season` +
      `&fields=Path&enableImages=false&limit=5000`;
    const res = await fetch(url, {
      headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"` },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return pathIndexCache?.items ?? null;
    const data = await res.json();
    const items: JellyfinItem[] = (data.Items ?? []).filter(
      (i: JellyfinItem) => typeof i.Path === 'string' && i.Path.length > 0,
    );
    pathIndexCache = { items, at: Date.now() };
    return items;
  } catch {
    return pathIndexCache?.items ?? null;
  }
}

// Match an ingest final_path to the most specific library item:
//   exact path (Season / Movie folder) → item under the folder (Movie file
//   inside its folder) → ancestor (Series when final_path is a season dir).
function matchItem(items: JellyfinItem[], finalPath: string): JellyfinItem | null {
  const target = finalPath.replace(/\/+$/, '');
  let under: JellyfinItem | null = null;
  let ancestor: JellyfinItem | null = null;
  for (const item of items) {
    const p = (item.Path as string).replace(/\/+$/, '');
    if (p === target) return item;
    if (p.startsWith(target + '/')) {
      if (!under || p.length < (under.Path as string).length) under = item;
    } else if (target.startsWith(p + '/')) {
      if (!ancestor || p.length > (ancestor.Path as string).length) ancestor = item;
    }
  }
  return under ?? ancestor;
}

export interface ResolvedItem {
  itemId: string;
  serverId: string | null;
}

// Resolve many paths at once; returns a map keyed by the input path. Paths
// that can't be resolved are simply absent.
export async function resolveItemsByPath(paths: string[]): Promise<Map<string, ResolvedItem>> {
  const out = new Map<string, ResolvedItem>();
  if (paths.length === 0) return out;
  const items = await getPathIndex();
  if (!items) return out;
  const serverId = await getServerId();
  for (const path of paths) {
    const item = matchItem(items, path);
    if (item) out.set(path, { itemId: item.Id, serverId });
  }
  return out;
}
