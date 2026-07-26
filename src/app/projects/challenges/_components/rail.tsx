'use client';

import { motion } from 'motion/react';
import { crystalPath } from '@/lib/cdragon';
import { tierVar, progressFraction, type ChallengeNode, type CategoryPoints } from './types';

/** The synthetic rail bucket for parentless trees. Mirrors LEGACY_ID on the API. */
export const LEGACY_ID = -1;

/**
 * Rail entries in the client's own order.
 *
 * Note this is NOT id order (2, 4, 1, 3, 5) and not alphabetical, points, or
 * completion order either — it's Riot's curation, taken from the client itself.
 * Hardcoded because nothing in the data reproduces it.
 */
export const RAIL: { id: number; label: string; slug: string }[] = [
  { id: 2, label: 'Expertise', slug: 'expertise' },
  { id: 4, label: 'Teamwork & Strategy', slug: 'teamwork' },
  { id: 1, label: 'Imagination', slug: 'imagination' },
  { id: 3, label: 'Veterancy', slug: 'veterancy' },
  { id: 5, label: 'Collection', slug: 'collection' },
  { id: LEGACY_ID, label: 'Legacy', slug: 'legacy' },
];

/**
 * Category glyph, recoloured. The mirrored SVGs carry a hardcoded fill, so they
 * are used as a mask rather than an image — that way one asset serves the muted
 * idle state and the gold active state without a second file.
 */
export function CategoryGlyph({
  slug, size = 18, color = 'currentColor',
}: { slug: string; size?: number; color?: string }) {
  const url = `url(/lol/challenge-shared/categories/${slug}.svg)`;
  return (
    <span
      aria-hidden
      className="inline-block flex-shrink-0"
      style={{
        width: size, height: size, background: color,
        maskImage: url, WebkitMaskImage: url,
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain', WebkitMaskSize: 'contain',
        maskPosition: 'center', WebkitMaskPosition: 'center',
      }}
    />
  );
}

/**
 * The overall CRYSTAL dial: total points inside a ring showing progress to the
 * next crystal tier. This is the room's centrepiece, so it gets the real gem
 * art rather than a glyph.
 */
export function CrystalDial({
  node, totals,
}: { node: ChallengeNode | undefined; totals: CategoryPoints | null }) {
  const level = node?.level ?? totals?.level ?? 'NONE';
  const current = node?.value ?? totals?.current ?? 0;
  const frac = node ? progressFraction(node) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative mx-auto" style={{ width: 176, height: 176 }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--lol-border)" strokeWidth="2.5" />
        <circle
          cx="50" cy="50" r={R} fill="none"
          stroke="var(--lol-blue)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          style={{
            transition: 'stroke-dasharray 900ms ease-out',
            filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--lol-blue) 70%, transparent))',
          }}
        />
      </svg>

      <div
        className="absolute inset-[7%] flex flex-col items-center justify-center rounded-full"
        style={{
          background: 'radial-gradient(circle at 50% 35%, var(--lol-bg-surface), var(--lol-bg-deep) 70%)',
          border: '1px solid var(--lol-border)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={crystalPath(level)}
          alt=""
          className="h-16 w-16 object-contain"
          style={{ filter: 'drop-shadow(0 0 10px color-mix(in srgb, var(--lol-blue) 45%, transparent))' }}
        />
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-primary">
          {Math.round(current).toLocaleString()}
        </p>
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: tierVar(level) }}
        >
          {level === 'NONE' ? 'Unranked' : level}
        </p>
      </div>
    </div>
  );
}

export function CategoryRail({
  active, counts, onSelect,
}: {
  active: number;
  counts: Record<number, { done: number; total: number }>;
  onSelect: (id: number) => void;
}) {
  return (
    <nav className="flex flex-col" aria-label="Challenge categories">
      {RAIL.map((entry) => {
        const isActive = entry.id === active;
        const c = counts[entry.id];
        return (
          <button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            aria-current={isActive ? 'page' : undefined}
            // Legacy is a different kind of thing — seasonal trees that can no
            // longer be progressed — so the client sets it apart with a rule.
            className={`group relative flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              entry.id === LEGACY_ID ? 'mt-3 border-t border-border pt-5' : ''
            } ${isActive ? 'bg-[var(--lol-bg-elevated)]' : 'hover:bg-[var(--lol-bg-surface)]'}`}
          >
            {isActive && (
              <motion.span
                layoutId="rail-active"
                className="absolute left-0 top-0 h-full w-[3px]"
                style={{ background: 'var(--lol-gold)' }}
                transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              />
            )}
            <CategoryGlyph
              slug={entry.slug}
              color={isActive ? 'var(--lol-gold)' : 'var(--lol-text-secondary)'}
            />
            <span
              className={`flex-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              }`}
            >
              {entry.label}
            </span>
            {c && c.total > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-[var(--lol-text-muted)]">
                {c.done}/{c.total}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
