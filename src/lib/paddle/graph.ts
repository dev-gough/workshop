/**
 * Turns classified paddle/portage polylines into a routable graph.
 *
 * OTN digitizes the network as 231 independent paths whose junctions don't
 * share vertices, so topology has to be recovered:
 *   1. cluster all segment endpoints within SNAP_M into shared nodes;
 *   2. where a node sits on the *interior* of another segment (a T-junction,
 *      e.g. a portage landing on a lake-crossing line), split that segment
 *      at the node — without this the graph silently disconnects there;
 *   3. emit dense per-park node ids + segments with (node_a, node_b).
 */
import { haversineM, type ClassifiedSegment } from './classify';

const SNAP_M = 30;   // endpoint-to-endpoint merge radius
const TJOIN_M = 20;  // node-to-segment-interior split radius
const END_GUARD_M = 35; // don't split within this arc distance of a segment's own ends

export interface GraphNode {
  id: number;
  lon: number;
  lat: number;
}

export interface GraphSegment {
  id: number;
  kind: 'paddle' | 'portage';
  a: number;
  b: number;
  lengthM: number;
  coords: [number, number][];
}

export interface BuiltGraph {
  nodes: GraphNode[];
  segments: GraphSegment[];
  componentCount: number;
  largestComponentShare: number;
}

