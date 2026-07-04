// Game of Life census core — the CPU-optimized enumeration engine.
//
// Pure TypeScript, no DOM/worker APIs: runs identically in a web worker, on
// the main thread (small boards, gallery animation), and under Node
// (scripts/census-verify.ts), and is the piece to port server-side when the
// workshop box grows compute.
//
// Board representation: H rows packed one-per-Int32Array element, bit x of
// element y = cell (x, y), rows W bits wide. A state's census index is
// Σ rows[y]·2^(y·W) — exact in a float64 up to W·H = 49 bits (7×7). Going
// past that (8×8 = 2^64) needs two-word indices, not just faster hardware.
//
// W×H and H×W are distinct boards computed independently; the transpose
// bijection commutes with the Life rule, so their censuses must agree —
// scripts/census-verify.ts uses that as a cross-check.
//
// The three optimizations, in order of what they buy:
//
//  1. Symmetry pruning (~8× fewer simulations on squares, ~4× on
//     rectangles). The board's symmetry group — D4 for W=H, the Klein group
//     {I, flipH, flipV, 180°} otherwise — partitions the state space into
//     orbits whose members all share one fate. Only the orbit minimum (in
//     index order) is simulated; its outcome is counted with weight
//     |group|/|stabilizer|. Rejection tests are lazy row comparisons from
//     the most-significant row, plus two block-level fast paths (see
//     runChunk) that discard half the space in O(1) per 2^W block.
//
//  2. Bit-parallel stepping (~10× over per-cell popcounts). One generation
//     is ~28 bitwise ops per row via carry-save adders: 2-bit horizontal
//     sums per row, then a full-adder tree across the three neighbouring
//     rows. No per-cell loop, no branches.
//
//  3. Brent cycle detection (no allocation). Replaces the old Map<state,gen>
//     which allocated and hashed every generation. Finds the cycle length λ
//     and lands on an in-cycle state, which is exactly what classification
//     needs: λ=1 & state=0 → dies, λ=1 → still life, λ>1 → oscillator(λ).

export interface OscExample {
  period: number;
  state: number;      // census index of an in-cycle state (exact ≤ 2^49)
  population: number;
}

/** Accumulated outcome counts for a slice of the state space. */
export interface ChunkAcc {
  dies: number;
  stillLifes: number;
  unresolved: number;               // Brent cap tripped (never expected; kept honest)
  periods: Record<number, number>;  // period(≥2) → count
  oscExamples: OscExample[];        // best example per period
  stillLifeExamples: number[];      // distinct still-life states, ≤ 12
}

export const MAX_AXIS = 7;          // heatmap is 7×7; also keeps W·H ≤ 49 < 53 bits
export const STILL_EXAMPLE_CAP = 12;

export function emptyAcc(): ChunkAcc {
  return { dies: 0, stillLifes: 0, unresolved: 0, periods: {}, oscExamples: [], stillLifeExamples: [] };
}

/** Merge a chunk's accumulators into a running total (coordinator side). */
export function mergeAcc(into: ChunkAcc, from: ChunkAcc): void {
  into.dies += from.dies;
  into.stillLifes += from.stillLifes;
  into.unresolved += from.unresolved;
  for (const [p, c] of Object.entries(from.periods)) {
    into.periods[+p] = (into.periods[+p] ?? 0) + c;
  }
  const best = new Map<number, OscExample>();
  for (const ex of into.oscExamples) best.set(ex.period, ex);
  for (const ex of from.oscExamples) {
    const cur = best.get(ex.period);
    if (!cur || ex.population > cur.population) best.set(ex.period, ex);
  }
  into.oscExamples = [...best.values()].sort((a, b) => b.period - a.period);
  const stills = new Set(into.stillLifeExamples);
  for (const s of from.stillLifeExamples) {
    if (stills.size >= STILL_EXAMPLE_CAP) break;
    stills.add(s);
  }
  into.stillLifeExamples = [...stills];
}

