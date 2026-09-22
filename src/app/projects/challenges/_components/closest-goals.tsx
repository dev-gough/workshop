'use client';

import { Target } from 'lucide-react';
import { motion } from 'motion/react';
import { ChallengeToken } from './token';
import {
  progressFraction,
  titleTier,
  type ChallengeNode,
} from './types';
import type { HoverHandler, SelectHandler } from './rows';

function remaining(node: ChallengeNode): string {
  return Math.max(0, Math.ceil((node.nextThreshold ?? 0) - (node.value ?? 0))).toLocaleString();
}

export function ClosestGoals({
  goals,
  onHover,
  onSelect,
}: {
  goals: ChallengeNode[];
  onHover: HoverHandler;
  onSelect: SelectHandler;
}) {
  if (goals.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="closest-goals-heading">
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Within reach
          </p>
          <h2 id="closest-goals-heading" className="mt-0.5 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-foreground">
            <Target className="h-4 w-4" />
            Next goals
          </h2>
        </div>
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          Closest progress rings in this category
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {goals.map((goal) => (
          <motion.button
            key={goal.challengeId}
            type="button"
            onClick={() => onSelect(goal)}
            onMouseEnter={(event) => onHover(goal, event.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => onHover(null)}
            onFocus={(event) => onHover(goal, event.currentTarget.getBoundingClientRect())}
            onBlur={() => onHover(null)}
            whileHover={{ y: -2 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="lol-plate group flex min-w-0 items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:border-[var(--lol-gold)]"
            aria-label={`${goal.name}: ${remaining(goal)} remaining to ${titleTier(goal.nextLevel ?? '')}`}
          >
            <ChallengeToken node={goal} size={48} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-foreground">
                {goal.name}
              </span>
              <span className="mt-1 block font-mono text-[10px] tabular-nums text-primary">
                {remaining(goal)} to {titleTier(goal.nextLevel ?? '')}
              </span>
              <span className="mt-1.5 block h-1 overflow-hidden bg-[var(--lol-bg-deep)]">
                <span
                  className="block h-full bg-[var(--lol-blue)] transition-[width] duration-700"
                  style={{ width: `${progressFraction(goal) * 100}%` }}
                />
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
