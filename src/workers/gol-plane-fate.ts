// Game of Life plane-fate classifier — what a seed becomes on the INFINITE plane.
//
// The census engine (gol-census-core.ts) plays Life in a W×H box with dead
// walls; its "oscillators" are oscillators of that bounded universe. This
// module answers the companion question: released onto the unbounded plane,
// does the same seed still oscillate — or was the wall doing the work?
//
// Method (a small apgsearch, in spirit):
//
//  • Simulate on a growing multi-word bit grid. Only the live bounding box
//    plus a one-cell halo is stepped, using the same carry-save adder tree as
//    the census core extended with cross-word carries and NO edge mask. The
//    grid recenters with fresh margins whenever the pattern nears an edge.
//
//  • Every generation the pattern, normalized to its bounding-box corner, is
//    recorded in a history map keyed by exact cell content. A recurrence with
//    zero world displacement is an oscillator (period 1 = still life); a
//    recurrence that moved is a spaceship.
//
//  • A seed that sheds gliders would otherwise stretch the bounding box
//    forever and hide the ash's cycle, so every STRIP_EVERY generations the
//    isolated connected components are matched against a phase table of the
//    standard ships (glider, L/M/HWSS) and removed once clearly outbound:
//    ≥ ESCAPE_GAP cells beyond everything else along a travel axis. Ships
//    sharing a velocity vector can never interact, so a glider stream doesn't
//    block its own members. Stripping invalidates history (cleared). This is
//    a heuristic — ash chasing down an outbound ship at near light speed
//    could fool it — but from ≤7×7 seeds that is beyond astronomically rare.
//
//  • Fate on the plane is undecidable in general (Life is Turing-complete):
//    generation, population and extent caps yield an honest 'unresolved'.
//
// Verified against known pattern fates by scripts/plane-fate-verify.ts.

import { decodeState } from './gol-census-core';

export type ShipName = 'glider' | 'lwss' | 'mwss' | 'hwss';
export type FateKind = 'dies' | 'still' | 'oscillator' | 'ship' | 'unresolved';

export interface PlaneFate {
  kind: FateKind;
  period: number;                  // cycle length (1 = still life); 0 for dies/unresolved
  dx: number;                      // ship displacement per period (0 otherwise)
  dy: number;
  shed: Record<ShipName, number>;  // outbound ships stripped along the way
  settledAt: number;               // generation the final cycle was entered (0 = the seed itself cycles)
  finalPop: number;
  gens: number;                    // generations simulated
  capped?: 'gens' | 'pop' | 'extent';
}

export interface PlaneFateOptions {
  maxGens?: number;    // default 10_000 (acorn, the worst ≤7×7 seed, settles at 5206)
  maxPop?: number;     // default 8_192
  maxExtent?: number;  // default 2_048 — live bounding-box side
}

export type Cell = [number, number];

const STRIP_EVERY = 16;        // generations between escape sweeps
const ESCAPE_GAP = 8;          // clearance before an outbound ship is stripped
const SHIP_MAX_POP = 20;       // largest standard ship phase is 18 cells (HWSS)
const TRACK_POP_CAP = 1024;    // history ignores states bigger than this (transients don't recur)
const KEY_LEN_CAP = 16384;     // ...or whose content key is huge (acorn ash ≈ 7 KB)
const HISTORY_CAP = 4096;      // bound memory; clearing only delays detection by ≤ one period
const MARGIN = 64;             // padding (cells) when (re)allocating the grid

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// ── Cell-list helpers (ship table + component matching; never the hot path) ─

/** Parse '.O.' pattern rows into cells — exported for tests. */
export function parseCells(rows: string[]): Cell[] {
  const out: Cell[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'O') out.push([x, y]);
  });
  return out;
}

interface NormCells { key: string; x0: number; y0: number; }

function normalizeCells(cells: Cell[]): NormCells {
  let x0 = Infinity, y0 = Infinity;
  for (const [x, y] of cells) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
  }
  const rel = cells.map(([x, y]) => (x - x0) * 4096 + (y - y0)).sort((a, b) => a - b);
  return { key: rel.join(','), x0, y0 };
}

// Tiny set-based stepper, used only to build the ship phase table at init.
const CK_OFF = 512, CK_SPAN = 4096;
const ck = (x: number, y: number) => (x + CK_OFF) * CK_SPAN + (y + CK_OFF);

