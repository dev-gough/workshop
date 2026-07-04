// Census engine verification + benchmark.
//
//   npx tsx scripts/census-verify.ts          # verify 2×2..4×4 + bench 5×5
//   npx tsx scripts/census-verify.ts --full   # also cross-check 5×5 sym vs brute (slow)
//
// Checks, in order of strength:
//  1. Known ground truth (results of the original per-cell engine, which ran
//     every state with no symmetry tricks) for 2×2..4×4, including the exact
//     period histogram for 4×4.
//  2. Symmetry-pruned path === brute path, count for count, on every size —
//     this is the check that the D4 orbit logic is airtight.
//  3. Conservation: dies + stills + oscillators + unresolved === 2^(n²).
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

function conservation(n: number, acc: ChunkAcc) {
  check('conservation', acc.dies + acc.stillLifes + oscTotal(acc) + acc.unresolved, Math.pow(2, n * n));
}

function compare(n: number, sym: ChunkAcc, brute: ChunkAcc) {
  check('sym dies === brute dies', sym.dies, brute.dies);
  check('sym stills === brute stills', sym.stillLifes, brute.stillLifes);
  check('sym unresolved === brute', sym.unresolved, brute.unresolved);
  const periods = new Set([...Object.keys(sym.periods), ...Object.keys(brute.periods)]);
  for (const p of [...periods].sort((a, b) => +a - +b)) {
    check(`sym p${p} === brute p${p}`, sym.periods[+p] ?? 0, brute.periods[+p] ?? 0);
  }
}

// Ground truth from the original exhaustive engine (no symmetry, per-cell).
const KNOWN: Record<number, { dies: number; stills: number; periods: Record<number, number> }> = {
  2: { dies: 11, stills: 5, periods: {} },
  3: { dies: 362, stills: 148, periods: { 2: 2 } },
  4: { dies: 33708, stills: 29268, periods: { 2: 2512, 3: 48 } },
};

for (const n of [2, 3, 4]) {
  console.log(`\n${n}×${n} (${Math.pow(2, n * n).toLocaleString()} states)`);
  const eng = createCensusEngine(n);
  const sym = eng.runChunk(0, eng.total);
  const brute = eng.runChunkBrute(0, eng.total);
  const known = KNOWN[n];
  check('dies', sym.dies, known.dies);
  check('still lifes', sym.stillLifes, known.stills);
  check('oscillators', oscTotal(sym), Object.values(known.periods).reduce((a, b) => a + b, 0));
  for (const [p, c] of Object.entries(known.periods)) check(`period ${p}`, sym.periods[+p] ?? 0, c);
  compare(n, sym, brute);
  conservation(n, sym);
}

// 5×5: single-core benchmark on the real workload.
{
  const n = 5;
  const eng = createCensusEngine(n);
  console.log(`\n5×5 (${eng.total.toLocaleString()} states) — single-core benchmark`);
  const t0 = performance.now();
  const sym = eng.runChunk(0, eng.total);
  const symMs = performance.now() - t0;
  conservation(n, sym);
  console.log(`  sym:   ${symMs.toFixed(0)}ms → ${Math.round(eng.total / (symMs / 1000)).toLocaleString()} states/s/core`);
  console.log(`  top periods: ${sym.oscExamples.slice(0, 5).map(e => `p${e.period}`).join(' ')}`);

  if (process.argv.includes('--full')) {
    const t1 = performance.now();
    const brute = eng.runChunkBrute(0, eng.total);
    const bruteMs = performance.now() - t1;
    console.log(`  brute: ${bruteMs.toFixed(0)}ms → ${Math.round(eng.total / (bruteMs / 1000)).toLocaleString()} states/s/core (${(bruteMs / symMs).toFixed(1)}× slower)`);
    compare(n, sym, brute);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
