/**
 * Reader for Esri Compact Cache V2 tile bundles — the format inside a
 * Maps by Jeff `.tpkx` download. The package is plain web-Mercator XYZ
 * (256px PNG, standard origin, esri level = z / row = y / col = x), so each
 * tile is three small reads away: a bundle holds a 128×128 block of tiles as
 * a 64-byte header, then 16384 little-endian uint64 index entries
 * (low 40 bits = data offset, high 24 bits = byte size, 0 = no tile),
 * then raw PNGs. Whole bundles are NOT loaded into memory — the L15 ones
 * run to 750 MB.
 */
import { open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BUNDLE_DIM = 128;
const INDEX_START = 64;

export function chartTileDir(slug: string): string {
  return path.join(process.cwd(), '.cache', 'paddle', slug, 'jeff', 'tile');
}

/** Whether a park's purchased chart tiles are actually on disk. */
export function chartOnDisk(slug: string): boolean {
  return existsSync(chartTileDir(slug));
}

export async function readChartTile(
  slug: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const startRow = Math.floor(y / BUNDLE_DIM) * BUNDLE_DIM;
  const startCol = Math.floor(x / BUNDLE_DIM) * BUNDLE_DIM;
  const hex4 = (n: number) => n.toString(16).padStart(4, '0');
  const bundlePath = path.join(
    chartTileDir(slug),
    `L${String(z).padStart(2, '0')}`,
    `R${hex4(startRow)}C${hex4(startCol)}.bundle`,
  );

  let fh;
  try {
    fh = await open(bundlePath, 'r');
  } catch {
    return null; // no bundle → no coverage here
  }
  try {
    const entry = Buffer.alloc(8);
    const idx = (y - startRow) * BUNDLE_DIM + (x - startCol);
    await fh.read(entry, 0, 8, INDEX_START + idx * 8);
    const packed = entry.readBigUInt64LE(0);
    const offset = Number(packed & 0xffffffffffn);
    const size = Number(packed >> 40n);
    if (size === 0) return null;
    const data = Buffer.alloc(size);
    await fh.read(data, 0, size, offset);
    return data;
  } finally {
    await fh.close();
  }
}
