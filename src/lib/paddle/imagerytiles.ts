/**
 * On-disk aerial imagery tiles for a park — Ontario's OIWMS orthophoto
 * mosaic (GEOspatial Ontario's "best available" province-wide imagery,
 * 20–40 cm aerial acquisitions around Temagami) cached as plain XYZ tiles
 * under `.cache/paddle/<slug>/imagery/{z}/{x}/{y}.jpg|png` by
 * `npm run import-imagery-tiles`. Open Government Licence – Ontario, which
 * is what makes self-hosting (and later offline bundling) legal.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Top zoom the importer fetches — ~3 m/px at Temagami's latitude. The
 *  source orthos are far sharper, so MapLibre overzooms cleanly past it;
 *  going deeper on disk quadruples tile count per level. */
export const IMAGERY_MAX_ZOOM = 15;

export const IMAGERY_ATTRIBUTION = 'Aerial imagery: Ontario GeoHub (OIWMS), OGL–Ontario';

export function imageryTileDir(slug: string): string {
  return path.join(process.cwd(), '.cache', 'paddle', slug, 'imagery');
}

/** Whether a park's imagery tiles have been imported. */
export function imageryOnDisk(slug: string): boolean {
  return existsSync(imageryTileDir(slug));
}

/** The service emits JPEG for full tiles and PNG where nodata needs alpha
 *  (its `image/jpgpng` format) — the importer keeps whichever arrived. */
export async function readImageryTile(
  slug: string,
  z: number,
  x: number,
  y: number,
): Promise<{ data: Buffer; type: string } | null> {
  const base = path.join(imageryTileDir(slug), String(z), String(x));
  try {
    return { data: await fs.readFile(path.join(base, `${y}.jpg`)), type: 'image/jpeg' };
  } catch {
    /* fall through to png */
  }
  try {
    return { data: await fs.readFile(path.join(base, `${y}.png`)), type: 'image/png' };
  } catch {
    return null;
  }
}
