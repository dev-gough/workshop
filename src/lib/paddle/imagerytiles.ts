/**
 * On-disk aerial imagery tiles for a park — Ontario's OIWMS orthophoto
 * mosaic (GEOspatial Ontario's "best available" province-wide imagery,
 * 20–40 cm aerial acquisitions around Temagami) cached as plain XYZ tiles
 * under `<paths.paddleCache>/<slug>/imagery/{z}/{x}/{y}.jpg|png` by
 * `npm run import-imagery-tiles`. Open Government Licence – Ontario, which
 * is what makes self-hosting (and later offline bundling) legal.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { paddleCachePath } from '../config';

/** Top zoom the importer fetches bbox-wide — ~3 m/px at Temagami's
 *  latitude. Going deeper everywhere quadruples tile count per level. */
export const IMAGERY_MAX_ZOOM = 15;

/** Top zoom of the route-corridor import (`--corridor`): deep levels only
 *  within a buffer of the network, where the crew actually paddles. z19 is
 *  OIWMS's hard ceiling (native ~20 cm; z20+ 400s everywhere) and is only
 *  ~65% present over Temagami — its NW interior tops out at native z18
 *  (~40 cm FRI). Missing/off-corridor tiles synthesize from the nearest
 *  on-disk ancestor at serve time, so partial z19 degrades gracefully. */
export const CORRIDOR_MAX_ZOOM = 19;

export const IMAGERY_ATTRIBUTION = 'Aerial imagery: Ontario GeoHub (OIWMS), OGL–Ontario';

export function imageryTileDir(slug: string): string {
  return path.join(paddleCachePath(), slug, 'imagery');
}

/** Whether a park's imagery tiles have been imported. */
export function imageryOnDisk(slug: string): boolean {
  return existsSync(imageryTileDir(slug));
}

/** Deepest zoom present on disk — CORRIDOR_MAX_ZOOM once a corridor import
 *  has run, else the bbox-wide pyramid top. What the parks API advertises. */
export function imageryMaxZoom(slug: string): number {
  for (let z = CORRIDOR_MAX_ZOOM; z > IMAGERY_MAX_ZOOM; z--) {
    if (existsSync(path.join(imageryTileDir(slug), String(z)))) return z;
  }
  return IMAGERY_MAX_ZOOM;
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

/**
 * Exact tile, or — above the bbox-wide pyramid — the nearest on-disk
 * ancestor's quadrant cropped and upscaled to 256 px. Keeps the map
 * seamless at z16–17: corridor tiles come back native, everywhere else
 * matches what MapLibre's own overzoom of z15 would have shown.
 */
export async function readImageryTileDeep(
  slug: string,
  z: number,
  x: number,
  y: number,
): Promise<{ data: Buffer; type: string } | null> {
  const exact = await readImageryTile(slug, z, x, y);
  if (exact || z <= IMAGERY_MAX_ZOOM) return exact;
  for (let az = z - 1; az >= IMAGERY_MAX_ZOOM; az--) {
    const dz = z - az;
    const ancestor = await readImageryTile(slug, az, x >> dz, y >> dz);
    if (!ancestor) continue;
    const size = 256 >> dz; // dz ≤ 2, so ≥ 64 px — plenty to scale up
    const png = ancestor.type === 'image/png'; // keep alpha at Ontario-boundary voids
    const img = sharp(ancestor.data)
      .extract({
        left: (x % (1 << dz)) * size,
        top: (y % (1 << dz)) * size,
        width: size,
        height: size,
      })
      .resize(256, 256);
    const data = await (png ? img.png() : img.jpeg({ quality: 80 })).toBuffer();
    return { data, type: ancestor.type };
  }
  return null;
}