export function buildGraph(input: ClassifiedSegment[], midLat: number): BuiltGraph {
  const mx = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const my = 110_540;
  const px = (c: [number, number]) => c[0] * mx;
  const py = (c: [number, number]) => c[1] * my;

  // ---- 1. endpoint clustering (grid + union-find) ----
  interface EndPt { x: number; y: number; seg: number; end: 0 | 1 }
  const endpts: EndPt[] = [];
  input.forEach((s, i) => {
    endpts.push({ x: px(s.coords[0]), y: py(s.coords[0]), seg: i, end: 0 });
    const last = s.coords[s.coords.length - 1];
    endpts.push({ x: px(last), y: py(last), seg: i, end: 1 });
  });

  const parent = endpts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => { parent[find(i)] = find(j); };

  const CELL = SNAP_M;
  const grid = new Map<string, number[]>();
  endpts.forEach((p, i) => {
    const key = `${Math.round(p.x / CELL)},${Math.round(p.y / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  endpts.forEach((p, i) => {
    const cx = Math.round(p.x / CELL);
    const cy = Math.round(p.y / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j <= i) continue;
          const q = endpts[j];
          if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= SNAP_M * SNAP_M) union(i, j);
        }
      }
    }
  });

  const clusterOf = new Map<number, number>(); // root -> node id
  const nodes: GraphNode[] = [];
  const nodeAccum: { sx: number; sy: number; n: number }[] = [];
  endpts.forEach((p, i) => {
    const root = find(i);
    let id = clusterOf.get(root);
    if (id === undefined) {
      id = nodes.length;
      clusterOf.set(root, id);
      nodes.push({ id, lon: 0, lat: 0 });
      nodeAccum.push({ sx: 0, sy: 0, n: 0 });
    }
    nodeAccum[id].sx += p.x;
    nodeAccum[id].sy += p.y;
    nodeAccum[id].n++;
  });
  nodes.forEach((node, id) => {
    node.lon = nodeAccum[id].sx / nodeAccum[id].n / mx;
    node.lat = nodeAccum[id].sy / nodeAccum[id].n / my;
  });
  // endpoints were pushed in order: segment i's ends live at indices 2i, 2i+1
  const endNode = (seg: number, end: 0 | 1) => clusterOf.get(find(seg * 2 + end))!;

  // precompute per-segment projected coords + arc lengths
  const proj = input.map((s) => s.coords.map((c) => [px(c), py(c)] as [number, number]));
  const arcs = input.map((s, i) => {
    const a = [0];
    for (let k = 1; k < proj[i].length; k++) {
      a.push(a[k - 1] + Math.hypot(proj[i][k][0] - proj[i][k - 1][0], proj[i][k][1] - proj[i][k - 1][1]));
    }
    return a;
  });

  // ---- 2. T-junction detection ----
  const segGrid = new Map<string, number[]>();
  const SEGCELL = 500;
  proj.forEach((pts, i) => {
    const cells = new Set<string>();
    for (const [x, y] of pts) cells.add(`${Math.round(x / SEGCELL)},${Math.round(y / SEGCELL)}`);
    for (const key of cells) (segGrid.get(key) ?? segGrid.set(key, []).get(key)!).push(i);
  });

  const splits: Map<number, { arc: number; node: number }[]> = new Map();
  for (const node of nodes) {
    const nx = node.lon * mx;
    const ny = node.lat * my;
    const cx = Math.round(nx / SEGCELL);
    const cy = Math.round(ny / SEGCELL);
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const si of segGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (seen.has(si)) continue;
          seen.add(si);
          const pts = proj[si];
          const total = arcs[si][arcs[si].length - 1];
          if (total < 2 * END_GUARD_M) continue;
          let best: { d2: number; arc: number } | null = null;
          for (let k = 0; k + 1 < pts.length; k++) {
            const vx = pts[k + 1][0] - pts[k][0];
            const vy = pts[k + 1][1] - pts[k][1];
            const L2 = vx * vx + vy * vy;
            const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((nx - pts[k][0]) * vx + (ny - pts[k][1]) * vy) / L2));
            const ddx = nx - pts[k][0] - t * vx;
            const ddy = ny - pts[k][1] - t * vy;
            const d2 = ddx * ddx + ddy * ddy;
            if (!best || d2 < best.d2) best = { d2, arc: arcs[si][k] + Math.sqrt(L2) * t };
          }
          if (
            best &&
            best.d2 <= TJOIN_M * TJOIN_M &&
            best.arc > END_GUARD_M &&
            total - best.arc > END_GUARD_M
          ) {
            (splits.get(si) ?? splits.set(si, []).get(si)!).push({ arc: best.arc, node: node.id });
          }
        }
      }
    }
  }

  // ---- 3. rebuild segments with splits applied ----
  const out: GraphSegment[] = [];
  input.forEach((s, si) => {
    const a0 = endNode(si, 0);
    const b0 = endNode(si, 1);
    const cuts = (splits.get(si) ?? [])
      .sort((p, q) => p.arc - q.arc)
      // drop cuts that landed within a guard of each other
      .filter((c, i, arr) => i === 0 || c.arc - arr[i - 1].arc > 5);

    if (cuts.length === 0) {
      out.push({ id: out.length, kind: s.kind, a: a0, b: b0, lengthM: s.lengthM, coords: s.coords });
      return;
    }

    const pts = s.coords;
    const arc = arcs[si];
    let fromNode = a0;
    let pending: [number, number][] = [pts[0]];
    let cutIdx = 0;
    for (let k = 1; k < pts.length; k++) {
      while (cutIdx < cuts.length && cuts[cutIdx].arc <= arc[k]) {
        const cut = cuts[cutIdx];
        const node = nodes[cut.node];
        pending.push([node.lon, node.lat]);
        let len = 0;
        for (let m = 1; m < pending.length; m++) len += haversineM(pending[m - 1], pending[m]);
        if (len > 1) {
          out.push({ id: out.length, kind: s.kind, a: fromNode, b: cut.node, lengthM: len, coords: pending });
        }
        fromNode = cut.node;
        pending = [[node.lon, node.lat]];
        cutIdx++;
      }
      pending.push(pts[k]);
    }
    let len = 0;
    for (let m = 1; m < pending.length; m++) len += haversineM(pending[m - 1], pending[m]);
    if (len > 1 || pending.length >= 2) {
      out.push({ id: out.length, kind: s.kind, a: fromNode, b: b0, lengthM: len, coords: pending });
    }
  });

  // ---- 4. connectivity report ----
  const adj = new Map<number, number[]>();
  for (const seg of out) {
    (adj.get(seg.a) ?? adj.set(seg.a, []).get(seg.a)!).push(seg.b);
    (adj.get(seg.b) ?? adj.set(seg.b, []).get(seg.b)!).push(seg.a);
  }
  const visited = new Set<number>();
  let componentCount = 0;
  let largest = 0;
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    componentCount++;
    let size = 0;
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      size++;
      for (const nb of adj.get(n) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    largest = Math.max(largest, size);
  }

  return {
    nodes,
    segments: out,
    componentCount,
    largestComponentShare: visited.size ? largest / visited.size : 0,
  };
}
