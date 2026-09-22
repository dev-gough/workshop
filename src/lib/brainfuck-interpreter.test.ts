import assert from 'node:assert/strict';
import test from 'node:test';
import { BFInterpreter } from './brainfuck-interpreter';

test('compiled forward jumps preserve scan calculation cost', () => {
  const interp = new BFInterpreter('[++++].');

  interp.runToCompletion();

  assert.equal(interp.output, '\0');
  assert.equal(interp.calcs, 6);
  assert.equal(interp.done, true);
});

test('compiled backward jumps preserve nested-loop behavior and cost', () => {
  const interp = new BFInterpreter('++[-]');

  interp.runToCompletion();

  assert.equal(interp.memory[0], 0);
  assert.equal(interp.calcs, 8);
  assert.equal(interp.done, true);
});

test('compiled jumps truncate at the same point during a long scan', () => {
  const interp = new BFInterpreter('[++++]', 3);

  interp.step();

  assert.equal(interp.calcs, 3);
  assert.equal(interp.output, '-1');
  assert.equal(interp.truncated, true);
});

test('unmatched brackets retain the reference interpreter fallback', () => {
  const interp = new BFInterpreter('[++');

  interp.step();

  assert.equal(interp.calcs, 3);
  assert.equal(interp.truncated, true);
  assert.equal(interp.output, '');
});

test('a compiled jump remains reversible', () => {
  const interp = new BFInterpreter('[++]');

  assert.equal(interp.step(), false);
  assert.equal(interp.done, true);
  assert.equal(interp.calcs, 3);

  assert.equal(interp.stepBack(), true);
  assert.equal(interp.ip, 0);
  assert.equal(interp.calcs, 0);
  assert.equal(interp.done, false);
});
