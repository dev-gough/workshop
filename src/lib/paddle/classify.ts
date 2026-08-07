/**
 * Splits a park's OTN route polylines into paddle/portage segments.
 *
 * Method (validated against Temagami in the Phase-0 spike: 1,415 detected
 * portages vs ~1,450 known): sample the route every 25 m and call a sample
 * water when it's inside an OHN waterbody polygon OR within 15 m of an OHN
 * stream line — the second test exists because OHN maps narrow rivers as
 * watercourse *lines*, not polygons, and without it river runs classify as
 * multi-kilometre "portages". Real portages around rapids sit on the bank,
 * beyond the 15 m tether. Single-sample blips are smoothed away before runs
 * of same-class samples become segments.
 */
import type { EsriFeature } from './arcgis';

export interface ClassifiedSegment {
  kind: 'paddle' | 'portage';
  coords: [number, number][];
  lengthM: number;
}

const SAMPLE_M = 25;
const RIVER_NEAR_M = 15;
const GRID = 0.01; // spatial-hash cell in degrees (~800 m tall)

export function haversineM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

const cellKey = (cx: number, cy: number) => cx * 100_000 + cy;

class WaterIndex {
  private polyCells = new Map<number, number[]>();
  private bboxes: [number, number, number, number][] = [];
  private segCells = new Map<number, number[]>(); // flat [ax,ay,bx,by] quads
  private mx: number;
  private my: number;
  readonly touched = new Set<number>(); // waterbody indices that contained a sample

  constructor(
    private waterbodies: EsriFeature[],
    watercourses: EsriFeature[],
    midLat: number,
  ) {
    this.mx = 111_320 * Math.cos((midLat * Math.PI) / 180);
    this.my = 110_540;

    waterbodies.forEach((f, i) => {
      const rings = f.geometry?.rings ?? [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      this.bboxes.push([minX, minY, maxX, maxY]);
      for (let cx = Math.trunc(minX / GRID) - 1; cx <= Math.trunc(maxX / GRID) + 1; cx++) {
        for (let cy = Math.trunc(minY / GRID) - 1; cy <= Math.trunc(maxY / GRID) + 1; cy++) {
          const key = cellKey(cx, cy);
          const list = this.polyCells.get(key);
          if (list) list.push(i);
          else this.polyCells.set(key, [i]);
        }
      }
    });

    for (const f of watercourses) {
      for (const path of f.geometry?.paths ?? []) {
        for (let i = 0; i + 1 < path.length; i++) {
          const [ax, ay] = path[i];
          const [bx, by] = path[i + 1];
          const cx0 = Math.trunc(Math.min(ax, bx) / GRID);
          const cx1 = Math.trunc(Math.max(ax, bx) / GRID);
          const cy0 = Math.trunc(Math.min(ay, by) / GRID);
          const cy1 = Math.trunc(Math.max(ay, by) / GRID);
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
              const key = cellKey(cx, cy);
              const list = this.segCells.get(key);
              if (list) list.push(ax, ay, bx, by);
              else this.segCells.set(key, [ax, ay, bx, by]);
            }
          }
        }
      }
    }
  }

  private inWaterbody(x: number, y: number): boolean {
    const ids = this.polyCells.get(cellKey(Math.trunc(x / GRID), Math.trunc(y / GRID)));
    if (!ids) return false;
    for (const i of ids) {
      const [minX, minY, maxX, maxY] = this.bboxes[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      // even-odd across all rings handles island holes
      let inside = false;
      for (const ring of this.waterbodies[i].geometry!.rings!) {
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const [xi, yi] = ring[k];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) {
        this.touched.add(i);
        return true;
      }
    }
    return false;
  }

  private nearStream(x: number, y: number): boolean {
    const cx = Math.trunc(x / GRID);
    const cy = Math.trunc(y / GRID);
    const lim2 = RIVER_NEAR_M * RIVER_NEAR_M;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const quads = this.segCells.get(cellKey(cx + dx, cy + dy));
        if (!quads) continue;
        for (let q = 0; q < quads.length; q += 4) {
          const wx = (x - quads[q]) * this.mx;
          const wy = (y - quads[q + 1]) * this.my;
          const vx = (quads[q + 2] - quads[q]) * this.mx;
          const vy = (quads[q + 3] - quads[q + 1]) * this.my;
          const L2 = vx * vx + vy * vy;
          const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
          const ddx = wx - t * vx;
          const ddy = wy - t * vy;
          if (ddx * ddx + ddy * ddy <= lim2) return true;
        }
      }
    }
    return false;
  }

  isWater(x: number, y: number): boolean {
    return this.inWaterbody(x, y) || this.nearStream(x, y);
  }
}

export function classifyPaths(
  paths: number[][][],
  waterbodies: EsriFeature[],
  streams: EsriFeature[],
  log?: (msg: string) => void,
): { segments: ClassifiedSegment[]; touchedWaterbodies: Set<number> } {
  const midLat =
    paths.reduce((s, p) => s + p[0][1], 0) / Math.max(1, paths.length);
  const index = new WaterIndex(waterbodies, streams, midLat);
  const segments: ClassifiedSegment[] = [];

  paths.forEach((path, pi) => {
    // densify to <= 25 m spacing, keeping original vertices
    const pts: [number, number][] = [[path[0][0], path[0][1]]];
    const cum: number[] = [0];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i] as [number, number];
      const b = path[i + 1] as [number, number];
      const d = haversineM(a, b);
      if (d === 0) continue;
      const steps = Math.floor(d / SAMPLE_M);
      for (let s = 1; s <= steps; s++) {
        const t = (s * SAMPLE_M) / d;
        if (t >= 1) break;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        cum.push(cum[cum.length - 1] + SAMPLE_M);
      }
      pts.push([b[0], b[1]]);
      cum.push(cum[cum.length - 1] + (d - steps * SAMPLE_M));
    }

    const cls = pts.map(([x, y]) => index.isWater(x, y));

    // flip 1-sample blips until stable (shoreline noise)
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i + 1 < cls.length; i++) {
        if (cls[i] !== cls[i - 1] && cls[i] !== cls[i + 1]) {
          cls[i] = cls[i - 1];
          changed = true;
        }
      }
    }

    for (let i = 0; i < cls.length; ) {
      let j = i;
      while (j < cls.length && cls[j] === cls[i]) j++;
      const coords = pts.slice(i, Math.min(j + 1, pts.length)); // overlap 1 pt into next run
      const lengthM = cum[Math.min(j, cum.length - 1)] - cum[i];
      if (coords.length >= 2) {
        segments.push({ kind: cls[i] ? 'paddle' : 'portage', coords, lengthM });
      }
      i = j;
    }
    if (pi % 50 === 0) log?.(`  classified path ${pi + 1}/${paths.length}`);
  });

  return { segments, touchedWaterbodies: index.touched };
}
