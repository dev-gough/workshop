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
import type { BuiltGraph, GraphSegment } from './graph';
import { chartOnDisk } from './jefftiles';
import {
  chartWaterFraction,
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
// Reject traces that stray too far from the OTN line — but scale the
// allowance with length: OTN digitizes long carries as near-straight lines,
// and a real 3 km portage can legitimately swing ~1 km wide of that chord
// (seen at the McKaskill 3760 m carry).
const MAX_DEV_BASE_M = 450;
const MAX_DEV_FRAC = 0.3; // of the segment's OTN length
const SIMPLIFY_PX = 1.5;   // Douglas–Peucker tolerance on the traced path

export interface AlignStats {
  aligned: number;
  noSnap: number;   // an endpoint had no skeleton pixel within SNAP_PX
  noPath: number;   // endpoints snapped to disconnected skeleton pieces
  rejected: number; // trace failed the length/deviation sanity checks
  offChart: number;
  reclassified: number; // paddle stretches the chart's dot chain overruled
  toPaddle: number;     // "portages" the chart shows as open water
  tracks: number;       // "portages" the chart shows as dry land with no carry
  splits: number;       // mixed segments cut at dot-coverage boundaries
}

function nearestSkelPx(
  skel: ChartSkeleton,
  gx: number,
  gy: number,
  maxPx: number = SNAP_PX,
): number | null {
  const lx = gx - skel.gx0;
  const ly = gy - skel.gy0;
  let best = -1;
  let bestD2 = maxPx * maxPx;
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

// Chart-arbitrated reclassification — the chart is ground truth for what a
// stretch of route IS. Dots only ride the ribbon where you carry (never
// across real paddling water), so dot coverage over a "paddle" stretch means
// the classifier clipped a stream/marsh the trail crosses and the stretch is
// really part of the carry. OTN is a single polyline network (paddle and
// portage are the same line, classified), so there is no parallel-line
// false-positive to fear.
const RECLASS_MAX_M = 1500;    // wetland carries run long (McDonald Ck: 632 m)
const RECLASS_NEAR_PX = 15;    // sample counts as covered within ~50 ground m
const RECLASS_COVERAGE = 0.7;  // fraction of samples the dot chain must cover
const RECLASS_STEP_PX = 6;     // sampling interval along the line

// The inverse arbitration, for "portages" the dot chain disowns (<= this
// coverage): water under the line means it is really paddling; dry paper
// means a walkable-but-not-a-carry track (hydro corridors, walk-ins).
const DISOWN_COVERAGE = 0.15;
const DISOWN_MIN_M = 400;      // leave short unaligned stubs alone
const WATER_FRAC_PADDLE = 0.6;

// Mixed-segment splitting: one OTN segment can blend a real carry with a
// phantom stretch the chart disowns (the Bonnechere hydro corridor: real
// dashes at both ends, 3 km of bare paper between — 0.68 whole-segment
// coverage, unarbitratable). Split at the dot-coverage boundaries and let
// each piece be what the chart says it is.
const SPLIT_MIN_SEG_M = 1000;  // only long portages can hide a phantom stretch
const SPLIT_MIN_RUN_M = 400;   // an uncovered piece must be this long to stand
const SPLIT_GAP_FILL_M = 350;  // shorter uncovered gaps are label occlusion
const SPLIT_BLIP_FILL_M = 150; // shorter covered blips are chance crossings
const SPLIT_EDGE_COV_M = 250;  // covered edge runs shorter than this are noise

/** Flip runs of `value` no longer than maxLen that sit between opposite runs. */
function fillRuns(flags: boolean[], value: boolean, maxLen: number): void {
  let i = 0;
  while (i < flags.length) {
    if (flags[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < flags.length && flags[j] === value) j++;
    if (i > 0 && j < flags.length && j - i <= maxLen) {
      for (let k = i; k < j; k++) flags[k] = !value;
    }
    i = j;
  }
}

/** Cut a polyline at pixel-arc positions (global z15 px space). */
function cutAtPxArcs(coords: [number, number][], arcs: number[]): [number, number][][] {
  const pts = coords.map((c) => [mercPxX(c[0]), mercPxY(c[1])] as [number, number]);
  const pieces: [number, number][][] = [];
  let piece: [number, number][] = [coords[0]];
  let walked = 0;
  let cut = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    while (cut < arcs.length && arcs[cut] <= walked + len) {
      const t = len ? (arcs[cut] - walked) / len : 0;
      const gx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const gy = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const v: [number, number] = [mercLon(gx), mercLat(gy)];
      piece.push(v);
      pieces.push(piece);
      piece = [v];
      cut++;
    }
    piece.push(coords[i]);
    walked += len;
  }
  pieces.push(piece);
  return pieces;
}

function segBBox(seg: GraphSegment, marginM: number): [number, number, number, number] {
  const lons = seg.coords.map((c) => c[0]);
  const lats = seg.coords.map((c) => c[1]);
  const dLat = marginM / 110_540;
  const dLon = marginM / (111_320 * Math.cos((lats[0] * Math.PI) / 180));
  return [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat];
}

/** Evenly-spaced global-pixel samples along a polyline. */
function samplePx(coords: [number, number][], stepPx: number): [number, number][] {
  const pts = coords.map((c) => [mercPxX(c[0]), mercPxY(c[1])] as [number, number]);
  const out: [number, number][] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = stepPx - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
      d += stepPx;
    }
    carry = (carry + len) % stepPx;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Mutates the graph's portage segments toward chart geometry (splitting can
 * add nodes and segments). Returns null (untouched) when the park has no
 * chart on disk.
 */
export async function alignPortagesToChart(
  graph: BuiltGraph,
  slug: string,
  log: (msg: string) => void = () => {},
): Promise<AlignStats | null> {
  if (!chartOnDisk(slug)) return null;

  const segments = graph.segments;
  const cache: TileCache = new Map();

  const dotCoverage = (skel: ChartSkeleton, samples: [number, number][]): number => {
    let covered = 0;
    for (const [gx, gy] of samples) {
      if (nearestSkelPx(skel, gx, gy, RECLASS_NEAR_PX) !== null) covered++;
    }
    return samples.length ? covered / samples.length : 0;
  };

  // ---- pass 1: paddle stretches the dot chain covers become portage ----
  let reclassified = 0;
  const candidates = segments
    .filter((s) => s.kind === 'paddle' && s.lengthM <= RECLASS_MAX_M)
    .sort((p, q) => mercPxX(p.coords[0][0]) - mercPxX(q.coords[0][0]));
  let scanned = 0;
  for (const seg of candidates) {
    if (++scanned % 400 === 0) log(`  chart arbitration: ${scanned}/${candidates.length} paddle stretches checked...`);
    const skel = await extractPortageSkeleton(slug, segBBox(seg, 200), cache);
    if (!skel) continue;
    const samples = samplePx(seg.coords, RECLASS_STEP_PX);
    if (dotCoverage(skel, samples) >= RECLASS_COVERAGE) {
      seg.kind = 'portage';
      reclassified++;
      if (process.env.CHART_DEBUG) {
        console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): paddle->portage`);
      }
    }
  }

  const stats: AlignStats = {
    aligned: 0, noSnap: 0, noPath: 0, rejected: 0, offChart: 0,
    reclassified, toPaddle: 0, tracks: 0, splits: 0,
  };

  // ---- pass 1.5: split mixed segments where chart support ends ----
  let nextSegId = segments.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  const longPortages = segments
    .filter((s) => s.kind === 'portage' && s.lengthM >= SPLIT_MIN_SEG_M)
    .sort((p, q) => mercPxX(p.coords[0][0]) - mercPxX(q.coords[0][0]));
  for (const seg of longPortages) {
    const skel = await extractPortageSkeleton(slug, segBBox(seg, 200), cache);
    if (!skel) continue;
    const samples = samplePx(seg.coords, RECLASS_STEP_PX);
    if (samples.length < 8) continue;
    const mPer = seg.lengthM / (samples.length - 1);
    const flags = samples.map(
      ([gx, gy]) => nearestSkelPx(skel, gx, gy, RECLASS_NEAR_PX) !== null,
    );
    // Iterate the smoothing to a fixpoint: interior gaps/blips flip to their
    // surroundings, and short edge runs get absorbed into their neighbor.
    // What survives is a stable alternation of substantial runs.
    const gapFill = Math.max(1, Math.round(SPLIT_GAP_FILL_M / mPer));
    const blipFill = Math.max(1, Math.round(SPLIT_BLIP_FILL_M / mPer));
    const edgeCov = Math.max(1, Math.round(SPLIT_EDGE_COV_M / mPer));
    const edgeUnc = Math.max(1, Math.round(SPLIT_MIN_RUN_M / mPer));
    const flipEdge = (fromStart: boolean) => {
      const n = flags.length;
      let len = 0;
      const v = flags[fromStart ? 0 : n - 1];
      for (let i = fromStart ? 0 : n - 1; i >= 0 && i < n && flags[i] === v; i += fromStart ? 1 : -1) len++;
      if (len < n && len <= (v ? edgeCov : edgeUnc)) {
        for (let k = 0; k < len; k++) flags[fromStart ? k : n - 1 - k] = !v;
      }
    };
    for (let iter = 0; iter < 6; iter++) {
      const before = flags.join('');
      fillRuns(flags, false, gapFill);
      fillRuns(flags, true, blipFill);
      flipEdge(true);
      flipEdge(false);
      if (flags.join('') === before) break;
    }

    const runs: { covered: boolean; start: number; end: number }[] = [];
    for (let i = 0; i < flags.length; i++) {
      const last = runs[runs.length - 1];
      if (last && last.covered === flags[i]) last.end = i;
      else runs.push({ covered: flags[i], start: i, end: i });
    }
    if (runs.length < 2) continue;

    // what each uncovered piece really is, per the chart's paint
    const kinds: ('paddle' | 'portage' | 'track')[] = [];
    for (const run of runs) {
      if (run.covered) {
        kinds.push('portage');
      } else {
        const waterFrac = await chartWaterFraction(slug, samples.slice(run.start, run.end + 1), cache);
        kinds.push(waterFrac !== null && waterFrac >= WATER_FRAC_PADDLE ? 'paddle' : 'track');
      }
    }

    const pieces = cutAtPxArcs(seg.coords, runs.slice(0, -1).map((r) => (r.end + 1) * RECLASS_STEP_PX));
    if (pieces.length !== runs.length) continue; // arc landed off the end — leave it be

    const pieceLen = (coords: [number, number][]) => {
      let len = 0;
      for (let i = 1; i < coords.length; i++) len += haversineM(coords[i - 1], coords[i]);
      return len;
    };
    let fromNode = seg.a;
    for (let i = 0; i < pieces.length; i++) {
      const isLast = i === pieces.length - 1;
      let toNode = seg.b;
      if (!isLast) {
        const v = pieces[i][pieces[i].length - 1];
        toNode = graph.nodes.length;
        graph.nodes.push({ id: toNode, lon: v[0], lat: v[1] });
      }
      if (i === 0) {
        seg.kind = kinds[0];
        seg.b = toNode;
        seg.coords = pieces[0];
        seg.lengthM = pieceLen(pieces[0]);
      } else {
        segments.push({
          id: nextSegId++, kind: kinds[i], a: fromNode, b: toNode,
          lengthM: pieceLen(pieces[i]), coords: pieces[i],
        });
      }
      if (kinds[i] === 'track') stats.tracks++;
      else if (kinds[i] === 'paddle') stats.toPaddle++;
      fromNode = toNode;
    }
    stats.splits++;
    if (process.env.CHART_DEBUG) {
      console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m orig): split into ${kinds.join('/')}`);
    }
  }

  // ---- pass 2: trace every portage (flips and split pieces included) ----
  const portages = segments
    .filter((s) => s.kind === 'portage')
    // tile-order sweep keeps the decoded-tile cache hot
    .sort((p, q) => mercPxX(p.coords[0][0]) - mercPxX(q.coords[0][0]));

  let done = 0;

  // A failed portage the dot chain disowns gets arbitrated by what the chart
  // paints under it: water → it's really paddling; dry paper → a walkable
  // track, not a carry. Returns the new kind, or null to leave it alone.
  const disown = async (seg: GraphSegment, skel: ChartSkeleton): Promise<string | null> => {
    if (seg.lengthM < DISOWN_MIN_M) return null;
    const samples = samplePx(seg.coords, RECLASS_STEP_PX);
    if (dotCoverage(skel, samples) > DISOWN_COVERAGE) return null;
    const waterFrac = await chartWaterFraction(slug, samples, cache);
    if (waterFrac === null) return null;
    seg.kind = waterFrac >= WATER_FRAC_PADDLE ? 'paddle' : 'track';
    if (process.env.CHART_DEBUG) {
      console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): portage->${seg.kind} (water ${waterFrac.toFixed(2)})`);
    }
    return seg.kind;
  };

  for (const seg of portages) {
    if (++done % 200 === 0) log(`  chart alignment: ${done}/${portages.length} portages examined...`);
    const skel = await extractPortageSkeleton(slug, segBBox(seg, MARGIN_M), cache);
    if (!skel) {
      stats.offChart++;
      continue;
    }

    const first = seg.coords[0];
    const last = seg.coords[seg.coords.length - 1];
    const a = nearestSkelPx(skel, mercPxX(first[0]), mercPxY(first[1]));
    const b = nearestSkelPx(skel, mercPxX(last[0]), mercPxY(last[1]));
    if (a === null || b === null || a === b) {
      const flipped = await disown(seg, skel);
      if (flipped === 'paddle') stats.toPaddle++;
      else if (flipped === 'track') stats.tracks++;
      else {
        stats.noSnap++;
        if (process.env.CHART_DEBUG) console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): no-snap`);
      }
      continue;
    }
    const path = skelPath(skel, a, b);
    if (!path) {
      const flipped = await disown(seg, skel);
      if (flipped === 'paddle') stats.toPaddle++;
      else if (flipped === 'track') stats.tracks++;
      else {
        stats.noPath++;
        if (process.env.CHART_DEBUG) console.error(`[align] seg ${seg.id} (${Math.round(seg.lengthM)}m): no-path`);
      }
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
      maxDeviationM(trace, seg.coords) > Math.max(MAX_DEV_BASE_M, MAX_DEV_FRAC * seg.lengthM)
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
