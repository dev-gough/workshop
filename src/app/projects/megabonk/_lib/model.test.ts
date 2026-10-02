import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, critFactor, defaultBuild, type Build } from './model';
import { applyLiveSnapshot, formatStat, sourceShares, statRows } from './live';

function bare(): Build {
  return defaultBuild();
}

test('crit curve matches the datamined multipliers at ×2 crit damage', () => {
  assert.equal(critFactor(0, 2), 1);
  assert.equal(critFactor(100, 2), 2);
  assert.equal(critFactor(200, 2), 4);
  assert.equal(critFactor(300, 2), 6.25);
  assert.equal(critFactor(400, 2), 9);
  assert.equal(critFactor(50, 2), 1.5);
});

test('a higher crit-damage stat scales the crit, not the non-crit', () => {
  assert.equal(critFactor(0, 4), 1);
  assert.equal(critFactor(100, 4), 4);
  assert.equal(critFactor(200, 4), 8);
});

test('a bare build is exactly one hit', () => {
  const a = analyze(bare());
  assert.equal(a.total, 1);
  assert.equal(a.leaves.length, 0);
});

test('beer and gym sauce add into one Power stat', () => {
  const build = bare();
  build.items.beer = { on: true, stacks: 2 };
  build.items['gym-sauce'] = { on: true, stacks: 1 };
  const a = analyze(build);
  assert.ok(Math.abs(a.total - 1.5) < 1e-9);
  assert.equal(a.brackets.filter(b => b.id === 'power').length, 1);
});

test('scarf is zero on the ground and +50% per copy in the air', () => {
  const build = bare();
  build.items.scarf = { on: true, stacks: 2 };
  assert.equal(analyze(build).total, 1);
  assert.ok(Math.abs(analyze({ ...build, airborne: true }).total - 2) < 1e-9);
});

test('gamer goggles follow the under-half formula', () => {
  const build = bare();
  build.items['gamer-goggles'] = { on: true, stacks: 1 };
  build.hpPercent = 100;
  assert.equal(analyze(build).total, 1);
  build.hpPercent = 25;
  assert.ok(Math.abs(analyze(build).total - 1.5) < 1e-9);
});

test('beefy ring uses max HP × 0.002 × copies', () => {
  const build = bare();
  build.items['beefy-ring'] = { on: true, stacks: 3 };
  build.maxHp = 130;
  assert.ok(Math.abs(analyze(build).total - 1.78) < 1e-9);
});

test('eagle claw and tactical glasses add, then multiply Power', () => {
  const build = bare();
  build.items.beer = { on: true, stacks: 1 };
  build.items['eagle-claw'] = { on: true, stacks: 1 };
  build.items['tactical-glasses'] = { on: true, stacks: 1 };
  build.enemyAirborne = true;
  build.enemyHighHp = true;
  const a = analyze(build);
  assert.ok(Math.abs(a.total - 1.2 * 1.86) < 1e-9);
});

test('brass knuckles multiply Power while in range', () => {
  const build = bare();
  build.items.beer = { on: true, stacks: 1 };
  build.items['brass-knuckles'] = { on: true, stacks: 1 };
  assert.equal(analyze(build).total, 1.2);
  assert.ok(Math.abs(analyze({ ...build, inMelee: true }).total - 1.5) < 1e-9);
});

test('phantom shroud multiplies only the post-evade hit', () => {
  const build = bare();
  build.items['phantom-shroud'] = { on: true, stacks: 2 };
  assert.equal(analyze(build).total, 1);
  assert.ok(Math.abs(analyze({ ...build, evadeHit: true }).total - 2.5) < 1e-9);
});

test('one giant fork uses the megacrit curve on top of its crit chance', () => {
  const build = bare();
  build.items['giant-fork'] = { on: true, stacks: 1 };
  const a = analyze(build);
  const expectedCrit = critFactor(15, 2);
  const expectedMega = 1 + 0.15 * 0.14 * 3;
  assert.ok(Math.abs(a.total - expectedCrit * expectedMega) < 1e-9);
});

