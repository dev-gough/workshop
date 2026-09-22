import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptiveCurve,
  pointsPath,
  solveHohmann,
  transferArcPoints,
  type Point,
} from './orbit';

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} was not within ${tolerance} of ${expected}`
  );

test('GEO transfer matches canonical two-body mission values', () => {
  const geo = solveHohmann(35_786);

  near(geo.totalDeltaVKmS, 3.935, 0.005);
  near(geo.coastSeconds / 3600, 5.26, 0.02);
  near(geo.targetPeriodSeconds / 3600, 23.93, 0.02);
  near(geo.targetSpeedKmS, 3.07, 0.01);
});

test('higher targets take more coast time and total delta-v', () => {
  const iss = solveHohmann(408);
  const gps = solveHohmann(20_200);
  const geo = solveHohmann(35_786);

  assert.ok(iss.coastSeconds < gps.coastSeconds);
  assert.ok(gps.coastSeconds < geo.coastSeconds);
  assert.ok(iss.totalDeltaVKmS < gps.totalDeltaVKmS);
  assert.ok(gps.totalDeltaVKmS < geo.totalDeltaVKmS);
});

test('adaptive transfer path is deterministic and uses fewer vertices than fixed sampling', () => {
  const solution = solveHohmann(35_786);
  const first = transferArcPoints(solution, 270, 174, solution.targetRadiusKm / 145);
  const second = transferArcPoints(solution, 270, 174, solution.targetRadiusKm / 145);

  assert.deepEqual(first, second);
  assert.ok(first.length < 90, `expected fewer than 90 points, received ${first.length}`);
  assert.equal(pointsPath(first), pointsPath(second));
});

test('adaptive tessellation respects screen-space error on a curved path', () => {
  const curve = (t: number): Point => ({ x: t * 200, y: 80 * t * t });
  const points = adaptiveCurve(curve, 0, 1, 0.45);

  const distanceToSegment = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const u = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
    );
    return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
  };

  for (let i = 0; i <= 1000; i++) {
    const sample = curve(i / 1000);
    const error = Math.min(
      ...points.slice(1).map((point, index) => distanceToSegment(sample, points[index], point))
    );
    assert.ok(error <= 0.46, `curve error ${error}px exceeded tolerance`);
  }
});

test('invalid inward transfers fail explicitly', () => {
  assert.throws(() => solveHohmann(100), /above the parking orbit/);
});
