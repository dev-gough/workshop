import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { PARKS } from '@/lib/paddle/parks';
import { chartOnDisk } from '@/lib/paddle/jefftiles';
import { DEM_MAX_ZOOM, DEM_PAD_DEG, demOnDisk } from '@/lib/paddle/demtiles';
import { IMAGERY_ATTRIBUTION, imageryMaxZoom, imageryOnDisk } from '@/lib/paddle/imagerytiles';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT p.slug, p.name, p.bbox, p.built_at, p.stats,
              (SELECT count(*)::int FROM paddle_campsites c
                WHERE c.park = p.slug AND c.status <> 'closed') AS campsites
         FROM paddle_parks p
        ORDER BY p.name`,
    );
    const parks = rows.map((row) => {
      const chart = PARKS[row.slug]?.chart;
      const bbox = PARKS[row.slug]?.bbox;
      return {
        ...row,
        // Advertise the purchased chart only when its tiles are on disk.
        chart: chart && chartOnDisk(row.slug) ? chart : null,
        // Same rule for the OIWMS aerial imagery pyramid.
        imagery: imageryOnDisk(row.slug)
          ? { maxZoom: imageryMaxZoom(row.slug), attribution: IMAGERY_ATTRIBUTION }
          : null,
        // Same rule for terrain: only when the DEM cache has been imported.
        // Bounds are the padded import window — past them the mesh would
        // cliff down to the flat fallback tile.
        dem:
          bbox && demOnDisk(row.slug)
            ? {
                maxZoom: DEM_MAX_ZOOM,
                bounds: [
                  bbox[0] - DEM_PAD_DEG,
                  bbox[1] - DEM_PAD_DEG,
                  bbox[2] + DEM_PAD_DEG,
                  bbox[3] + DEM_PAD_DEG,
                ],
              }
            : null,
      };
    });
    return NextResponse.json({ parks });
  } catch (error) {
    console.error('paddle parks error:', error);
    return NextResponse.json({ error: 'Failed to load parks', detail: String(error) }, { status: 500 });
  }
}
