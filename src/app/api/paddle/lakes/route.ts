import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Lakes as GeoJSON — the room's self-hosted basemap. Esri rings become
// polygons by winding: clockwise rings are shorelines, counter-clockwise are
// island holes, each hole nested under the outer whose bbox contains it.
// `minArea` (m²) trims the thousands of off-route beaver ponds at low zoom.

type Ring = [number, number][];

function shoelace(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return s; // > 0 for counter-clockwise with this vertex walk (verified on a unit square)
}

function ringsToPolygons(rings: Ring[]): Ring[][] {
  const outers: { ring: Ring; bbox: [number, number, number, number]; holes: Ring[] }[] = [];
  const holes: Ring[] = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    if (shoelace(ring) <= 0) {
      // esri outer rings wind clockwise → non-positive here
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      outers.push({
        ring,
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        holes: [],
      });
    } else {
      holes.push(ring);
    }
  }
  if (outers.length === 0) return rings.length ? [rings] : [];
  for (const hole of holes) {
    const [x, y] = hole[0];
    const host =
      outers.find((o) => x >= o.bbox[0] && x <= o.bbox[2] && y >= o.bbox[1] && y <= o.bbox[3]) ??
      outers[0];
    host.holes.push(hole);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const park = url.searchParams.get('park') ?? 'temagami';
  const minArea = Number(url.searchParams.get('minArea') ?? 0);
  try {
    const { rows } = await pool.query(
      `SELECT ogf_id, name, area_m2, on_network, rings
         FROM paddle_lakes
        WHERE park = $1 AND (area_m2 >= $2 OR on_network)
        ORDER BY area_m2 DESC`,
      [park, minArea],
    );
    const features = rows.flatMap((row) => {
      const polys = ringsToPolygons(row.rings as Ring[]);
      if (polys.length === 0) return [];
      return [
        {
          type: 'Feature' as const,
          properties: {
            id: Number(row.ogf_id),
            name: row.name,
            area: row.area_m2,
            onNetwork: row.on_network,
          },
          geometry:
            polys.length === 1
              ? { type: 'Polygon' as const, coordinates: polys[0] }
              : { type: 'MultiPolygon' as const, coordinates: polys },
        },
      ];
    });
    return NextResponse.json({ type: 'FeatureCollection', features });
  } catch (error) {
    console.error('paddle lakes error:', error);
    return NextResponse.json({ error: 'Failed to load lakes', detail: String(error) }, { status: 500 });
  }
}
