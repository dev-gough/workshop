'use client';

import { useState } from 'react';
import { TOKEN_PLACEHOLDER } from '@/lib/cdragon';
import { tierVar, progressFraction, type ChallengeNode } from './types';

/**
 * A challenge's tier token, ringed by its progress toward the next tier.
 *
 * The ring is the client's central affordance: the arc is how much of the way
 * you are to the *next* token, so a nearly-closed ring means "one more game".
 * It is drawn in the tier's own colour, which makes a wall of tokens legible
 * as a heat map — teal clusters are Platinum, magenta clusters are Master.
 */
export function ChallengeToken({
  node,
  size = 64,
  showRing = true,
  className = '',
}: {
  node: ChallengeNode;
  size?: number;
  showRing?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const frac = progressFraction(node);
  const color = tierVar(node.level);

  // Geometry in a fixed 100-unit space so one viewBox serves every size.
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {showRing && (
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden
        >
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke="var(--lol-border)" strokeWidth="4"
          />
          {frac > 0 && (
            <circle
              cx="50" cy="50" r={R} fill="none"
              stroke={color} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${frac * C} ${C}`}
              style={{
                transition: 'stroke-dasharray 700ms ease-out',
                filter: `drop-shadow(0 0 3px color-mix(in srgb, ${color} 60%, transparent))`,
              }}
            />
          )}
        </svg>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={failed ? TOKEN_PLACEHOLDER : node.icon}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="absolute object-contain"
        style={{ inset: showRing ? '11%' : 0 }}
      />
    </div>
  );
}

/**
 * The tier-tinted corner wedge carrying a node's point value — the client's
 * way of showing what a card is worth without spending a row on it.
 *
 * Non-scoring nodes get no wedge at all: two delisted challenges still report
 * progress but award nothing, and printing a number there would be a lie.
 */
export function PointsCorner({ node }: { node: ChallengeNode }) {
  if (!node.isScoring || !node.points) return null;
  const color = tierVar(node.level);
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-10 select-none"
      style={{
        width: 54,
        height: 54,
        clipPath: 'polygon(0 0, 100% 0, 0 100%)',
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 25%, transparent))`,
      }}
    >
      <span
        className="absolute left-[5px] top-[2px] font-mono text-[11px] font-bold tabular-nums"
        style={{ color: 'var(--lol-bg-deep)' }}
      >
        {node.points}
      </span>
    </div>
  );
}
