/**
 * Client-side trip router for The Outfitter.
 *
 * Works entirely on the /api/paddle/network payload: waypoints snap to the
 * nearest point on any segment polyline, and legs run A* between snaps over
 * the node graph. The cost model is time: paddling at one speed, carrying
 * (portage OR track) at another — tripled when double-carrying, since two
 * loads means walking every carry three times — plus a flat load/unload
 * penalty each time the route steps out of the water onto a carry. A* state
 * is (node, arrived-by-walk) so consecutive portage segments count as ONE
 * carry with one penalty.
 */
import type { Network, NetworkSegment } from './model';

export interface CostParams {
  paddleKmh: number;
  walkKmh: number;
  doubleCarry: boolean;
  loadUnloadMin: number;
}

export const DEFAULT_COST: CostParams = {
  paddleKmh: 5,
  walkKmh: 3,
  doubleCarry: false,
  loadUnloadMin: 10,
};

export interface Snap {
  segIdx: number;      // index into network.segments
  arcM: number;        // metres along the segment from its `a` end
  point: [number, number];
  distM: number;       // how far the click was from the line
}

export interface Leg {
  coords: [number, number][];
  /** Contiguous same-kind stretches, for per-kind route rendering. */
  pieces: { kind: NetworkSegment['kind']; coords: [number, number][] }[];
  paddleM: number;
  portageM: number;    // portage + track walking metres (single-carry ground distance)
  trackM: number;
  carries: number;     // water→land transitions (load/unload events)
  timeH: number;
  found: boolean;      // false = endpoints are in disconnected components
}

const walkish = (kind: NetworkSegment['kind']) => kind !== 'paddle';

interface PreparedSegment {
  seg: NetworkSegment;
  arcs: number[];      // cumulative metres per vertex
  lengthM: number;
}

interface IndexedEdge {
  segIdx: number;
  edgeIdx: number;
}

const SNAP_CELL_M = 1000;

export class TripRouter {
  private net: Network;
  private segs: PreparedSegment[];
  private adj: Map<number, { segIdx: number; from: 'a' | 'b' }[]>;
  private nodePos: Map<number, [number, number]>;
  private snapGrid = new Map<string, IndexedEdge[]>();
  private mx: number;
  private my = 110_540;

