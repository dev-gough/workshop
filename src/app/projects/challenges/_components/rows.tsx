'use client';

import { motion } from 'motion/react';
import { Medal } from 'lucide-react';
import { ChallengeToken, PointsCorner } from './token';
import {
  tierVar, stripHtml, progressFraction, progressLabel, type ChallengeNode,
} from './types';

export type HoverHandler = (node: ChallengeNode | null, rect?: DOMRect) => void;

/** Binds a node's hover card to an element without repeating the plumbing. */
function hoverProps(node: ChallengeNode, onHover: HoverHandler) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
      onHover(node, e.currentTarget.getBoundingClientRect()),
    onMouseLeave: () => onHover(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) =>
      onHover(node, e.currentTarget.getBoundingClientRect()),
    onBlur: () => onHover(null),
  };
}

/** The client's capstone glyph, recoloured via mask (see CategoryGlyph). */
export function CapstoneGlyph({ size = 16, color = 'var(--lol-gold)' }) {
  const url = 'url(/lol/challenge-shared/chrome/icon-capstone.svg)';
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

export function SectionHeading({ label, kind }: { label: string; kind: 'capstone' | 'group' }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {kind === 'capstone'
        ? <CapstoneGlyph size={20} />
        : <Medal className="h-5 w-5 text-primary" />}
      <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-foreground">{label}</h2>
      <span className="lol-rule" />
    </div>
  );
}

/** Recessed track + teal fill, with the value centred on top of it. */
export function ProgressBar({ node, height = 22 }: { node: ChallengeNode; height?: number }) {
  const frac = progressFraction(node);
  return (
    <div className="lol-bar-track relative overflow-hidden" style={{ height }}>
      <motion.div
        className="lol-bar-fill absolute inset-y-0 left-0"
        initial={{ width: 0 }}
        animate={{ width: `${frac * 100}%` }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums text-foreground">
        {progressLabel(node)}
      </span>
    </div>
  );
}

/**
 * A leaf challenge. The faceted per-tier plate behind it is the client's own
 * card art, which is what makes a grid of these read as a trophy shelf.
 */
export function ChallengeCard({ node, onHover }: { node: ChallengeNode; onHover: HoverHandler }) {
  const bg = `/lol/challenge-shared/card-bg/${(node.level || 'NONE').toLowerCase()}.png`;
  return (
    <motion.div
      {...hoverProps(node, onHover)}
      tabIndex={0}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="lol-plate relative flex flex-col items-center overflow-hidden px-3 pb-4 pt-6 outline-none focus-visible:border-[var(--lol-gold)]"
      style={{ borderColor: `color-mix(in srgb, ${tierVar(node.level)} 35%, var(--lol-border))` }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{ backgroundImage: `url(${bg})` }}
      />
      <PointsCorner node={node} />
      <ChallengeToken node={node} size={84} className="relative" />
      <p className="relative mt-3 text-center text-[13px] font-semibold leading-tight text-foreground">
        {node.name}
      </p>
      <p className="relative mt-1.5 text-center text-[11px] leading-snug text-muted-foreground">
        {stripHtml(node.shortDescription || node.description)}
      </p>
    </motion.div>
  );
}

/**
 * A group: one parent row with its leaf challenges laid out beneath it, inside
 * the same plate — the client treats the group and its children as one object.
 */
export function GroupRow({
  node, items, onHover,
}: { node: ChallengeNode; items: ChallengeNode[]; onHover: HoverHandler }) {
  return (
    <div id={`grp-${node.challengeId}`} className="lol-plate relative scroll-mt-20">
      <PointsCorner node={node} />
      <div className="flex items-center gap-5 p-5 pl-8">
        <div {...hoverProps(node, onHover)} tabIndex={0} className="outline-none">
          <ChallengeToken node={node} size={104} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Medal className="h-4 w-4 flex-shrink-0 text-primary" />
            <h3 className="truncate text-base font-bold uppercase tracking-[0.1em] text-foreground">
              {node.name}
            </h3>
          </div>
          <ProgressBar node={node} />
          {items.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Earn progress from the individual challenges below:
            </p>
          )}
        </div>
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((c) => (
            <ChallengeCard key={c.challengeId} node={c} onHover={onHover} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A capstone: rolls up several groups. Its children are shown as a strip of
 * tokens that jump to the group's own row rather than being expanded inline —
 * otherwise a single capstone would swallow the whole page.
 */
export function CapstoneRow({
  node, items, onHover, onJump,
}: {
  node: ChallengeNode;
  items: ChallengeNode[];
  onHover: HoverHandler;
  onJump: (id: number) => void;
}) {
  return (
    <div className="lol-plate relative">
      <PointsCorner node={node} />
      <div className="flex items-center gap-5 p-5 pl-8">
        <div {...hoverProps(node, onHover)} tabIndex={0} className="outline-none">
          <ChallengeToken node={node} size={116} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <CapstoneGlyph />
            <h3 className="truncate text-base font-bold uppercase tracking-[0.1em] text-foreground">
              {node.name}
            </h3>
          </div>
          <ProgressBar node={node} />
          {items.length > 0 && (
            <>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Earn progress from the challenge groups below:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.map((c) => (
                  <button
                    key={c.challengeId}
                    {...hoverProps(c, onHover)}
                    onClick={() => onJump(c.challengeId)}
                    title={c.name}
                    className="transition-transform hover:scale-110"
                  >
                    <ChallengeToken node={c} size={44} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
