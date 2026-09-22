import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closestGoals,
  indexSortedChildren,
  sortNodes,
} from './challenge-logic';
import type { ChallengeNode } from './types';

function node(
  challengeId: number,
  name: string,
  value: number | null,
  nextThreshold: number | null,
  overrides: Partial<ChallengeNode> = {}
): ChallengeNode {
  return {
    challengeId,
    name,
    description: '',
    shortDescription: '',
    kind: 'challenge',
    parentId: 10,
    categoryId: 2,
    childIds: [],
    state: 'ENABLED',
    level: 'IRON',
    value,
    nextThreshold,
    nextLevel: nextThreshold === null ? null : 'BRONZE',
    thresholds: {},
    percentiles: {},
    percentile: null,
    points: 5,
    nextPoints: 10,
    isScoring: true,
    leaderboard: false,
    endTimestamp: null,
    source: null,
    queueIds: [],
    rewards: {},
    icon: '',
    achievedTime: null,
    position: null,
    playersInLevel: null,
    ...overrides,
  };
}

test('closest goals ranks progressable leaves and excludes completed parents', () => {
  const goals = closestGoals([
    node(1, 'Nine of ten', 9, 10),
    node(2, 'Ninety of one hundred', 90, 100),
    node(3, 'Maxed', 100, null),
    node(4, 'Group', 99, 100, { kind: 'group' }),
    node(5, 'Over threshold', 12, 10),
  ]);

  assert.deepEqual(goals.map((goal) => goal.challengeId), [1, 2]);
});

test('closest goals respects the requested limit without mutating input', () => {
  const input = [
    node(1, 'Halfway', 5, 10),
    node(2, 'Nearly', 8, 10),
    node(3, 'Started', 1, 10),
  ];

  assert.deepEqual(closestGoals(input, 2).map((goal) => goal.challengeId), [2, 1]);
  assert.deepEqual(input.map((goal) => goal.challengeId), [1, 2, 3]);
});

test('sorted child index groups and orders each parent once', () => {
  const nodes = [
    node(1, 'Zulu', 1, 10),
    node(2, 'Alpha', 1, 10),
    node(3, 'Other parent', 1, 10, { parentId: 20 }),
  ];
  const index = indexSortedChildren(nodes, 'name');

  assert.deepEqual(index.get(10)?.map((child) => child.name), ['Alpha', 'Zulu']);
  assert.deepEqual(index.get(20)?.map((child) => child.name), ['Other parent']);
  assert.deepEqual(sortNodes(nodes, 'name').map((child) => child.name), [
    'Alpha',
    'Other parent',
    'Zulu',
  ]);
});
