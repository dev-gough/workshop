import assert from 'node:assert/strict';
import test from 'node:test';
import { clockTickMs, shouldRunProjector } from './power';

test('full power follows the selected clock motion', () => {
  assert.equal(clockTickMs('full', true, true), 50);
  assert.equal(clockTickMs('full', false, true), 1000);
});

test('economy mode caps clock updates and parks the projector', () => {
  assert.equal(clockTickMs('economy', true, true), 1000);
  assert.equal(shouldRunProjector('julia', 'economy', true), false);
});

test('hidden documents stop both clock and projector work', () => {
  assert.equal(clockTickMs('full', true, false), null);
  assert.equal(shouldRunProjector('julia', 'full', false), false);
});

test('the projector only runs for a selected slide at full power', () => {
  assert.equal(shouldRunProjector('none', 'full', true), false);
  assert.equal(shouldRunProjector('starfield', 'full', true), true);
});
