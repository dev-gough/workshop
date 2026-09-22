import assert from 'node:assert/strict';
import test from 'node:test';
import { critFactor, defaultBuild, analyze } from './model';
import { applyLiveSnapshot } from './live';

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
});

test('an idle snapshot does not clobber the build', () => {
  const build = defaultBuild();
  assert.equal(applyLiveSnapshot(build, { v: 1, t: 1, inRun: false }), build);
});

test('elite bonus is in the total only while the target is an elite', () => {
  const build = defaultBuild();
  build.eliteDamage = 100;
  build.critOn = false;
  build.attackSpeedOn = false;
  build.tomeOn = false;
  for (const item of Object.values(build.items)) item.on = false;
  build.characterId = 'vanilla';

  const onElite = analyze({ ...build, targetElite: true }).total;
  const onNormal = analyze({ ...build, targetElite: false }).total;
  assert.ok(Math.abs(onElite - 2) < 1e-9);
  assert.ok(Math.abs(onNormal - 1) < 1e-9);
});
