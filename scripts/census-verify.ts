// Census engine verification + benchmark.
//
//   npx tsx scripts/census-verify.ts          # verify squares + rectangles, bench 5×5
//   npx tsx scripts/census-verify.ts --full   # also cross-check 5×5 sym vs brute (slow)
//
// Checks, in order of strength:
//  1. Known ground truth (results of the original per-cell engine, which ran
//     every state with no symmetry tricks) for 2×2..4×4, including the exact
//     period histogram for 4×4.
//  2. Symmetry-pruned path === brute path, count for count, on every size —
//     this is the check that the orbit logic (D4 on squares, Klein group on
//     rectangles) is airtight.
//  3. Transpose agreement: W×H and H×W are computed independently, but the
//     transpose bijection commutes with the Life rule, so their censuses
//     must match exactly.
//  4. Conservation: dies + stills + oscillators + unresolved === 2^(w·h).
// Then measures single-core throughput on a full 5×5 run (the pool multiplies
// this by ~core count).

import { createCensusEngine, type ChunkAcc } from '../src/workers/gol-census-core';

let failures = 0;

function check(label: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${label}: ${got.toLocaleString()}${ok ? '' : ` (want ${want.toLocaleString()})`}`);
}

function oscTotal(acc: ChunkAcc): number {
  return Object.values(acc.periods).reduce((a, b) => a + b, 0);
}

function conservation(w: number, h: number, acc: ChunkAcc) {
  check('conservation', acc.dies + acc.stillLifes + oscTotal(acc) + acc.unresolved, Math.pow(2, w * h));
}

function compare(labelA: string, a: ChunkAcc, labelB: string, b: ChunkAcc) {
  check(`${labelA} dies === ${labelB}`, a.dies, b.dies);
  check(`${labelA} stills === ${labelB}`, a.stillLifes, b.stillLifes);
  check(`${labelA} unresolved === ${labelB}`, a.unresolved, b.unresolved);
  const periods = new Set([...Object.keys(a.periods), ...Object.keys(b.periods)]);
  for (const p of [...periods].sort((x, y) => +x - +y)) {
    check(`${labelA} p${p} === ${labelB}`, a.periods[+p] ?? 0, b.periods[+p] ?? 0);
  }
}

function runFull(w: number, h: number): ChunkAcc {
  const eng = createCensusEngine(w, h);
  return eng.runChunk(0, eng.total);
}

// ── Squares: ground truth from the original exhaustive engine ─────────────

const KNOWN: Record<number, { dies: number; stills: number; periods: Record<number, number> }> = {
  2: { dies: 11, stills: 5, periods: {} },
  3: { dies: 362, stills: 148, periods: { 2: 2 } },
  4: { dies: 33708, stills: 29268, periods: { 2: 2512, 3: 48 } },
};

for (const n of [2, 3, 4]) {
  console.log(`\n${n}×${n} (${Math.pow(2, n * n).toLocaleString()} states)`);
  const eng = createCensusEngine(n, n);
  const sym = eng.runChunk(0, eng.total);
  const brute = eng.runChunkBrute(0, eng.total);
  const known = KNOWN[n];
  check('dies', sym.dies, known.dies);
  check('still lifes', sym.stillLifes, known.stills);
  check('oscillators', oscTotal(sym), Object.values(known.periods).reduce((a, b) => a + b, 0));
  for (const [p, c] of Object.entries(known.periods)) check(`period ${p}`, sym.periods[+p] ?? 0, c);
  compare('sym', sym, 'brute', brute);
  conservation(n, n, sym);
}

// ── Rectangles: sym vs brute + transpose agreement ─────────────────────────

const RECT_PAIRS: [number, number][] = [
  [1, 2], [1, 7], [2, 3], [2, 5], [3, 4], [3, 6], [4, 5], [2, 7],
];

for (const [w, h] of RECT_PAIRS) {
  console.log(`\n${w}×${h} vs ${h}×${w} (${Math.pow(2, w * h).toLocaleString()} states each)`);
  const engA = createCensusEngine(w, h);
  const symA = engA.runChunk(0, engA.total);
  const bruteA = engA.runChunkBrute(0, engA.total);
  compare('sym', symA, 'brute', bruteA);
  conservation(w, h, symA);
  const symB = runFull(h, w);
  compare(`${w}×${h}`, symA, `${h}×${w} (transpose)`, symB);
  conservation(h, w, symB);
}

// ── 5×5: single-core benchmark on the real workload ────────────────────────

{
  const eng = createCensusEngine(5, 5);
  console.log(`\n5×5 (${eng.total.toLocaleString()} states) — single-core benchmark`);
  const t0 = performance.now();
  const sym = eng.runChunk(0, eng.total);
  const symMs = performance.now() - t0;
  conservation(5, 5, sym);
  check('dies (v1 engine agreed)', sym.dies, 20768679);
  check('still lifes', sym.stillLifes, 9697206);
  console.log(`  sym:   ${symMs.toFixed(0)}ms → ${Math.round(eng.total / (symMs / 1000)).toLocaleString()} states/s/core`);
  console.log(`  top periods: ${sym.oscExamples.slice(0, 5).map(e => `p${e.period}`).join(' ')}`);

  if (process.argv.includes('--full')) {
    const t1 = performance.now();
    const brute = eng.runChunkBrute(0, eng.total);
    const bruteMs = performance.now() - t1;
    console.log(`  brute: ${bruteMs.toFixed(0)}ms → ${Math.round(eng.total / (bruteMs / 1000)).toLocaleString()} states/s/core (${(bruteMs / symMs).toFixed(1)}× slower)`);
    compare('sym', sym, 'brute', brute);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
