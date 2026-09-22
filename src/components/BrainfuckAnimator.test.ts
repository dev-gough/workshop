import assert from 'node:assert/strict';
import test from 'node:test';
import { tapeInstructionAt } from './BrainfuckAnimator';

test('maps punched-tape clicks to instruction columns', () => {
  // 640×360 uses scale 1: the four 22px columns are centered at x=276..364.
  assert.equal(tapeInstructionAt(277, 30, 640, 360, 4), 0);
  assert.equal(tapeInstructionAt(319, 30, 640, 360, 4), 1);
  assert.equal(tapeInstructionAt(363, 30, 640, 360, 4), 3);
});

test('ignores clicks outside the physical tape', () => {
  assert.equal(tapeInstructionAt(275, 30, 640, 360, 4), null);
  assert.equal(tapeInstructionAt(300, 70, 640, 360, 4), null);
  assert.equal(tapeInstructionAt(300, 30, 640, 360, 0), null);
});