function stepCells(cells: Cell[]): Cell[] {
  const alive = new Set<number>();
  for (const [x, y] of cells) alive.add(ck(x, y));
  const nb = new Map<number, number>();
  for (const [x, y] of cells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const k = ck(x + dx, y + dy);
        nb.set(k, (nb.get(k) ?? 0) + 1);
      }
    }
  }
  const out: Cell[] = [];
  for (const [k, n] of nb) {
    if (n === 3 || (n === 2 && alive.has(k))) {
      out.push([Math.floor(k / CK_SPAN) - CK_OFF, (k % CK_SPAN) - CK_OFF]);
    }
  }
  return out;
}

// ── Standard-ship phase table ─────────────────────────────────────────────
//
// Every phase of every D4 orientation of the four ships, keyed by normalized
// cells → travel direction (sign per axis). Velocities are MEASURED at build
// time by evolving each orientation to recurrence, so a typo in the base
// patterns throws at import rather than mis-stripping silently.

const SHIP_BASES: ReadonlyArray<{ name: ShipName; rows: string[] }> = [
  { name: 'glider', rows: ['.O.', '..O', 'OOO'] },
  { name: 'lwss', rows: ['.O..O', 'O....', 'O...O', 'OOOO.'] },
  { name: 'mwss', rows: ['...O..', '.O...O', 'O.....', 'O....O', 'OOOOO.'] },
  { name: 'hwss', rows: ['...OO..', '.O....O', 'O......', 'O.....O', 'OOOOOO.'] },
];

const TRANSFORMS: ReadonlyArray<(c: Cell) => Cell> = [
  ([x, y]) => [x, y], ([x, y]) => [-x, y], ([x, y]) => [x, -y], ([x, y]) => [-x, -y],
  ([x, y]) => [y, x], ([x, y]) => [-y, x], ([x, y]) => [y, -x], ([x, y]) => [-y, -x],
];

interface ShipHit { name: ShipName; sx: number; sy: number; }

function buildShipTable(): Map<string, ShipHit> {
  const table = new Map<string, ShipHit>();
  for (const { name, rows } of SHIP_BASES) {
    const base = parseCells(rows);
    for (const t of TRANSFORMS) {
      let abs = base.map(t);
      const n0 = normalizeCells(abs);
      const phases: NormCells[] = [n0];
      let done = false;
      for (let g = 1; g <= 8 && !done; g++) {
        abs = stepCells(abs);
        const n = normalizeCells(abs);
        if (n.key === n0.key) {
          const sx = Math.sign(n.x0 - n0.x0), sy = Math.sign(n.y0 - n0.y0);
          if (sx === 0 && sy === 0) throw new Error(`ship table: ${name} is not moving`);
          for (const ph of phases) table.set(ph.key, { name, sx, sy });
          done = true;
        } else {
          phases.push(n);
        }
      }
      if (!done) throw new Error(`ship table: ${name} did not recur within 8 generations`);
    }
  }
  return table;
}

const SHIP_TABLE = buildShipTable();

// ── The classifier ────────────────────────────────────────────────────────

