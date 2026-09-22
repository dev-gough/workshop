import assert from 'node:assert/strict';
import test from 'node:test';
import type { Network, NetworkSegment } from './model';
import { TripRouter } from './route';

const segment = (
  id: number,
  a: number,
  b: number,
  coords: [number, number][],
): NetworkSegment => ({
  id,
  kind: 'paddle',
  a,
  b,
  length_m: 1000,
  coords,
});

test('spatial snap index finds the exact nearest edge across cell boundaries', () => {
  const segments: NetworkSegment[] = [];
  const nodes: Network['nodes'] = [];

  // A large set of irrelevant edges makes this representative of a park
  // network; only the local grid cells should be candidates at query time.
  for (let i = 0; i < 5000; i++) {
    const lon = -84 + (i % 100) * 0.001;
    const lat = 42 + Math.floor(i / 100) * 0.001;
    nodes.push({ id: i * 2, lon, lat }, { id: i * 2 + 1, lon: lon + 0.0005, lat });
    segments.push(segment(i, i * 2, i * 2 + 1, [[lon, lat], [lon + 0.0005, lat]]));
  }

  const targetId = segments.length;
  nodes.push(
    { id: 20_000, lon: -79.02, lat: 45.5 },
    { id: 20_001, lon: -78.98, lat: 45.5 },
  );
  segments.push(
    segment(targetId, 20_000, 20_001, [
      [-79.02, 45.5],
      [-78.98, 45.5],
    ]),
  );
  const network: Network = { nodes, segments, campsites: [], accessPoints: [] };
  const router = new TripRouter(network);

  const snap = router.snap([-79, 45.50045], 100);
  assert.ok(snap);
  assert.equal(snap.segIdx, targetId);
  assert.ok(Math.abs(snap.point[0] - -79) < 1e-8);
  assert.ok(Math.abs(snap.point[1] - 45.5) < 1e-8);
  assert.ok(snap.distM > 45 && snap.distM < 55);
  assert.equal(router.snap([-79, 45.51], 100), null);
});
