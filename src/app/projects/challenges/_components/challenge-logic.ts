import {
  ALL_TIERS,
  progressFraction,
  type ChallengeNode,
} from './types';

export type SortKey = 'name' | 'closest' | 'rarest' | 'tier';

export function sortNodes(
  nodes: readonly ChallengeNode[],
  key: SortKey
): ChallengeNode[] {
  const out = [...nodes];
  switch (key) {
    case 'closest':
      return out.sort((a, b) => {
        const fa = a.nextThreshold === null ? -1 : progressFraction(a);
        const fb = b.nextThreshold === null ? -1 : progressFraction(b);
        return fb - fa || a.name.localeCompare(b.name);
      });
    case 'rarest':
      return out.sort((a, b) => {
        const ra = a.percentiles[a.level] ?? 1;
        const rb = b.percentiles[b.level] ?? 1;
        return ra - rb || a.name.localeCompare(b.name);
      });
    case 'tier':
      return out.sort((a, b) =>
        ALL_TIERS.indexOf(b.level as (typeof ALL_TIERS)[number]) -
          ALL_TIERS.indexOf(a.level as (typeof ALL_TIERS)[number]) ||
        a.name.localeCompare(b.name)
      );
    default:
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Builds each parent's sorted child list once per data/sort change. Keeping
 * this outside render-time row mapping avoids repeating every child sort when
 * transient state such as a hover card changes.
 */
export function indexSortedChildren(
  nodes: readonly ChallengeNode[],
  key: SortKey
): Map<number, ChallengeNode[]> {
  const buckets = new Map<number, ChallengeNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const bucket = buckets.get(node.parentId);
    if (bucket) bucket.push(node);
    else buckets.set(node.parentId, [node]);
  }
  for (const [parentId, children] of buckets) {
    buckets.set(parentId, sortNodes(children, key));
  }
  return buckets;
}

/**
 * Progressable leaf challenges nearest to their next tier. A fractional rank
 * keeps unlike counters comparable; absolute distance breaks equal-progress
 * ties in favour of the goal needing fewer actions.
 */
export function closestGoals(
  nodes: readonly ChallengeNode[],
  limit = 5
): ChallengeNode[] {
  return nodes
    .filter((node) =>
      node.kind === 'challenge' &&
      node.nextThreshold !== null &&
      node.nextThreshold > (node.value ?? 0)
    )
    .sort((a, b) =>
      progressFraction(b) - progressFraction(a) ||
      (a.nextThreshold! - (a.value ?? 0)) - (b.nextThreshold! - (b.value ?? 0)) ||
      a.name.localeCompare(b.name)
    )
    .slice(0, Math.max(0, limit));
}
