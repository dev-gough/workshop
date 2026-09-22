import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultParams, Session } from './engine';
import { decodeReplay, encodeReplay, replayCard } from './replay';

function snapshot(session: Session) {
  return {
    gen: session.gen,
    tick: session.tick,
    bestEver: session.bestEver,
    history: session.history,
    cars: session.cars.map(car => ({
      x: car.x,
      y: car.y,
      heading: car.heading,
      speed: car.speed,
      progress: car.progress,
      alive: car.alive,
      out: car.out,
      sensors: car.sensors,
      genome: [...car.genome],
    })),
  };
}

test('same replay card reproduces the seeded season exactly', () => {
  const source = new Session(defaultParams());
  const code = encodeReplay(replayCard(source));
  const card = decodeReplay(`https://workshop.test/projects/neuroevolution?replay=${code}`);
  assert.ok(card);

  const replay = new Session(card.params);
  for (let i = 0; i < 600; i++) {
    source.step();
    replay.step();
  }

  assert.deepEqual(snapshot(replay), snapshot(source));
});

test('hand-drawn replay cards preserve the exact faired centerline', () => {
  const source = new Session(defaultParams());
  assert.equal(source.customCircuit([
    { x: -100, y: -80 },
    { x: 110, y: -80 },
    { x: 130, y: 70 },
    { x: -110, y: 90 },
  ], 28), null);

  const card = decodeReplay(encodeReplay(replayCard(source)));
  assert.ok(card?.customCircuit);
  const replay = new Session(card.params);
  replay.replayCircuit(card.customCircuit.centerline, card.customCircuit.width);

  assert.deepEqual(replay.track.centerline, source.track.centerline);
  assert.equal(replay.track.width, source.track.width);
  assert.equal(replay.customTrack, true);
});

test('simulation hot-path workspaces are reused across ticks', () => {
  const session = new Session(defaultParams());
  const car = session.cars[0];
  const inputs = car.brainInputs;
  const hidden = car.brainHidden;
  const out = car.brainOut;
  const marks = session.grid.visitMarks;

  for (let i = 0; i < 50; i++) session.step();

  assert.equal(car.brainInputs, inputs);
  assert.equal(car.brainHidden, hidden);
  assert.equal(car.brainOut, out);
  assert.equal(session.grid.visitMarks, marks);
  assert.ok(session.grid.visitToken > 0);
});

test('malformed replay cards fail closed', () => {
  assert.equal(decodeReplay('not-a-replay'), null);
  assert.equal(decodeReplay('https://workshop.test/projects/neuroevolution'), null);
});
