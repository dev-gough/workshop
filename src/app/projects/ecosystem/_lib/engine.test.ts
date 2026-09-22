import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Ecosystem,
  classifyEcoSignal,
  defaultParams,
  type PopSample,
} from './engine';

function samples(values: Array<[number, number, number]>): PopSample[] {
  return values.map(([prey, pred, plants], i) => ({
    t: i * 5,
    prey,
    pred,
    plants,
    starved: 0,
    eaten: 0,
    aged: 0,
    births: 0,
  }));
}

test('early warning ignores noise but identifies a sustained collapse', () => {
  const stable = samples([
    [100, 20, 300], [102, 19, 296], [98, 21, 305], [101, 20, 301],
    [99, 20, 298], [103, 19, 303], [100, 21, 300], [98, 20, 302],
  ]);
  assert.equal(classifyEcoSignal(stable, { prey: 98, pred: 20, plants: 302 }).level, 'stable');

  const collapse = samples([
    [120, 24, 300], [116, 24, 295], [112, 23, 290], [108, 22, 285],
    [75, 21, 280], [62, 20, 275], [48, 19, 270], [36, 18, 265],
  ]);
  const signal = classifyEcoSignal(collapse, { prey: 36, pred: 18, plants: 265 });
  assert.equal(signal.level, 'tipping');
  assert.match(signal.label, /Grazer/);
});

test('same seed and parameters remain exactly deterministic', () => {
  const a = new Ecosystem(defaultParams());
  const b = new Ecosystem(defaultParams());

  for (let i = 0; i < 200; i++) {
    a.step();
    b.step();
  }

  assert.deepEqual(a.stats(), b.stats());
  assert.deepEqual(a.agents, b.agents);
  assert.deepEqual(a.plants, b.plants);
  assert.deepEqual(a.pop, b.pop);
});
