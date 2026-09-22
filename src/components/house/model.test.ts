import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type FurnitureItem,
  type RoomSpec,
  findNearestFreePosition,
} from './model';

const room: RoomSpec = { w: 10, h: 10, cutouts: [] };

function piece(id: number, x: number, y: number, width = 2, height = 2): FurnitureItem {
  return {
    id, x, y, width, height,
    label: `Piece ${id}`,
    rotation: 0,
    locked: false,
    icon: 'Square',
    color: '#000',
  };
}

test('finds the nearest free position with stable top-left tie breaking', () => {
  const moving = piece(1, 4, 4);
  const blocker = piece(2, 4, 4);

  assert.deepEqual(
    findNearestFreePosition(moving, [moving, blocker], room),
    { x: 4, y: 2 },
  );
});

test('avoids room cutouts', () => {
  const notched: RoomSpec = {
    w: 10,
    h: 10,
    cutouts: [{ corner: 'nw', w: 5, d: 5 }],
  };
  const moving = piece(1, 1, 1);

  assert.deepEqual(
    findNearestFreePosition(moving, [moving], notched),
    { x: 5, y: 1 },
  );
});

test('returns null when no valid floor remains', () => {
  const moving = piece(1, 0, 0, 6, 6);
  const blocker = piece(2, 0, 0, 10, 10);

  assert.equal(findNearestFreePosition(moving, [moving, blocker], room), null);
});

test('keeps furniture out of a door swing', () => {
  const moving = piece(1, 4, 0, 1, 1);
  const door = { id: 3, wall: 'n' as const, pos: 4, width: 2, hinge: 'start' as const };

  assert.deepEqual(
    findNearestFreePosition(moving, [moving], room, [door]),
    { x: 3, y: 0 },
  );
});
