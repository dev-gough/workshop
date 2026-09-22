import assert from 'node:assert/strict';
import test from 'node:test';
import { classifiedInAcc } from './census-pool';
import { createCensusEngine } from '../workers/gol-census-core';

test('classified progress counts weighted outcomes from out-of-order chunks exactly', () => {
  const engine = createCensusEngine(4, 4);
  const chunkSize = engine.total / 4;
  const chunks = Array.from({ length: 4 }, (_, i) =>
    engine.runChunk(i * chunkSize, (i + 1) * chunkSize),
  );

  // Worker replies need not follow index order. Every completed chunk still
  // contributes exact classified-state progress before it is checkpointable.
  const replyOrder = [2, 0, 3, 1];
  let classified = 0;
  for (const index of replyOrder) {
    const count = classifiedInAcc(chunks[index]);
    assert.ok(count > 0);
    classified += count;
  }

  assert.equal(classified, engine.total);
});
