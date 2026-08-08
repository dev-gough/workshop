/**
 * Replaces OTN portage geometry with centerlines traced off the park's
 * Maps-by-Jeff chart. OTN digitizes many portages schematically (straight
 * lines between landings), while Jeff's lines come from aggregated GPS
 * tracks — so where a chart is on disk, its geometry (and the length it
 * implies) wins.
 *
 * Per portage segment: extract the dot-chain skeleton around its bbox
 * (chartvector.ts), snap both segment endpoints to the nearest skeleton
 * pixel, BFS along the skeleton between them, and adopt that path when it
 * passes sanity checks. The segment keeps its original OTN end vertices, so
 * graph nodes and junction topology are untouched — the traced path is
 * spliced between them.
 */
import { haversineM } from './classify';
import type { GraphSegment } from './graph';
import { chartOnDisk } from './jefftiles';
import {
  extractPortageSkeleton,
  mercLat,
  mercLon,
  mercPxX,
  mercPxY,
  type ChartSkeleton,
  type TileCache,
} from './chartvector';

const MARGIN_M = 500;      // bbox padding — how far off-OTN a real portage may wander
const SNAP_PX = 70;        // endpoint-to-skeleton snap radius (~230 ground m at z15) —
                           // dot chains stop short of landings, behind the end markers
const BRIDGE_PX = 90;      // max hop between skeleton components — label boxes, body
                           // text, and rapids arrows sit on the line and can occlude
                           // long stretches of it
const MAX_DEV_M = 450;     // reject traces that stray this far from the OTN line
const SIMPLIFY_PX = 1.5;   // Douglas–Peucker tolerance on the traced path

export interface AlignStats {
  aligned: number;
  noSnap: number;   // an endpoint had no skeleton pixel within SNAP_PX
  noPath: number;   // endpoints snapped to disconnected skeleton pieces
  rejected: number; // trace failed the length/deviation sanity checks
  offChart: number;
}