export function planeFateFromCells(seed: Cell[], opts: PlaneFateOptions = {}): PlaneFate {
  const maxGens = opts.maxGens ?? 10_000;
  const maxPop = opts.maxPop ?? 8_192;
  const maxExtent = opts.maxExtent ?? 2_048;

  const shed: Record<ShipName, number> = { glider: 0, lwss: 0, mwss: 0, hwss: 0 };

  // Grid: gh rows × wpr words, bit x of word (y*wpr + x>>5) = cell (x, y) in
  // grid coordinates; world coordinate of grid (0,0) is (worldX0, worldY0).
  let wpr = 0, gh = 0;
  let cur = new Int32Array(0), nxt = new Int32Array(0);
  let h0 = cur, h1 = cur, u0 = cur, u1 = cur; // horizontal carry-save scratch
  let orBuf = cur;                            // column-OR scratch for bbox scans
  let worldX0 = 0, worldY0 = 0;
  // Live bounding box of `cur` (grid bits/rows) and population.
  let bx0 = 0, bx1 = -1, by0 = 0, by1 = -1, pop = 0;
  // Windows where each buffer may hold nonzero words (for cheap zeroing).
  let dirtyCur = { r0: 0, r1: -1, w0: 0, w1: -1 };
  let dirtyNxt = { r0: 0, r1: -1, w0: 0, w1: -1 };

  /** (Re)allocate the grid with fresh margins around `cells` (world coords). */
  function alloc(cells: Cell[]): boolean {
    let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
    for (const [x, y] of cells) {
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y;
      if (y > cy1) cy1 = y;
    }
    const pw = cx1 - cx0 + 1, ph = cy1 - cy0 + 1;
    if (pw > maxExtent || ph > maxExtent) return false;
    wpr = ((pw + 2 * MARGIN + 31) >> 5) + 1;
    gh = ph + 2 * MARGIN;
    const n = wpr * gh;
    cur = new Int32Array(n);
    nxt = new Int32Array(n);
    h0 = new Int32Array(n); h1 = new Int32Array(n);
    u0 = new Int32Array(n); u1 = new Int32Array(n);
    orBuf = new Int32Array(wpr);
    worldX0 = cx0 - MARGIN;
    worldY0 = cy0 - MARGIN;
    for (const [x, y] of cells) {
      const gx = x - worldX0, gy = y - worldY0;
      cur[gy * wpr + (gx >> 5)] |= 1 << (gx & 31);
    }
    bx0 = MARGIN; bx1 = MARGIN + pw - 1;
    by0 = MARGIN; by1 = MARGIN + ph - 1;
    pop = cells.length;
    dirtyCur = { r0: by0, r1: by1, w0: bx0 >> 5, w1: bx1 >> 5 };
    dirtyNxt = { r0: 0, r1: -1, w0: 0, w1: -1 };
    return true;
  }

  /** Live cells of `cur` in world coordinates. */
  function extractCells(): Cell[] {
    const out: Cell[] = [];
    const ka = bx0 >> 5, kb = bx1 >> 5;
    for (let y = by0; y <= by1; y++) {
      const base = y * wpr;
      for (let k = ka; k <= kb; k++) {
        let v = cur[base + k];
        while (v !== 0) {
          const b = v & -v;
          out.push([k * 32 + (31 - Math.clz32(b)) + worldX0, y + worldY0]);
          v ^= b;
        }
      }
    }
    return out;
  }

  /** Exact content key of `cur`, translation-normalized to the bbox corner. */
  function normKey(): string {
    const width = bx1 - bx0 + 1;
    const nw = (width + 31) >> 5;
    const s = bx0 & 31;
    const w0 = bx0 >> 5;
    const tailMask = (width & 31) !== 0 ? (1 << (width & 31)) - 1 : -1;
    const parts: string[] = [];
    for (let y = by0; y <= by1; y++) {
      const base = y * wpr + w0;
      let row = '';
      for (let j = 0; j < nw; j++) {
        const lo = cur[base + j];
        const hi = w0 + j + 1 < wpr ? cur[base + j + 1] : 0;
        let v = s === 0 ? lo : (lo >>> s) | (hi << (32 - s));
        if (j === nw - 1) v &= tailMask;
        row += (v >>> 0).toString(36) + ',';
      }
      parts.push(row);
    }
    return parts.join(';');
  }

  /** Rescan a window of `cur` for bbox + population (after step or strip). */
  function scanWindow(r0: number, r1: number, ka: number, kb: number): void {
    pop = 0;
    let ry0 = -1, ry1 = -1;
    for (let y = r0; y <= r1; y++) {
      const base = y * wpr;
      let any = 0;
      for (let k = ka; k <= kb; k++) {
        const v = cur[base + k];
        if (v !== 0) {
          any |= v;
          orBuf[k] |= v;
          pop += popcount32(v);
        }
      }
      if (any !== 0) {
        if (ry0 < 0) ry0 = y;
        ry1 = y;
      }
    }
    if (ry0 < 0) {
      bx0 = 0; bx1 = -1; by0 = 0; by1 = -1;
      return;
    }
    by0 = ry0; by1 = ry1;
    for (let k = ka; k <= kb; k++) {
      if (orBuf[k] !== 0) { bx0 = k * 32 + (31 - Math.clz32(orBuf[k] & -orBuf[k])); break; }
    }
    for (let k = kb; k >= ka; k--) {
      if (orBuf[k] !== 0) { bx1 = k * 32 + (31 - Math.clz32(orBuf[k])); break; }
    }
    for (let k = ka; k <= kb; k++) orBuf[k] = 0;
  }

  /** Recenter into a fresh grid if the pattern is near an edge. */
  function ensureRoom(): boolean {
    if (by0 >= 2 && by1 <= gh - 3 && bx0 >= 34 && bx1 <= wpr * 32 - 35) return true;
    return alloc(extractCells());
  }

  /** One unbounded generation over the live window. */
  function step(): void {
    const ry0 = by0 - 1, ry1 = by1 + 1;
    const wa = (bx0 - 1) >> 5, wb = (bx1 + 1) >> 5;
    // Zero the destination's stale window from two generations ago.
    for (let y = dirtyNxt.r0; y <= dirtyNxt.r1; y++) {
      const base = y * wpr;
      for (let k = dirtyNxt.w0; k <= dirtyNxt.w1; k++) nxt[base + k] = 0;
    }
    // Pass 1: per-(row, word) horizontal sums with cross-word carries.
    for (let y = ry0; y <= ry1; y++) {
      const base = y * wpr;
      for (let k = wa; k <= wb; k++) {
        const v = cur[base + k];
        const L = (v << 1) | (k > 0 ? cur[base + k - 1] >>> 31 : 0);
        const R = (v >>> 1) | (k < wpr - 1 ? cur[base + k + 1] << 31 : 0);
        const x = L ^ v;
        h0[base + k] = x ^ R;
        h1[base + k] = (L & v) | (x & R);
        u0[base + k] = L ^ R;
        u1[base + k] = L & R;
      }
    }
    // Pass 2: full-adder tree across the three rows, B3/S23, no wall mask.
    for (let y = ry0; y <= ry1; y++) {
      const base = y * wpr, up = base - wpr, dn = base + wpr;
      for (let k = wa; k <= wb; k++) {
        const a0 = y > ry0 ? h0[up + k] : 0;
        const a1 = y > ry0 ? h1[up + k] : 0;
        const c0 = y < ry1 ? h0[dn + k] : 0;
        const c1 = y < ry1 ? h1[dn + k] : 0;
        const b0 = u0[base + k];
        const b1 = u1[base + k];
        const t = a0 ^ b0;
        const ones = t ^ c0;
        const car = (a0 & b0) | (t & c0);
        const t2 = a1 ^ b1;
        const s2 = t2 ^ c1;
        const c2a = (a1 & b1) | (t2 & c1);
        const twos = s2 ^ car;
        const c2b = s2 & car;
        const fours = c2a | c2b;
        nxt[base + k] = twos & ~fours & (ones | cur[base + k]);
      }
    }
    const t = cur; cur = nxt; nxt = t;
    const td = dirtyCur;
    dirtyCur = { r0: ry0, r1: ry1, w0: wa, w1: wb };
    dirtyNxt = td;
    scanWindow(ry0, ry1, wa, wb);
  }

  /**
   * Match isolated components against the ship table and strip the clearly
   * outbound ones. Returns true if anything was removed (history is then
   * invalid — the caller clears it).
   */
  function stripEscapes(): boolean {
    if (pop > maxPop) return false;
    const cells = extractCells();
    // Connected components, 8-connectivity, keyed by grid coords.
    const live = new Set<number>();
    for (const [x, y] of cells) live.add((y - worldY0) * 65536 + (x - worldX0));
    const seen = new Set<number>();
    interface Comp { cells: Cell[]; x0: number; x1: number; y0: number; y1: number; }
    const comps: Comp[] = [];
    for (const [sx, sy] of cells) {
      const sk = (sy - worldY0) * 65536 + (sx - worldX0);
      if (seen.has(sk)) continue;
      const comp: Comp = { cells: [], x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      const stack = [sk];
      seen.add(sk);
      while (stack.length > 0) {
        const k = stack.pop()!;
        const gy = Math.floor(k / 65536), gx = k % 65536;
        const x = gx + worldX0, y = gy + worldY0;
        comp.cells.push([x, y]);
        if (x < comp.x0) comp.x0 = x;
        if (x > comp.x1) comp.x1 = x;
        if (y < comp.y0) comp.y0 = y;
        if (y > comp.y1) comp.y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nk = (gy + dy) * 65536 + (gx + dx);
            if (live.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
          }
        }
      }
      comps.push(comp);
    }
    if (comps.length < 2) return false;

    const matches = comps.map(c =>
      c.cells.length <= SHIP_MAX_POP ? SHIP_TABLE.get(normalizeCells(c.cells).key) ?? null : null,
    );

    let stripped = false;
    for (let i = 0; i < comps.length; i++) {
      const m = matches[i];
      if (!m) continue;
      // Bounding box of everything that could still interact with this ship.
      // Ships sharing its velocity vector keep a constant offset — excluded.
      let rx0 = Infinity, rx1 = -Infinity, ry0 = Infinity, ry1 = -Infinity;
      let hasRest = false;
      for (let j = 0; j < comps.length; j++) {
        if (j === i) continue;
        const mj = matches[j];
        if (mj && mj.sx === m.sx && mj.sy === m.sy) continue;
        hasRest = true;
        if (comps[j].x0 < rx0) rx0 = comps[j].x0;
        if (comps[j].x1 > rx1) rx1 = comps[j].x1;
        if (comps[j].y0 < ry0) ry0 = comps[j].y0;
        if (comps[j].y1 > ry1) ry1 = comps[j].y1;
      }
      const c = comps[i];
      const clear = !hasRest
        || (m.sx > 0 && c.x0 > rx1 + ESCAPE_GAP) || (m.sx < 0 && c.x1 < rx0 - ESCAPE_GAP)
        || (m.sy > 0 && c.y0 > ry1 + ESCAPE_GAP) || (m.sy < 0 && c.y1 < ry0 - ESCAPE_GAP);
      if (!clear) continue;
      for (const [x, y] of c.cells) {
        const gx = x - worldX0, gy = y - worldY0;
        cur[gy * wpr + (gx >> 5)] &= ~(1 << (gx & 31));
      }
      shed[m.name]++;
      stripped = true;
    }
    if (stripped) scanWindow(dirtyCur.r0, dirtyCur.r1, dirtyCur.w0, dirtyCur.w1);
    return stripped;
  }

  // ── Main loop ──
  const capped = (why: 'gens' | 'pop' | 'extent', gen: number): PlaneFate => ({
    kind: 'unresolved', period: 0, dx: 0, dy: 0, shed,
    settledAt: 0, finalPop: pop, gens: gen, capped: why,
  });

  if (seed.length === 0) {
    return { kind: 'dies', period: 0, dx: 0, dy: 0, shed, settledAt: 0, finalPop: 0, gens: 0 };
  }
  if (!alloc(seed)) return capped('extent', 0);

  const history = new Map<string, { gen: number; x: number; y: number }>();

  for (let gen = 0; ; gen++) {
    if (pop === 0) {
      return { kind: 'dies', period: 0, dx: 0, dy: 0, shed, settledAt: gen, finalPop: 0, gens: gen };
    }
    if (pop > maxPop) return capped('pop', gen);
    if (bx1 - bx0 + 1 > maxExtent || by1 - by0 + 1 > maxExtent) return capped('extent', gen);

    if (pop <= TRACK_POP_CAP) {
      const key = normKey();
      const prev = history.get(key);
      if (prev) {
        const ddx = worldX0 + bx0 - prev.x;
        const ddy = worldY0 + by0 - prev.y;
        const period = gen - prev.gen;
        if (ddx === 0 && ddy === 0) {
          return {
            kind: period === 1 ? 'still' : 'oscillator',
            period, dx: 0, dy: 0, shed, settledAt: prev.gen, finalPop: pop, gens: gen,
          };
        }
        return { kind: 'ship', period, dx: ddx, dy: ddy, shed, settledAt: prev.gen, finalPop: pop, gens: gen };
      }
      if (key.length <= KEY_LEN_CAP) {
        if (history.size >= HISTORY_CAP) history.clear();
        history.set(key, { gen, x: worldX0 + bx0, y: worldY0 + by0 });
      }
    }

    if (gen >= maxGens) return capped('gens', gen);

    if (gen > 0 && gen % STRIP_EVERY === 0 && stripEscapes()) {
      history.clear();
      if (pop === 0) { // everything left was outbound ships
        return { kind: 'dies', period: 0, dx: 0, dy: 0, shed, settledAt: gen, finalPop: 0, gens: gen };
      }
    }

    if (!ensureRoom()) return capped('extent', gen);
    step();
  }
}

/** Classify a census index (see gol-census-core) on the infinite plane. */
export function planeFateOfState(w: number, h: number, state: number, opts?: PlaneFateOptions): PlaneFate {
  const rows = decodeState(w, h, state);
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((rows[y] >>> x) & 1) cells.push([x, y]);
    }
  }
  return planeFateFromCells(cells, opts);
}