  constructor(net: Network) {
    this.net = net;
    const midLat = net.nodes.length
      ? net.nodes.reduce((t, n) => t + n.lat, 0) / net.nodes.length
      : 45.5;
    this.mx = 111_320 * Math.cos((midLat * Math.PI) / 180);

    this.segs = net.segments.map((seg) => {
      const arcs = [0];
      for (let i = 1; i < seg.coords.length; i++) {
        arcs.push(arcs[i - 1] + this.distM(seg.coords[i - 1], seg.coords[i]));
      }
      return { seg, arcs, lengthM: arcs[arcs.length - 1] || seg.length_m };
    });

    // Segment snapping used to scan every edge in the park for every click
    // and every waypoint restored from the logbook. Index edge bounding
    // boxes once; queries then inspect only cells touching the snap radius.
    this.segs.forEach(({ seg }, segIdx) => {
      for (let edgeIdx = 0; edgeIdx + 1 < seg.coords.length; edgeIdx++) {
        const a = seg.coords[edgeIdx];
        const b = seg.coords[edgeIdx + 1];
        const ax = a[0] * this.mx;
        const ay = a[1] * this.my;
        const bx = b[0] * this.mx;
        const by = b[1] * this.my;
        const edge = { segIdx, edgeIdx };
        const minX = Math.floor(Math.min(ax, bx) / SNAP_CELL_M);
        const maxX = Math.floor(Math.max(ax, bx) / SNAP_CELL_M);
        const minY = Math.floor(Math.min(ay, by) / SNAP_CELL_M);
        const maxY = Math.floor(Math.max(ay, by) / SNAP_CELL_M);
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const key = `${x},${y}`;
            (this.snapGrid.get(key) ?? this.snapGrid.set(key, []).get(key)!).push(edge);
          }
        }
      }
    });

    this.adj = new Map();
    this.segs.forEach(({ seg }, segIdx) => {
      (this.adj.get(seg.a) ?? this.adj.set(seg.a, []).get(seg.a)!).push({ segIdx, from: 'a' });
      (this.adj.get(seg.b) ?? this.adj.set(seg.b, []).get(seg.b)!).push({ segIdx, from: 'b' });
    });
    this.nodePos = new Map(net.nodes.map((n) => [n.id, [n.lon, n.lat]]));
  }

  private distM(p: [number, number], q: [number, number]): number {
    const dx = (p[0] - q[0]) * this.mx;
    const dy = (p[1] - q[1]) * this.my;
    return Math.hypot(dx, dy);
  }

  /** Nearest point on the network within maxM ground metres, or null. */
  snap(lngLat: [number, number], maxM = 300): Snap | null {
    let best: Snap | null = null;
    const qx = lngLat[0] * this.mx;
    const qy = lngLat[1] * this.my;
    const minX = Math.floor((qx - maxM) / SNAP_CELL_M);
    const maxX = Math.floor((qx + maxM) / SNAP_CELL_M);
    const minY = Math.floor((qy - maxM) / SNAP_CELL_M);
    const maxY = Math.floor((qy + maxM) / SNAP_CELL_M);
    const candidates = new Set<IndexedEdge>();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (const edge of this.snapGrid.get(`${x},${y}`) ?? []) candidates.add(edge);
      }
    }
    for (const { segIdx, edgeIdx: i } of candidates) {
      const { seg, arcs } = this.segs[segIdx];
      const [ax, ay] = seg.coords[i];
      const [bx, by] = seg.coords[i + 1];
      const vx = (bx - ax) * this.mx;
      const vy = (by - ay) * this.my;
      const wx = (lngLat[0] - ax) * this.mx;
      const wy = (lngLat[1] - ay) * this.my;
      const l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2)) : 0;
      const dx = wx - t * vx;
      const dy = wy - t * vy;
      const d = Math.hypot(dx, dy);
      if (d <= maxM && (!best || d < best.distM)) {
        const point: [number, number] = [ax + (bx - ax) * t, ay + (by - ay) * t];
        best = { segIdx, arcM: arcs[i] + Math.sqrt(l2) * t, point, distM: d };
      }
    }
    return best;
  }

  private segTimeH(kind: NetworkSegment['kind'], metres: number, p: CostParams): number {
    const km = metres / 1000;
    return walkish(kind) ? (km * (p.doubleCarry ? 3 : 1)) / p.walkKmh : km / p.paddleKmh;
  }

  /** Sub-polyline of a segment between two arc positions (either order). */
  private slice(segIdx: number, fromArc: number, toArc: number): [number, number][] {
    const { seg, arcs } = this.segs[segIdx];
    const lo = Math.min(fromArc, toArc);
    const hi = Math.max(fromArc, toArc);
    const pts: [number, number][] = [];
    const at = (arc: number): [number, number] => {
      for (let i = 0; i + 1 < arcs.length; i++) {
        if (arc <= arcs[i + 1] || i + 2 === arcs.length) {
          const span = arcs[i + 1] - arcs[i];
          const t = span ? Math.max(0, Math.min(1, (arc - arcs[i]) / span)) : 0;
          return [
            seg.coords[i][0] + (seg.coords[i + 1][0] - seg.coords[i][0]) * t,
            seg.coords[i][1] + (seg.coords[i + 1][1] - seg.coords[i][1]) * t,
          ];
        }
      }
      return seg.coords[seg.coords.length - 1];
    };
    pts.push(at(lo));
    for (let i = 0; i < arcs.length; i++) {
      if (arcs[i] > lo && arcs[i] < hi) pts.push(seg.coords[i]);
    }
    pts.push(at(hi));
    if (fromArc > toArc) pts.reverse();
    return pts;
  }

  /** One leg between two snapped points. */
  route(a: Snap, b: Snap, p: CostParams): Leg {
    const empty: Leg = { coords: [], pieces: [], paddleM: 0, portageM: 0, trackM: 0, carries: 0, timeH: 0, found: false };
    const segA = this.segs[a.segIdx];
    const segB = this.segs[b.segIdx];

    // both snaps on one segment: walk/paddle straight along it
    if (a.segIdx === b.segIdx) {
      const coords = this.slice(a.segIdx, a.arcM, b.arcM);
      const m = Math.abs(b.arcM - a.arcM);
      const kind = segA.seg.kind;
      const leg: Leg = {
        coords,
        pieces: [{ kind, coords }],
        paddleM: kind === 'paddle' ? m : 0,
        portageM: walkish(kind) ? m : 0,
        trackM: kind === 'track' ? m : 0,
        carries: walkish(kind) ? 1 : 0,
        timeH: this.segTimeH(kind, m, p) + (walkish(kind) ? p.loadUnloadMin / 60 : 0),
        found: true,
      };
      return leg;
    }

    // ---- A* over (node, arrivedByWalk) states ----
    const stateId = (node: number, walk: boolean) => node * 2 + (walk ? 1 : 0);
    const gScore = new Map<number, number>();
    const parent = new Map<number, { state: number; segIdx: number; from: 'a' | 'b' } | null>();
    const open: { state: number; f: number }[] = []; // tiny binary heap
    const push = (state: number, f: number) => {
      open.push({ state, f });
      let i = open.length - 1;
      while (i > 0) {
        const p2 = (i - 1) >> 1;
        if (open[p2].f <= open[i].f) break;
        [open[p2], open[i]] = [open[i], open[p2]];
        i = p2;
      }
    };
    const pop = () => {
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < open.length && open[l].f < open[m].f) m = l;
          if (r < open.length && open[r].f < open[m].f) m = r;
          if (m === i) break;
          [open[m], open[i]] = [open[i], open[m]];
          i = m;
        }
      }
      return top;
    };

    const bestKmh = Math.max(p.paddleKmh, p.walkKmh);
    const h = (node: number) => {
      const pos = this.nodePos.get(node);
      return pos ? this.distM(pos, b.point) / 1000 / bestKmh : 0;
    };

    // seed: from snap a to each end of its segment (no transition penalty at
    // the put-in — you start already loaded for whatever the first move is)
    const seed = (endNode: number, arcTo: number) => {
      const m = Math.abs(arcTo - a.arcM);
      const kind = segA.seg.kind;
      const g = this.segTimeH(kind, m, p);
      const s = stateId(endNode, walkish(kind));
      if (g < (gScore.get(s) ?? Infinity)) {
        gScore.set(s, g);
        parent.set(s, null);
        push(s, g + h(endNode));
      }
    };
    seed(segA.seg.a, 0);
    seed(segA.seg.b, segA.lengthM);

    // goal: reaching either end of b's segment, plus the partial run in
    const goalCost = new Map<number, { arc: number }>([
      [segB.seg.a, { arc: 0 }],
      [segB.seg.b, { arc: segB.lengthM }],
    ]);
    let goal: { state: number; total: number; via: number } | null = null;

    const closed = new Set<number>();
    while (open.length) {
      const { state } = pop();
      if (closed.has(state)) continue;
      closed.add(state);
      const g = gScore.get(state)!;
      const node = state >> 1;
      const byWalk = (state & 1) === 1;

      const goalEnd = goalCost.get(node);
      if (goalEnd) {
        const kind = segB.seg.kind;
        const m = Math.abs(b.arcM - goalEnd.arc);
        let total = g + this.segTimeH(kind, m, p);
        if (walkish(kind) && !byWalk) total += p.loadUnloadMin / 60;
        if (!goal || total < goal.total) goal = { state, total, via: goalEnd.arc };
        // keep exploring — the other end might be cheaper — but bounded:
        if (goal && g > goal.total) break;
      }
      if (goal && g > goal.total) break;

      for (const { segIdx, from } of this.adj.get(node) ?? []) {
        const ps = this.segs[segIdx];
        const kind = ps.seg.kind;
        const other = from === 'a' ? ps.seg.b : ps.seg.a;
        let cost = this.segTimeH(kind, ps.lengthM, p);
        if (walkish(kind) && !byWalk) cost += p.loadUnloadMin / 60;
        const ns = stateId(other, walkish(kind));
        const ng = g + cost;
        if (ng < (gScore.get(ns) ?? Infinity)) {
          gScore.set(ns, ng);
          parent.set(ns, { state, segIdx, from });
          push(ns, ng + h(other));
        }
      }
    }

    if (!goal) return empty;

    // ---- reconstruct ----
    const hops: { segIdx: number; from: 'a' | 'b' }[] = [];
    let cur: number | null = goal.state;
    while (cur !== null) {
      const p2 = parent.get(cur);
      if (!p2) break;
      hops.push({ segIdx: p2.segIdx, from: p2.from });
      cur = p2.state;
    }
    hops.reverse();

    const leg: Leg = { coords: [], pieces: [], paddleM: 0, portageM: 0, trackM: 0, carries: 0, timeH: goal.total, found: true };
    const pushCoords = (pts: [number, number][], kind: NetworkSegment['kind']) => {
      let piece = leg.pieces[leg.pieces.length - 1];
      if (!piece || piece.kind !== kind) {
        piece = { kind, coords: leg.coords.length ? [leg.coords[leg.coords.length - 1]] : [] };
        leg.pieces.push(piece);
      }
      for (const pt of pts) {
        const last = leg.coords[leg.coords.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) {
          leg.coords.push(pt);
          piece.coords.push(pt);
        }
      }
    };
    const tally = (kind: NetworkSegment['kind'], m: number, prevWalk: boolean | null) => {
      if (kind === 'paddle') leg.paddleM += m;
      else {
        leg.portageM += m;
        if (kind === 'track') leg.trackM += m;
        if (prevWalk === false || prevWalk === null) leg.carries++;
      }
    };

    // partial start
    const firstNode = hops.length
      ? (hops[0].from === 'a' ? this.segs[hops[0].segIdx].seg.a : this.segs[hops[0].segIdx].seg.b)
      : goal.state >> 1;
    const startToward = firstNode === segA.seg.a ? 0 : segA.lengthM;
    pushCoords(this.slice(a.segIdx, a.arcM, startToward), segA.seg.kind);
    tally(segA.seg.kind, Math.abs(startToward - a.arcM), null);
    let prevWalk = walkish(segA.seg.kind);

    for (const hop of hops) {
      const ps = this.segs[hop.segIdx];
      const pts = hop.from === 'a' ? ps.seg.coords : [...ps.seg.coords].reverse();
      pushCoords(pts, ps.seg.kind);
      tally(ps.seg.kind, ps.lengthM, prevWalk);
      prevWalk = walkish(ps.seg.kind);
    }

    // partial end
    pushCoords(this.slice(b.segIdx, goal.via, b.arcM), segB.seg.kind);
    tally(segB.seg.kind, Math.abs(b.arcM - goal.via), prevWalk);

    return leg;
  }
}

/** "5h20m" style estimate. */
export function fmtHours(h: number): string {
  const mins = Math.round(h * 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
}

/** Minimal GPX for the routed line + waypoints. */
export function toGpx(coords: [number, number][], waypoints: [number, number][], name: string): string {
  const wpts = waypoints
    .map((w, i) => `  <wpt lat="${w[1].toFixed(6)}" lon="${w[0].toFixed(6)}"><name>WP${i + 1}</name></wpt>`)
    .join('\n');
  const pts = coords
    .map((c) => `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="The Outfitter — Devy's Workshop" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <trk>
    <name>${name}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