// ── Shared bit helpers ────────────────────────────────────────────────────

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * One bounded-Life generation, bit-parallel across each row.
 *
 * Per row v we precompute 2-bit horizontal sums with carry-save adders:
 *   h(v) = left + centre + right   (for the rows above/below)
 *   u(v) = left + right            (for the row itself — centre excluded)
 * then sum the three 2-bit numbers per row with a full-adder tree, giving
 * ones/twos plus a "≥4" flag, and apply B3/S23:
 *   next = twos & ~fours & (ones | current)
 * (count 3 → ones=1,twos=1 → birth; count 2 → twos=1,ones=0 → survival.)
 *
 * Scratch arrays are caller-supplied so the hot path never allocates.
 */
function stepRowsCore(
  h: number, mask: number,
  src: Int32Array, dst: Int32Array,
  h0: Int32Array, h1: Int32Array, u0: Int32Array, u1: Int32Array,
): void {
  for (let y = 0; y < h; y++) {
    const v = src[y];
    const L = (v << 1) & mask;
    const R = v >>> 1;
    const x = L ^ v;
    h0[y] = x ^ R;
    h1[y] = (L & v) | (x & R);
    u0[y] = L ^ R;
    u1[y] = L & R;
  }
  for (let y = 0; y < h; y++) {
    const a0 = y > 0 ? h0[y - 1] : 0;
    const a1 = y > 0 ? h1[y - 1] : 0;
    const c0 = y < h - 1 ? h0[y + 1] : 0;
    const c1 = y < h - 1 ? h1[y + 1] : 0;
    const b0 = u0[y];
    const b1 = u1[y];
    const t = a0 ^ b0;
    const ones = t ^ c0;
    const car = (a0 & b0) | (t & c0);
    const t2 = a1 ^ b1;
    const s2 = t2 ^ c1;
    const c2a = (a1 & b1) | (t2 & c1);
    const twos = s2 ^ car;
    const c2b = s2 & car;
    const fours = c2a | c2b;
    dst[y] = twos & ~fours & (ones | src[y]) & mask;
  }
}

// ── State index ⇄ rows ───────────────────────────────────────────────────

/** Decode a census index (exact float64 integer) into row bitmasks. */
export function decodeState(w: number, h: number, state: number): number[] {
  const block = Math.pow(2, w);
  const rows: number[] = [];
  let r = state;
  for (let y = 0; y < h; y++) {
    rows.push(r % block);
    r = Math.floor(r / block);
  }
  return rows;
}

export function statePopulation(w: number, h: number, state: number): number {
  let pop = 0;
  for (const row of decodeState(w, h, state)) pop += popcount32(row);
  return pop;
}

/** One bounded generation for UI use (gallery animation). Allocates freely. */
export function stepBounded(w: number, h: number, rows: number[]): number[] {
  const mask = (1 << w) - 1;
  const src = Int32Array.from(rows);
  const dst = new Int32Array(h);
  const s = () => new Int32Array(h);
  stepRowsCore(h, mask, src, dst, s(), s(), s(), s());
  return [...dst];
}

// ── The engine ────────────────────────────────────────────────────────────

const BRENT_CAP = 1 << 20;

export interface CensusEngine {
  w: number;
  h: number;
  total: number;
  /** Census a slice [start, end) of the index space. start must be a multiple
   *  of 2^w (chunk sizes are; see census-pool). Uses symmetry pruning. */
  runChunk(start: number, end: number): ChunkAcc;
  /** Symmetry-free reference path — for single-row boards and verification. */
  runChunkBrute(start: number, end: number): ChunkAcc;
}

