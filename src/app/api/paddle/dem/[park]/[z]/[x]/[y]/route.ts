import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { PARKS } from '@/lib/paddle/parks';
import { DEM_MAX_ZOOM, readDemTile } from '@/lib/paddle/demtiles';

// Serves the cached terrarium DEM tiles that give the table its relief.
// Like the chart route, misses inside the valid range answer 200 — but a
// DEM miss must encode "sea level", not transparency: terrarium decodes
// (0,0,0) as −32768 m, which would tear a pit into the terrain mesh.

export const dynamic = 'force-dynamic';

let flatTile: Promise<Buffer> | null = null;
function flatPng(): Promise<Buffer> {
  // terrarium 0 m = rgb(128, 0, 0)
  flatTile ??= sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 128, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return flatTile;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ park: string; z: string; x: string; y: string }> },
) {
  const { park, z, x, y } = await params;
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (
    !PARKS[park] ||
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > DEM_MAX_ZOOM ||
    xi < 0 ||
    yi < 0 ||
    xi >= 2 ** zi ||
    yi >= 2 ** zi
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const tile = (await readDemTile(park, zi, xi, yi)) ?? (await flatPng());

  return new NextResponse(new Uint8Array(tile), {
    headers: {
      'Content-Type': 'image/png',
      // Elevation only changes if the tileset is re-imported.
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
