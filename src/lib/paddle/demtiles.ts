/**
 * On-disk DEM tiles for a park — plain XYZ PNGs in the Mapzen "terrarium"
 * encoding (elevation = R·256 + G + B/256 − 32768), cached under
 * `<paths.paddleCache>/<slug>/dem/{z}/{x}/{y}.png` by `npm run import-dem-tiles`.
 * MapLibre consumes them as a raster-dem source for 3D terrain + hillshade.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { paddleCachePath } from '../config';

/** Top zoom the importer fetches — matches the ~30 m CDEM source resolution. */
export const DEM_MAX_ZOOM = 12;

/**
 * Degrees of DEM coverage beyond the park bbox. Where coverage ends, the
 * mesh falls to the flat fallback tile's 0 m and renders as a cliff wall —
 * the pad pushes that seam far enough off the table that no reasonable
 * pitch/zoom ever frames it. The client mirrors this in its source bounds.
 */
export const DEM_PAD_DEG = 0.4;

export function demTileDir(slug: string): string {
  return path.join(paddleCachePath(), slug, 'dem');
}

/** Whether a park's DEM tiles have been imported. */
export function demOnDisk(slug: string): boolean {
  return existsSync(demTileDir(slug));
}

export async function readDemTile(
  slug: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(demTileDir(slug), String(z), String(x), `${y}.png`));
  } catch {
    return null;
  }
}