export function createCensusEngine(w: number, h: number): CensusEngine {
  if (w < 1 || w > MAX_AXIS || h < 1 || h > MAX_AXIS) {
    throw new Error(`census board axes must be 1..${MAX_AXIS}, got ${w}×${h}`);
  }
  const mask = (1 << w) - 1;
  const block = 1 << w;
  const total = Math.pow(2, w * h);
  const square = w === h;
  const groupSize = square ? 8 : 4;
  const pw: number[] = [];
  for (let y = 0; y < h; y++) pw.push(Math.pow(2, y * w));

  // Bit-reversal (horizontal mirror) lookup for one row.
  const rev = new Int32Array(block);
  for (let v = 0; v < block; v++) {
    let r = 0;
    for (let b = 0; b < w; b++) if (v & (1 << b)) r |= 1 << (w - 1 - b);
    rev[v] = r;
  }

  // Preallocated buffers — the hot loops never allocate.
  const h0 = new Int32Array(h), h1 = new Int32Array(h), u0 = new Int32Array(h), u1 = new Int32Array(h);
  const rows = new Int32Array(h);      // enumeration counter
  const tort = new Int32Array(h);
  const bufA = new Int32Array(h), bufB = new Int32Array(h);
  const trans = new Int32Array(h);     // materialized transpose (square boards)

  let cycleRef: Int32Array = bufA;     // in-cycle state left by classify()

  const step = (src: Int32Array, dst: Int32Array) =>
    stepRowsCore(h, mask, src, dst, h0, h1, u0, u1);

  function copy(src: Int32Array, dst: Int32Array): void {
    for (let y = 0; y < h; y++) dst[y] = src[y];
  }

  function eq(a: Int32Array, b: Int32Array): boolean {
    for (let y = 0; y < h; y++) if (a[y] !== b[y]) return false;
    return true;
  }

  function encode(a: Int32Array): number {
    let s = 0;
    for (let y = 0; y < h; y++) s += a[y] * pw[y];
    return s;
  }

  /**
   * Brent's cycle detection from the state in `rows`. Returns the cycle
   * length λ (0 if the safety cap tripped) and leaves an in-cycle state in
   * `cycleRef`. Constant memory, ~μ+2λ steps, no per-step allocation.
   */
  function classify(): number {
    copy(rows, tort);
    step(tort, bufA);
    let hare = bufA;
    let spare = bufB;
    let power = 1;
    let lam = 1;
    let guard = BRENT_CAP;
    while (!eq(tort, hare)) {
      if (power === lam) {
        copy(hare, tort);
        power += power;
        lam = 0;
      }
      step(hare, spare);
      const t = hare; hare = spare; spare = t;
      lam++;
      if (--guard === 0) return 0;
    }
    cycleRef = hare;
    return lam;
  }

  /**
   * Orbit-minimum test for the state in `rows`, given the two facts the block
   * loop already established: rows[0] ≥ rows[h-1] (vertical mirror can't be
   * smaller unless equal-leading) and rev[rows[h-1]] ≥ rows[h-1] (`hDeep`
   * signals equality). Returns 0 when some symmetry image is strictly
   * smaller (skip), else the orbit weight |group|/|stabilizer|. The
   * transpose coset only exists on square boards.
   *
   * All comparisons run lazily from the most-significant row (y = h-1), so a
   * random non-minimum is usually rejected after one or two row compares.
   */
  function canonicalWeight(hDeep: boolean): number {
    const top = rows[h - 1];
    let stab = 1;

    // V — vertical mirror: M[y] = rows[h-1-y]. Leading rows equal iff rows[0] === top.
    if (rows[0] === top) {
      let c = 0;
      for (let y = h - 2; y >= 0; y--) {
        const t = rows[h - 1 - y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }

    // H — horizontal mirror: M[y] = rev[rows[y]]. Leading rows equal iff hDeep.
    if (hDeep) {
      let c = 0;
      for (let y = h - 2; y >= 0; y--) {
        const t = rev[rows[y]], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }

    // HV — 180° rotation: M[y] = rev[rows[h-1-y]]. Leading row is rev[rows[0]].
    {
      const lead = rev[rows[0]];
      if (lead < top) return 0;
      if (lead === top) {
        let c = 0;
        for (let y = h - 2; y >= 0; y--) {
          const t = rev[rows[h - 1 - y]], o = rows[y];
          if (t !== o) { c = t < o ? -1 : 1; break; }
        }
        if (c < 0) return 0;
        if (c === 0) stab++;
      }
    }

    if (!square) return 4 / stab;

    // The transpose coset {T, VT, HT, HVT} — materialize T once, compare lazily.
    for (let x = 0; x < h; x++) {
      let r = 0;
      for (let y = 0; y < h; y++) r |= ((rows[y] >>> x) & 1) << y;
      trans[x] = r;
    }
    { // T
      let c = 0;
      for (let y = h - 1; y >= 0; y--) {
        const t = trans[y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // VT
      let c = 0;
      for (let y = h - 1; y >= 0; y--) {
        const t = trans[h - 1 - y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // HT
      let c = 0;
      for (let y = h - 1; y >= 0; y--) {
        const t = rev[trans[y]], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // HVT
      let c = 0;
      for (let y = h - 1; y >= 0; y--) {
        const t = rev[trans[h - 1 - y]], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }

    // stab is a subgroup order of D4 → 1, 2, 4 or 8.
    return 8 / stab;
  }

  function decodeInto(state: number): void {
    let r = state;
    for (let y = 0; y < h; y++) {
      rows[y] = r % block;
      r = Math.floor(r / block);
    }
  }

  /** Advance rows[1..] to the next 2^w block (rows[0] resets to 0). */
  function nextBlock(): void {
    rows[0] = 0;
    for (let y = 1; y < h; y++) {
      if (++rows[y] <= mask) return;
      rows[y] = 0;
    }
  }

  function makeCounter(acc: ChunkAcc, oscBest: Map<number, OscExample>, stills: Set<number>) {
    return (weight: number): void => {
      const period = classify();
      if (period === 0) {
        acc.unresolved += weight;
      } else if (period === 1) {
        let zero = true;
        for (let y = 0; y < h; y++) if (cycleRef[y] !== 0) { zero = false; break; }
        if (zero) {
          acc.dies += weight;
        } else {
          acc.stillLifes += weight;
          if (stills.size < STILL_EXAMPLE_CAP) stills.add(encode(cycleRef));
        }
      } else {
        acc.periods[period] = (acc.periods[period] ?? 0) + weight;
        let popn = 0;
        for (let y = 0; y < h; y++) popn += popcount32(cycleRef[y]);
        const cur = oscBest.get(period);
        if (!cur || popn > cur.population) {
          oscBest.set(period, { period, state: encode(cycleRef), population: popn });
        }
      }
    };
  }

  function finalize(acc: ChunkAcc, oscBest: Map<number, OscExample>, stills: Set<number>): ChunkAcc {
    acc.oscExamples = [...oscBest.values()].sort((a, b) => b.period - a.period);
    acc.stillLifeExamples = [...stills];
    return acc;
  }

  function runChunk(start: number, end: number): ChunkAcc {
    // Single-row boards: rows[0] is both the inner counter and the "top" row,
    // so the block structure below degenerates — brute is instant at ≤2^7.
    if (h === 1) return runChunkBrute(start, end);
    if (start % block !== 0) throw new Error('chunk start must be block-aligned');

    const acc = emptyAcc();
    const oscBest = new Map<number, OscExample>();
    const stills = new Set<number>();
    const count = makeCounter(acc, oscBest, stills);

    decodeInto(start);
    let i = start;
    while (i < end) {
      const top = rows[h - 1];
      const rt = rev[top];

      // Block fast path 1: if the mirrored top row is smaller, EVERY state in
      // this block has a smaller H-image — the whole 2^w block is non-minimal.
      if (rt < top) {
        i += block;
        nextBlock();
        continue;
      }
      const hDeep = rt === top;

      // Block fast path 2: states with rows[0] < top have a smaller V-image;
      // skip straight to rows[0] = top.
      i += top;
      for (let j = top; j < block; j++, i++) {
        rows[0] = j;
        const weight = canonicalWeight(hDeep);
        if (weight !== 0) count(weight);
      }
      nextBlock();
    }
    return finalize(acc, oscBest, stills);
  }

  function runChunkBrute(start: number, end: number): ChunkAcc {
    const acc = emptyAcc();
    const oscBest = new Map<number, OscExample>();
    const stills = new Set<number>();
    const count = makeCounter(acc, oscBest, stills);

    decodeInto(start);
    for (let i = start; i < end; i++) {
      count(1);
      // increment rows as a base-2^w counter
      for (let y = 0; y < h; y++) {
        if (++rows[y] <= mask) break;
        rows[y] = 0;
      }
    }
    return finalize(acc, oscBest, stills);
  }

  return { w, h, total, runChunk, runChunkBrute };
}
