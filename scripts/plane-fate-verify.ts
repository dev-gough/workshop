// Verification harness for the plane-fate classifier (gol-plane-fate.ts).
//
// Checks the classifier against patterns whose infinite-plane fate is
// documented Life folklore: still lifes, small oscillators, the standard
// spaceships, and the two famous methuselahs that fit in a 7×7 box
// (R-pentomino: 6 gliders, settles by gen 1103; acorn: 13 gliders, gen 5206).
//
//   npx tsx scripts/plane-fate-verify.ts          # fast set (~1s)
//   npx tsx scripts/plane-fate-verify.ts --full   # + acorn (a few seconds)

import {
  planeFateFromCells,
  parseCells,
  type PlaneFate,
} from '../src/workers/gol-plane-fate';

const full = process.argv.includes('--full');

let failures = 0;

function check(name: string, fate: PlaneFate, expect: Partial<PlaneFate> & {
  gliders?: number; settledBy?: number;
}): void {
  const problems: string[] = [];
  if (expect.kind !== undefined && fate.kind !== expect.kind) {
    problems.push(`kind ${fate.kind} ≠ ${expect.kind}`);
  }
  if (expect.period !== undefined && fate.period !== expect.period) {
    problems.push(`period ${fate.period} ≠ ${expect.period}`);
  }
  if (expect.gliders !== undefined && fate.shed.glider !== expect.gliders) {
    problems.push(`gliders ${fate.shed.glider} ≠ ${expect.gliders}`);
  }
  if (expect.settledAt !== undefined && fate.settledAt !== expect.settledAt) {
    problems.push(`settledAt ${fate.settledAt} ≠ ${expect.settledAt}`);
  }
  if (expect.settledBy !== undefined && fate.settledAt > expect.settledBy) {
    problems.push(`settledAt ${fate.settledAt} > ${expect.settledBy}`);
  }
  if (expect.finalPop !== undefined && fate.finalPop !== expect.finalPop) {
    problems.push(`finalPop ${fate.finalPop} ≠ ${expect.finalPop}`);
  }
  const summary = `${fate.kind}${fate.period ? ` p${fate.period}` : ''}` +
    (fate.dx || fate.dy ? ` Δ(${fate.dx},${fate.dy})` : '') +
    (fate.shed.glider ? ` +${fate.shed.glider} gliders` : '') +
    (fate.shed.lwss + fate.shed.mwss + fate.shed.hwss > 0 ? ' +ships' : '') +
    ` settled@${fate.settledAt} pop=${fate.finalPop} gens=${fate.gens}`;
  if (problems.length === 0) {
    console.log(`  ok   ${name.padEnd(28)} ${summary}`);
  } else {
    failures++;
    console.error(`  FAIL ${name.padEnd(28)} ${summary}\n       ${problems.join('; ')}`);
  }
}

const run = (rows: string[]) => planeFateFromCells(parseCells(rows));

console.log('plane-fate-verify: known fates on the infinite plane\n');

// ── Trivia ──
check('empty', planeFateFromCells([]), { kind: 'dies', settledAt: 0 });
check('single cell', run(['O']), { kind: 'dies' });
check('domino', run(['OO']), { kind: 'dies' });

// ── Still lifes: the seed itself must be a fixed point (settledAt 0) ──
check('block', run(['OO', 'OO']), { kind: 'still', period: 1, settledAt: 0, finalPop: 4 });
check('beehive', run(['.OO.', 'O..O', '.OO.']), { kind: 'still', settledAt: 0, finalPop: 6 });
check('loaf', run(['.OO.', 'O..O', '.O.O', '..O.']), { kind: 'still', settledAt: 0, finalPop: 7 });
check('tub', run(['.O.', 'O.O', '.O.']), { kind: 'still', settledAt: 0, finalPop: 4 });

// ── Oscillators: seed in-cycle → settledAt 0 and the textbook period ──
check('blinker', run(['OOO']), { kind: 'oscillator', period: 2, settledAt: 0, finalPop: 3 });
check('toad', run(['.OOO', 'OOO.']), { kind: 'oscillator', period: 2, settledAt: 0 });
check('beacon', run(['OO..', 'O...', '...O', '..OO']), { kind: 'oscillator', period: 2, settledAt: 0 });
check('pulsar', run([
  '..OOO...OOO..',
  '.............',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '..OOO...OOO..',
  '.............',
  '..OOO...OOO..',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '.............',
  '..OOO...OOO..',
]), { kind: 'oscillator', period: 3, settledAt: 0, finalPop: 48 });
// A row of 10 cells famously evolves INTO the pentadecathlon (p15).
check('10-cell row → PD', run(['OOOOOOOOOO']), { kind: 'oscillator', period: 15 });

// ── Spaceships: whole-pattern recurrence with displacement ──
check('glider', run(['.O.', '..O', 'OOO']), { kind: 'ship', period: 4, settledAt: 0 });
check('lwss', run(['.O..O', 'O....', 'O...O', 'OOOO.']), { kind: 'ship', period: 4, settledAt: 0 });
check('mwss', run(['...O..', '.O...O', 'O.....', 'O....O', 'OOOOO.']), { kind: 'ship', period: 4, settledAt: 0 });
check('hwss', run(['...OO..', '.O....O', 'O......', 'O.....O', 'OOOOOO.']), { kind: 'ship', period: 4, settledAt: 0 });

{ // Glider displacement must be one diagonal step per period.
  const g = run(['.O.', '..O', 'OOO']);
  if (Math.abs(g.dx) !== 1 || Math.abs(g.dy) !== 1) {
    failures++;
    console.error(`  FAIL glider displacement          Δ(${g.dx},${g.dy}) expected |1|,|1|`);
  } else {
    console.log(`  ok   glider displacement          Δ(${g.dx},${g.dy})`);
  }
}

// ── Ash + escapes: gliders must be stripped, residue cycle detected ──
// Blinker placed BEHIND the outbound glider (it heads +x,+y away from it).
check('glider + far blinker', planeFateFromCells([
  ...parseCells(['.O.', '..O', 'OOO']),
  ...parseCells(['OOO']).map(([x, y]) => [x - 40, y - 40] as [number, number]),
]), { kind: 'oscillator', period: 2, gliders: 1, finalPop: 3 });

// Inbound ship must NOT be stripped: this glider flies INTO the blinker and
// the collision wipes both out. Strip-happy logic would report an oscillator.
check('glider vs blinker collision', planeFateFromCells([
  ...parseCells(['.O.', '..O', 'OOO']),
  ...parseCells(['OOO']).map(([x, y]) => [x + 40, y + 40] as [number, number]),
]), { kind: 'dies', gliders: 0 });

// R-pentomino: stabilizes at gen 1103 having emitted 6 gliders; the ash
// contains blinkers, so the residue oscillates with period 2. Stripping lags
// physical escape (gap + sweep cadence), hence "settled by" with headroom.
check('R-pentomino', run(['.OO', 'OO.', '.O.']), {
  kind: 'oscillator', period: 2, gliders: 6, settledBy: 1400,
});

if (full) {
  // Acorn: the classic 7×3 methuselah — 13 gliders, stabilizes at gen 5206.
  check('acorn', run(['.O.....', '...O...', 'OO..OOO']), {
    kind: 'oscillator', period: 2, gliders: 13, settledBy: 5600,
  });
} else {
  console.log('  (acorn skipped — pass --full)');
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