function nearestSkelPx(
  skel: ChartSkeleton,
  gx: number,
  gy: number,
): number | null {
  const lx = gx - skel.gx0;
  const ly = gy - skel.gy0;
  let best = -1;
  let bestD2 = SNAP_PX * SNAP_PX;
  for (let i = 0; i < skel.px.length; i++) {
    if (!skel.px[i]) continue;
    const dx = (i % skel.w) + 0.5 - lx;
    const dy = ((i / skel.w) | 0) + 0.5 - ly;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

/** BFS along 8-connected skeleton pixels; returns pixel indices a→b. */
function bfsWithin(skel: ChartSkeleton, a: number, b: number): number[] | null {
  const { w, h, px } = skel;
  const parent = new Int32Array(px.length).fill(-1);
  parent[a] = a;
  let frontier = [a];
  while (frontier.length) {
    const next: number[] = [];
    for (const p of frontier) {
      if (p === b) {
        const path = [b];
        for (let c = b; c !== a; ) {
          c = parent[c];
          path.push(c);
        }
        return path.reverse();
      }
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (px[n] && parent[n] < 0) {
            parent[n] = p;
            next.push(n);
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Path a→b along the skeleton, allowed to hop between disconnected skeleton
 * components where a label box or wedge occludes the line. Components become
 * super-nodes; Dijkstra over them minimizes total hop distance, then the
 * pixel path is stitched per component (hops appear as straight jumps, which
 * is fine — the real line is hidden under the label there anyway).
 */
function skelPath(skel: ChartSkeleton, a: number, b: number): number[] | null {
  const { w, px } = skel;
  // label 8-connected components
  const compOf = new Int32Array(px.length).fill(-1);
  const compPixels: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < px.length; i++) {
    if (!px[i] || compOf[i] >= 0) continue;
    const id = compPixels.length;
    const pixels: number[] = [];
    stack.length = 0;
    stack.push(i);
    compOf[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= skel.h) continue;
          const n = ny * w + nx;
          if (px[n] && compOf[n] < 0) {
            compOf[n] = id;
            stack.push(n);
          }
        }
      }
    }
    compPixels.push(pixels);
  }

  const ca = compOf[a];
  const cb = compOf[b];
  if (ca === cb) return bfsWithin(skel, a, b);

  // pairwise closest pixels between components (few thousand px per bbox)
  const nComp = compPixels.length;
  const gap = new Map<number, { d: number; pi: number; pj: number }>();
  for (let i = 0; i < nComp; i++) {
    for (let j = i + 1; j < nComp; j++) {
      let best: { d: number; pi: number; pj: number } | null = null;
      for (const p of compPixels[i]) {
        const pxx = p % w;
        const pxy = (p / w) | 0;
        for (const q of compPixels[j]) {
          const d = Math.hypot((q % w) - pxx, ((q / w) | 0) - pxy);
          if (!best || d < best.d) best = { d, pi: p, pj: q };
        }
      }
      if (best && best.d <= BRIDGE_PX) gap.set(i * nComp + j, best);
    }
  }

  // Dijkstra over components, cost = summed hop distance
  const dist = new Array(nComp).fill(Infinity);
  const prev = new Int32Array(nComp).fill(-1);
  dist[ca] = 0;
  const open = new Set<number>([ca]);
  const settled = new Uint8Array(nComp);
  while (open.size) {
    let u = -1;
    for (const c of open) if (u < 0 || dist[c] < dist[u]) u = c;
    open.delete(u);
    settled[u] = 1;
    if (u === cb) break;
    for (let v = 0; v < nComp; v++) {
      if (settled[v]) continue;
      const e = gap.get(u < v ? u * nComp + v : v * nComp + u);
      if (!e) continue;
      if (dist[u] + e.d < dist[v]) {
        dist[v] = dist[u] + e.d;
        prev[v] = u;
        open.add(v);
      }
    }
  }
  if (dist[cb] === Infinity) return null;

  const chain: number[] = [];
  for (let c = cb; c >= 0; c = prev[c]) chain.push(c);
  chain.reverse();

  // stitch: within each component walk entry→exit, then hop to the next
  const path: number[] = [];
  let entry = a;
  for (let k = 0; k < chain.length; k++) {
    const cur = chain[k];
    let exit: number;
    if (k === chain.length - 1) {
      exit = b;
    } else {
      const nextComp = chain[k + 1];
      const e = gap.get(cur < nextComp ? cur * nComp + nextComp : nextComp * nComp + cur)!;
      exit = compOf[e.pi] === cur ? e.pi : e.pj;
    }
    const leg = bfsWithin(skel, entry, exit);
    if (!leg) return null;
    path.push(...leg);
    if (k < chain.length - 1) {
      const nextComp = chain[k + 1];
      const e = gap.get(cur < nextComp ? cur * nComp + nextComp : nextComp * nComp + cur)!;
      entry = compOf[e.pi] === nextComp ? e.pi : e.pj;
    }
  }
  return path;
}

function dpSimplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [sx, sy] = pts[s];
    const [ex, ey] = pts[e];
    const vx = ex - sx;
    const vy = ey - sy;
    const l2 = vx * vx + vy * vy;
    let worst = -1;
    let worstD2 = tol * tol;
    for (let i = s + 1; i < e; i++) {
      const t = l2 ? Math.max(0, Math.min(1, ((pts[i][0] - sx) * vx + (pts[i][1] - sy) * vy) / l2)) : 0;
      const dx = pts[i][0] - sx - t * vx;
      const dy = pts[i][1] - sy - t * vy;
      const d2 = dx * dx + dy * dy;
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([s, worst], [worst, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Max distance (ground m) from sampled trace points to the OTN polyline. */
function maxDeviationM(trace: [number, number][], otn: [number, number][]): number {
  const cosLat = Math.cos((otn[0][1] * Math.PI) / 180);
  const mx = 111_320 * cosLat;
  const my = 110_540;
  let worst = 0;
  const step = Math.max(1, Math.floor(trace.length / 40));
  for (let i = 0; i < trace.length; i += step) {
    const x = trace[i][0] * mx;
    const y = trace[i][1] * my;
    let best = Infinity;
    for (let k = 0; k + 1 < otn.length; k++) {
      const ax = otn[k][0] * mx;
      const ay = otn[k][1] * my;
      const vx = otn[k + 1][0] * mx - ax;
      const vy = otn[k + 1][1] * my - ay;
      const l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
      const dx = x - ax - t * vx;
      const dy = y - ay - t * vy;
      best = Math.min(best, dx * dx + dy * dy);
    }
    worst = Math.max(worst, best);
  }
  return Math.sqrt(worst);
}

/**
 * Mutates portage segments in `segments` toward chart geometry.
 * Returns null (untouched) when the park has no chart on disk.
 */
export async function alignPortagesToChart(
  segments: GraphSegment[],
  slug: string,
  log: (msg: string) => void = () => {},
): Promise<AlignStats | null> {
  if (!chartOnDisk(slug)) return null;

  const portages = segments
    .filter((s) => s.kind === 'portage')
    // tile-order sweep keeps the decoded-tile cache hot
    .sort((p, q) => mercPxX(p.coords[0][0]) - mercPxX(q.coords[0][0]));

  const stats: AlignStats = { aligned: 0, noSnap: 0, noPath: 0, rejected: 0, offChart: 0 };
  const cache: TileCache = new Map();
  let done = 0;

  for (const seg of portages) {
    if (++done % 200 === 0) log(`  chart alignment: ${done}/${portages.length} portages examined...`);
    const lons = seg.coords.map((c) => c[0]);
    const lats = seg.coords.map((c) => c[1]);
    const dLat = MARGIN_M / 110_540;
    const dLon = MARGIN_M / (111_320 * Math.cos((lats[0] * Math.PI) / 180));
    const skel = await extractPortageSkeleton(
      slug,
      [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat],
      cache,
    );
    if (!skel) {
      stats.offChart++;
      continue;
    }

    const first = seg.coords[0];
    const last = seg.coords[seg.coords.length - 1];
    const a = nearestSkelPx(skel, mercPxX(first[0]), mercPxY(first[1]));
    const b = nearestSkelPx(skel, mercPxX(last[0]), mercPxY(last[1]));
    if (a === null || b === null || a === b) {
      stats.noSnap++;
      if (process.env.CHART_DEBUG) console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): no-snap`);
      continue;
    }
    const path = skelPath(skel, a, b);
    if (!path) {
      stats.noPath++;
      if (process.env.CHART_DEBUG) console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): no-path`);
      continue;
    }

    const pxPts = path.map(
      (p) => [(p % skel.w) + 0.5, ((p / skel.w) | 0) + 0.5] as [number, number],
    );
    const trace = dpSimplify(pxPts, SIMPLIFY_PX).map(
      (p) => [mercLon(skel.gx0 + p[0]), mercLat(skel.gy0 + p[1])] as [number, number],
    );

    const coords: [number, number][] = [first, ...trace, last];
    let lengthM = 0;
    for (let i = 1; i < coords.length; i++) lengthM += haversineM(coords[i - 1], coords[i]);

    // Sanity: a trace that shrinks/balloons the length or wanders far from
    // the OTN line probably latched onto a neighboring portage.
    if (
      lengthM < 0.35 * seg.lengthM ||
      lengthM > 3.5 * seg.lengthM + 200 ||
      maxDeviationM(trace, seg.coords) > MAX_DEV_M
    ) {
      stats.rejected++;
      if (process.env.CHART_DEBUG) {
        console.error(`[align] seg ${seg.id}: rejected (${Math.round(seg.lengthM)}m -> ${Math.round(lengthM)}m)`);
      }
      continue;
    }

    seg.coords = coords;
    seg.lengthM = lengthM;
    stats.aligned++;
  }

  return stats;
}
