import assert from 'node:assert/strict';
import test from 'node:test';
import {
  jellyfinPollInterval,
  reuseEqualSnapshot,
  sharingProjection,
} from './jellyfin-dashboard';

test('sharingProjection measures the road to the ratio target', () => {
  assert.deepEqual(sharingProjection(250, 100, 25, 10), {
    ratio: 2.5,
    progress: 0.25,
    remainingBytes: 750,
    secondsAtCurrentRate: 30,
    reached: false,
  });
});

test('sharingProjection handles idle, reached, and empty sessions', () => {
  assert.equal(sharingProjection(0, 0, 10), null);
  assert.equal(sharingProjection(100, 100, 0)?.secondsAtCurrentRate, null);

  const reached = sharingProjection(1_200, 100, 10);
  assert.equal(reached?.progress, 1);
  assert.equal(reached?.remainingBytes, 0);
  assert.equal(reached?.reached, true);
});

test('polling backs off when there is no active transfer', () => {
  assert.equal(jellyfinPollInterval('transfers', true), 2_000);
  assert.equal(jellyfinPollInterval('transfers', false), 8_000);
  assert.equal(jellyfinPollInterval('history', false), 30_000);
  assert.equal(jellyfinPollInterval('stats', false), 15_000);
});

test('reuseEqualSnapshot preserves identity only for unchanged payloads', () => {
  const previous = [{ id: 1, status: 'seeding' }];
  const equal = [{ id: 1, status: 'seeding' }];
  const changed = [{ id: 1, status: 'paused' }];

  assert.equal(reuseEqualSnapshot(previous, equal), previous);
  assert.equal(reuseEqualSnapshot(previous, changed), changed);
});
