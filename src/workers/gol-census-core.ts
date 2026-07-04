// Game of Life census core — the CPU-optimized enumeration engine.
//
// Pure TypeScript, no DOM/worker APIs: runs identically in a web worker, on
// the main thread (tiny boards, gallery animation), and under Node
// (scripts/census-verify.ts), and is the piece to port server-side when the
// workshop box grows compute.
//
// Board representation: N rows packed one-per-Int32Array element, bit x of
// element y = cell (x, y). A state's census index is Σ rows[y]·2^(y·N) —
// exact in a float64 up to N=7 (49 bits). N=8 would overflow 2^53, which is
// why the engine stops at 7.
//
// The three optimizations, in order of what they buy:
//
//  1. D4 symmetry pruning (~8× fewer simulations). The 8 square symmetries
//     partition the state space into orbits whose members all share one fate.
//     Only the orbit minimum (in index order) is simulated; its outcome is
//     counted with weight 8/|stabilizer|. Rejection tests are lazy row
//     comparisons from the most-significant row, so nearly all non-minima
//     are dismissed in a handful of ops — plus two block-level fast paths
//     (see runChunk) that discard half the space in O(1) per 2^N block.
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

export const MAX_N = 7;
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
  n: number, mask: number,
  src: Int32Array, dst: Int32Array,
  h0: Int32Array, h1: Int32Array, u0: Int32Array, u1: Int32Array,
): void {
  for (let y = 0; y < n; y++) {
    const v = src[y];
    const L = (v << 1) & mask;
    const R = v >>> 1;
    const x = L ^ v;
    h0[y] = x ^ R;
    h1[y] = (L & v) | (x & R);
    u0[y] = L ^ R;
    u1[y] = L & R;
  }
  for (let y = 0; y < n; y++) {
    const a0 = y > 0 ? h0[y - 1] : 0;
    const a1 = y > 0 ? h1[y - 1] : 0;
    const c0 = y < n - 1 ? h0[y + 1] : 0;
    const c1 = y < n - 1 ? h1[y + 1] : 0;
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
export function decodeState(n: number, state: number): number[] {
  const block = 1 << n;
  const rows: number[] = [];
  let r = state;
  for (let y = 0; y < n; y++) {
    rows.push(r % block);
    r = Math.floor(r / block);
  }
  return rows;
}

export function statePopulation(n: number, state: number): number {
  let pop = 0;
  for (const row of decodeState(n, state)) pop += popcount32(row);
  return pop;
}

/** One bounded generation for UI use (gallery animation). Allocates freely. */
export function stepBounded(n: number, rows: number[]): number[] {
  const mask = (1 << n) - 1;
  const src = Int32Array.from(rows);
  const dst = new Int32Array(n);
  const s = () => new Int32Array(n);
  stepRowsCore(n, mask, src, dst, s(), s(), s(), s());
  return [...dst];
}

// ── The engine ────────────────────────────────────────────────────────────

const BRENT_CAP = 1 << 20;

export interface CensusEngine {
  n: number;
  total: number;
  /** Census a slice [start, end) of the index space. start must be a multiple
   *  of 2^n (chunk sizes are; see census-pool). Uses symmetry pruning for n≥2. */
  runChunk(start: number, end: number): ChunkAcc;
  /** Symmetry-free reference path — for n=1 and for verification. */
  runChunkBrute(start: number, end: number): ChunkAcc;
}

export function createCensusEngine(n: number): CensusEngine {
  if (n < 1 || n > MAX_N) throw new Error(`census board must be 1..${MAX_N}, got ${n}`);
  const mask = (1 << n) - 1;
  const block = 1 << n;
  const total = Math.pow(2, n * n);
  const pw: number[] = [];
  for (let y = 0; y < n; y++) pw.push(Math.pow(2, y * n));

  // Bit-reversal (horizontal mirror) lookup for one row.
  const rev = new Int32Array(block);
  for (let v = 0; v < block; v++) {
    let r = 0;
    for (let b = 0; b < n; b++) if (v & (1 << b)) r |= 1 << (n - 1 - b);
    rev[v] = r;
  }

  // Preallocated buffers — the hot loops never allocate.
  const h0 = new Int32Array(n), h1 = new Int32Array(n), u0 = new Int32Array(n), u1 = new Int32Array(n);
  const rows = new Int32Array(n);      // enumeration counter
  const tort = new Int32Array(n);
  const bufA = new Int32Array(n), bufB = new Int32Array(n);
  const trans = new Int32Array(n);     // materialized transpose

  let cycleRef: Int32Array = bufA;     // in-cycle state left by classify()

  const step = (src: Int32Array, dst: Int32Array) =>
    stepRowsCore(n, mask, src, dst, h0, h1, u0, u1);

  function copy(src: Int32Array, dst: Int32Array): void {
    for (let y = 0; y < n; y++) dst[y] = src[y];
  }

  function eq(a: Int32Array, b: Int32Array): boolean {
    for (let y = 0; y < n; y++) if (a[y] !== b[y]) return false;
    return true;
  }

  function encode(a: Int32Array): number {
    let s = 0;
    for (let y = 0; y < n; y++) s += a[y] * pw[y];
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
   * loop already established: rows[0] ≥ rows[n-1] (vertical mirror can't be
   * smaller unless equal-leading) and rev[rows[n-1]] ≥ rows[n-1] (`hDeep`
   * signals equality). Returns 0 when some symmetry image is strictly
   * smaller (skip), else the orbit weight 8/|stabilizer|.
   *
   * All comparisons run lazily from the most-significant row (y = n-1), so a
   * random non-minimum is usually rejected after one or two row compares.
   */
  function canonicalWeight(hDeep: boolean): number {
    const top = rows[n - 1];
    let stab = 1;

    // V — vertical mirror: M[y] = rows[n-1-y]. Leading rows equal iff rows[0] === top.
    if (rows[0] === top) {
      let c = 0;
      for (let y = n - 2; y >= 0; y--) {
        const t = rows[n - 1 - y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }

    // H — horizontal mirror: M[y] = rev[rows[y]]. Leading rows equal iff hDeep.
    if (hDeep) {
      let c = 0;
      for (let y = n - 2; y >= 0; y--) {
        const t = rev[rows[y]], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }

    // HV — 180° rotation: M[y] = rev[rows[n-1-y]]. Leading row is rev[rows[0]].
    {
      const lead = rev[rows[0]];
      if (lead < top) return 0;
      if (lead === top) {
        let c = 0;
        for (let y = n - 2; y >= 0; y--) {
          const t = rev[rows[n - 1 - y]], o = rows[y];
          if (t !== o) { c = t < o ? -1 : 1; break; }
        }
        if (c < 0) return 0;
        if (c === 0) stab++;
      }
    }

    // The transpose coset {T, VT, HT, HVT} — materialize T once, compare lazily.
    for (let x = 0; x < n; x++) {
      let r = 0;
      for (let y = 0; y < n; y++) r |= ((rows[y] >>> x) & 1) << y;
      trans[x] = r;
    }
    { // T
      let c = 0;
      for (let y = n - 1; y >= 0; y--) {
        const t = trans[y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // VT
      let c = 0;
      for (let y = n - 1; y >= 0; y--) {
        const t = trans[n - 1 - y], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // HT
      let c = 0;
      for (let y = n - 1; y >= 0; y--) {
        const t = rev[trans[y]], o = rows[y];
        if (t !== o) { c = t < o ? -1 : 1; break; }
      }
      if (c < 0) return 0;
      if (c === 0) stab++;
    }
    { // HVT
      let c = 0;
      for (let y = n - 1; y >= 0; y--) {
        const t = rev[trans[n - 1 - y]], o = rows[y];
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
    for (let y = 0; y < n; y++) {
      rows[y] = r % block;
      r = Math.floor(r / block);
    }
  }

  /** Advance rows[1..] to the next 2^n block (rows[0] resets to 0). */
  function nextBlock(): void {
    rows[0] = 0;
    for (let y = 1; y < n; y++) {
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
        for (let y = 0; y < n; y++) if (cycleRef[y] !== 0) { zero = false; break; }
        if (zero) {
          acc.dies += weight;
        } else {
          acc.stillLifes += weight;
          if (stills.size < STILL_EXAMPLE_CAP) stills.add(encode(cycleRef));
        }
      } else {
        acc.periods[period] = (acc.periods[period] ?? 0) + weight;
        let popn = 0;
        for (let y = 0; y < n; y++) popn += popcount32(cycleRef[y]);
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
    if (n === 1) return runChunkBrute(start, end);
    if (start % block !== 0) throw new Error('chunk start must be block-aligned');

    const acc = emptyAcc();
    const oscBest = new Map<number, OscExample>();
    const stills = new Set<number>();
    const count = makeCounter(acc, oscBest, stills);

    decodeInto(start);
    let i = start;
    while (i < end) {
      const top = rows[n - 1];
      const rt = rev[top];

      // Block fast path 1: if the mirrored top row is smaller, EVERY state in
      // this block has a smaller H-image — the whole 2^n block is non-minimal.
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
        const w = canonicalWeight(hDeep);
        if (w !== 0) count(w);
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
      // increment rows as a base-2^n counter
      for (let y = 0; y < n; y++) {
        if (++rows[y] <= mask) break;
        rows[y] = 0;
      }
    }
    return finalize(acc, oscBest, stills);
  }

  return { n, total, runChunk, runChunkBrute };
}
