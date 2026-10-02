import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultBuild } from './model';
import { decodeBuild, encodeBuild } from './share';

test('shared builds round-trip every modeled value', () => {
  const build = defaultBuild();
  build.items.beer = { on: true, stacks: 5 };
  build.critChance = 235;
  build.critOn = true;
  build.poisonOn = true;
  build.poison = 175;
  build.includeAttackSpeed = false;
  build.airborne = true;
  build.maxHp = 400;
  build.joeExecutes = 12;

  assert.deepEqual(decodeBuild(encodeBuild(build)), build);
});

test('invalid shared builds fail safely', () => {
  assert.equal(decodeBuild('not-json'), null);
});

test('unknown and out-of-range values are normalized', () => {
  const build = defaultBuild();
  const raw = {
    ...build,
    characterId: 'future-character',
    items: { beer: { on: true, stacks: 999 } },
  };
  const encoded = encodeBuild(raw);
  const decoded = decodeBuild(encoded);

  assert.ok(decoded);
  assert.equal(decoded.items.beer.stacks, 40);
  assert.equal(decoded.items.beer.on, true);
  assert.ok(decoded.items['gym-sauce']);
  assert.equal(decoded.items['gym-sauce'].on, false);
});
