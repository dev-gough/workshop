import { NextResponse } from 'next/server';
import { PARKS } from '@/lib/paddle/parks';
import { readChartTile } from '@/lib/paddle/jefftiles';

// Serves the purchased Maps by Jeff chart as ordinary XYZ raster tiles,
// read on demand from the Esri bundles in .cache — no 100k-file extraction,
// no external tile server. Personal-use copy; tiles never leave this box.

export const dynamic = 'force-dynamic';

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

  const tile = await readChartTile(park, zi, xi, yi);
  if (!tile) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(tile), {
    headers: {
      'Content-Type': 'image/png',
      // The chart only changes when a new map edition is imported — let the
      // browser keep tiles for a week.
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
