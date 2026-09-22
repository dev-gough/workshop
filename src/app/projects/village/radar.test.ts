import assert from 'node:assert/strict';
import test from 'node:test';
import { createRadarTransform } from './radar';

const bounds = { minX: -80, minZ: 20, maxX: 120, maxZ: 120 };

test('radar projection preserves aspect ratio and centers the short axis', () => {
  const radar = createRadarTransform(bounds, 240, 240, 20);

  assert.equal(radar.scale, 1);
  assert.deepEqual(radar.project(-80, 20), { x: 20, y: 70 });
  assert.deepEqual(radar.project(120, 120), { x: 220, y: 170 });
});

test('radar clicks invert to their exact world position', () => {
  const radar = createRadarTransform(bounds, 300, 180, 10);
  const pixel = radar.project(42.25, 73.5);
  const world = radar.unproject(pixel.x, pixel.y);

  assert.ok(Math.abs(world.x - 42.25) < 1e-9);
  assert.ok(Math.abs(world.z - 73.5) < 1e-9);
});

test('degenerate settlement bounds still produce finite coordinates', () => {
  const radar = createRadarTransform(
    { minX: 4, minZ: 9, maxX: 4, maxZ: 9 },
    100,
    100,
    12,
  );

  const point = radar.project(4, 9);
  assert.ok(Number.isFinite(point.x));
  assert.ok(Number.isFinite(point.y));
});
