import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { PARKS } from '@/lib/paddle/parks';
import { readChartTile } from '@/lib/paddle/jefftiles';

// Serves the purchased Maps by Jeff chart as ordinary XYZ raster tiles,
// read on demand from the Esri bundles in .cache — no 100k-file extraction,
// no external tile server. Personal-use copy; tiles never leave this box.

export const dynamic = 'force-dynamic';

// The park's footprint is irregular and far smaller than its bounding box,
// so the map legitimately asks for thousands of tiles the package doesn't
// carry. Those get a shared transparent pixel with a 200 — a 404 per empty
// tile floods the devtools console for what is a completely normal miss.
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
  const def = PARKS[park];
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (
    !def?.chart ||
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < 0 ||
    zi > def.chart.maxZoom ||
    xi < 0 ||
    yi < 0 ||
    xi >= 2 ** zi ||
    yi >= 2 ** zi
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const tile = (await readChartTile(park, zi, xi, yi)) ?? (await transparentPng());

  return new NextResponse(new Uint8Array(tile), {
    headers: {
      'Content-Type': 'image/png',
      // The chart only changes when a new map edition is imported — let the
      // browser keep tiles for a week.
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
