import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { PARKS } from '@/lib/paddle/parks';
import { IMAGERY_MAX_ZOOM, imageryOnDisk, readImageryTile } from '@/lib/paddle/imagerytiles';

// Serves the cached OIWMS aerial orthophotos as ordinary XYZ raster tiles,
// straight from the .cache pyramid `npm run import-imagery-tiles` built —
// the browser never talks to the province's server.

export const dynamic = 'force-dynamic';

// Same convention as the chart route: in-bounds misses (import still
// running, or a gap) get a shared transparent pixel with a 200 rather than
// flooding the devtools console with 404s.
let emptyTile: Promise<Buffer> | null = null;
function transparentPng(): Promise<Buffer> {
  emptyTile ??= sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return emptyTile;
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
    !imageryOnDisk(park) ||
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > IMAGERY_MAX_ZOOM ||
    xi < 0 ||
    yi < 0 ||
    xi >= 2 ** zi ||
    yi >= 2 ** zi
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const tile = await readImageryTile(park, zi, xi, yi);
  const body = tile?.data ?? (await transparentPng());

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': tile?.type ?? 'image/png',
      // The pyramid only changes on a re-import — let the browser keep
      // tiles for a week, same as the chart.
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