test('bonker is the expected extra hit, from stacks', () => {
  const build = bare();
  build.items.bonker = { on: true, stacks: 1 };
  assert.ok(Math.abs(analyze(build).total - 1.4) < 1e-9);
  build.items.bonker.stacks = 2;
  assert.ok(Math.abs(analyze(build).total - (1 + 0.035 * 30)) < 1e-9);
});

test('speed boi is ×2 only during the slow, regardless of copies', () => {
  const build = bare();
  build.items['speed-boi'] = { on: true, stacks: 4 };
  assert.equal(analyze(build).total, 1);
  assert.equal(analyze({ ...build, timeSlow: true }).total, 2);
});

test("joe's dagger is +1% per execute per copy", () => {
  const build = bare();
  build.items['joes-dagger'] = { on: true, stacks: 2 };
  build.joeExecutes = 10;
  assert.ok(Math.abs(analyze(build).total - 1.2) < 1e-9);
});

test('idle juice waits 0.6s, then adds 0.04 per second up to the cap', () => {
  const build = bare();
  build.items['idle-juice'] = { on: true, stacks: 1 };
  build.idleSeconds = 0.6;
  assert.equal(analyze(build).total, 1);
  build.idleSeconds = 1.6;
  assert.ok(Math.abs(analyze(build).total - 1.04) < 1e-9);
  build.idleSeconds = 100;
  assert.ok(Math.abs(analyze(build).total - 2) < 1e-9);
});

test('live stats land on the sliders as percents and displayed crit damage', () => {
  const next = applyLiveSnapshot(defaultBuild(), {
    v: 1,
    t: 1,
    inRun: true,
    stats: {
      critChance: 0.4,
      critDamage: 1,
      attackSpeed: 0.6,
      eliteDamage: 1.15,
      poisonDamage: 1.5,
      damageMultiplier: 3.2,
    },
  });
  assert.equal(next.critChance, 40);
  assert.equal(next.critDamage, 2);
  assert.equal(next.attackSpeed, 60);
  assert.equal(next.eliteDamage, 15);
  assert.equal(next.poison, 50);
  assert.equal(next.poisonOn, true);
  assert.equal(next.forkCritSeparate, false);
});

test('an idle snapshot does not clobber the build', () => {
  const build = defaultBuild();
  assert.equal(applyLiveSnapshot(build, { v: 1, t: 1, inRun: false }), build);
});

test('elite bonus is in the total only while the target is an elite', () => {
  const build = bare();
  build.eliteDamage = 100;
  const onElite = analyze({ ...build, targetElite: true }).total;
  const onNormal = analyze({ ...build, targetElite: false }).total;
  assert.ok(Math.abs(onElite - 2) < 1e-9);
  assert.ok(Math.abs(onNormal - 1) < 1e-9);
});

test('poison stat is recorded and left out of the hit', () => {
  const build = bare();
  build.poisonOn = true;
  build.poison = 50;
  assert.equal(analyze(build).total, 1);
});

test('damage dealt shares sum to 100', () => {
  const rows = sourceShares([
    { source: 'Bow', damage: 75 },
    { source: 'Bonker', damage: 25 },
    { source: 'Idle', damage: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'Bow');
  assert.equal(rows[0].percent, 75);
  assert.equal(rows[1].percent, 25);
});

test('known stats use the documented units', () => {
  assert.equal(formatStat('CritChance', 0.4).text, '40%');
  assert.equal(formatStat('CritDamage', 1).text, '×2');
  assert.equal(formatStat('DamageMultiplier', 3.2).text, '×3.2');
  assert.equal(formatStat('Projectiles', 4).text, '4');
});

test('stat rows prefer the full block', () => {
  const rows = statRows({
    v: 2, t: 1, inRun: true,
    stats: { damageMultiplier: 2 },
    all: [{ id: 'Luck', v: 4 }, { id: 'DamageMultiplier', v: 2 }],
  });
  assert.deepEqual(rows.map(row => row.id), ['Luck', 'DamageMultiplier']);
});
