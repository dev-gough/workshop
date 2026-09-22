import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VISUALIZER, VISUALIZERS, isVisualizerId } from './catalog';

test('visualizer catalogue has unique, valid ids', () => {
  const ids = VISUALIZERS.map((visualizer) => visualizer.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(isVisualizerId(DEFAULT_VISUALIZER), true);
  assert.equal(isVisualizerId('not-a-visualizer'), false);
});

test('Sol originals carry visible attribution metadata', () => {
  const originals = VISUALIZERS.filter((visualizer) => visualizer.origin === 'barfoo');
  assert.deepEqual(
    originals.map((visualizer) => visualizer.id),
    ['lacquer', 'garden', 'chladni', 'sleeve'],
  );
  for (const visualizer of originals) {
    assert.equal(visualizer.author, 'Sol');
    assert.ok(visualizer.accent.startsWith('hsl('));
    assert.ok(visualizer.description.length > 40);
  }
});

test('borrowed scenes credit Polar Clock', () => {
  const inherited = VISUALIZERS.filter((visualizer) => visualizer.origin === 'polar-clock');
  assert.equal(inherited.length, 4);
  assert.ok(inherited.every((visualizer) => visualizer.author === 'Polar Clock'));
});
