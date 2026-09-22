import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluationSize,
  fitnessWorkRatio,
  normalizedRgbError,
  resizeRgbaNearest,
} from './evolution';

test('quality modes expose progressively larger fitness workloads', () => {
  assert.equal(evaluationSize('draft'), 32);
  assert.equal(evaluationSize('balanced'), 64);
  assert.equal(evaluationSize('fine'), 100);
  assert.equal(fitnessWorkRatio('draft'), 0.1024);
  assert.equal(fitnessWorkRatio('balanced'), 0.4096);
  assert.equal(fitnessWorkRatio('fine'), 1);
});

test('nearest-neighbor resizing samples each target pixel center', () => {
  const source = new Uint8ClampedArray([
    10, 11, 12, 255, 20, 21, 22, 255,
    30, 31, 32, 255, 40, 41, 42, 255,
  ]);

  assert.deepEqual(
    [...resizeRgbaNearest(source, 2, 2, 1, 1)],
    [40, 41, 42, 255],
  );
  assert.deepEqual(
    [...resizeRgbaNearest(source, 2, 2, 2, 2)],
    [...source],
  );
});

test('normalized RGB error ignores alpha and spans zero to one', () => {
  const black = new Uint8ClampedArray([0, 0, 0, 0]);
  const opaqueBlack = new Uint8ClampedArray([0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 123]);

  assert.equal(normalizedRgbError(black, opaqueBlack), 0);
  assert.equal(normalizedRgbError(black, white), 1);
});

test('image helpers reject malformed buffers', () => {
  assert.throws(
    () => resizeRgbaNearest(new Uint8ClampedArray(3), 1, 1, 1, 1),
    RangeError,
  );
  assert.throws(
    () => normalizedRgbError(new Uint8ClampedArray(4), new Uint8ClampedArray(8)),
    RangeError,
  );
});
