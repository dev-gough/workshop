import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultBuild } from './model';
import { decodeBuild, encodeBuild } from './share';

test('shared builds round-trip every modeled value', () => {
  const build = defaultBuild();
  build.characterId = 'amog';
  build.items.beer = { on: true, value: 27, stacks: 5 };
  build.critChance = 235;
  build.poisonOn = true;
  build.poison = 175;
  build.includeAttackSpeed = false;

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
    items: { beer: { on: true, value: 99, stacks: 999 } },
  };
  const encoded = encodeBuild(raw);
  const decoded = decodeBuild(encoded);

  assert.ok(decoded);
  assert.equal(decoded.characterId, defaultBuild().characterId);
  assert.equal(decoded.items.beer.stacks, 5);
  assert.equal(decoded.items.beer.value, 99);
  assert.ok(decoded.items['gym-sauce']);
});
