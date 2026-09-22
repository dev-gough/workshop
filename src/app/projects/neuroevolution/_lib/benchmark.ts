import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { defaultParams, Session } from './engine';

const TICKS = 1200;

function run() {
  const session = new Session(defaultParams());
  const started = performance.now();
  for (let i = 0; i < TICKS; i++) session.step();
  const elapsedMs = performance.now() - started;
  const checksum = JSON.stringify({
    gen: session.gen,
    tick: session.tick,
    best: session.bestEver,
    cars: session.cars.map(car => [
      car.id,
      car.x,
      car.y,
      car.progress,
      car.alive,
      car.out,
    ]),
  });
  return { elapsedMs, checksum };
}

const first = run();
const second = run();
assert.equal(second.checksum, first.checksum, 'same seed must produce the same benchmark checksum');

const meanMs = (first.elapsedMs + second.elapsedMs) / 2;
console.log(JSON.stringify({
  ticksPerRun: TICKS,
  deterministic: true,
  meanMs: Number(meanMs.toFixed(2)),
  ticksPerSecond: Math.round((TICKS * 1000) / meanMs),
}));
