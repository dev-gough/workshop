'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Users, X } from 'lucide-react';
import { ChallengeToken, PointsCorner } from './token';
import {
  ALL_TIERS, tierVar, stripHtml, progressFraction, progressLabel, pctLabel,
  type ChallengeNode,
} from './types';

const KIND_LABEL: Record<ChallengeNode['kind'], string> = {
  category: 'Category', capstone: 'Capstone', group: 'Group', challenge: 'Challenge',
};

const CARD_W = 340;
const GAP = 12;

/**
 * The rarity curve: what share of players ended up at each tier.
 *
 * Deliberately a linear scale. The distribution is genuinely lopsided — Iron
 * holds ~28% of players and Challenger ~0% — and squashing it with a log axis
 * to make the tail visible would flatter the rare tiers into looking common.
 * The near-empty right-hand side IS the information.
 */
function RarityChart({ node }: { node: ChallengeNode }) {
  const vals = ALL_TIERS.map((t) => node.percentiles[t] ?? 0);
  const max = Math.max(...vals);
  if (max <= 0) return null;

  return (
    <div className="flex h-12 items-end gap-[3px]" aria-hidden>
      {ALL_TIERS.map((t, i) => {
        const v = vals[i];
        const isCurrent = t === node.level;
        return (
          <div
            key={t}
            title={`${t}: ${pctLabel(v) ?? '0%'}`}
            className="relative flex-1 transition-opacity"
            style={{
              // A 2px stub keeps a real-but-tiny share visible as a mark rather
              // than vanishing into the axis — a true zero still renders empty.
              height: v > 0 ? `${Math.max(8, (v / max) * 100)}%` : 1,
              background: tierVar(t),
              opacity: isCurrent ? 1 : 0.4,
              boxShadow: isCurrent ? `0 0 6px ${tierVar(t)}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** Positions the card beside its anchor, flipping before it leaves the viewport. */
function place(rect: DOMRect) {
  const spaceRight = window.innerWidth - rect.right;
  const left = spaceRight > CARD_W + GAP
    ? rect.right + GAP
    : Math.max(GAP, rect.left - CARD_W - GAP);
  // Vertically centre on the anchor, then clamp to the window.
  const top = Math.min(
    Math.max(GAP, rect.top + rect.height / 2 - 150),
    window.innerHeight - 340
  );
  return { left, top };
}

/**
 * The card's contents, shared by the pointer-anchored card and the tap sheet.
 * Splitting only the chrome means touch and pointer can never drift apart.
 */
function DetailBody({ node, inset = false }: { node: ChallengeNode; inset?: boolean }) {
  const frac = progressFraction(node);
  const earned = pctLabel(node.percentiles[node.level]);
  const desc = stripHtml(node.description || node.shortDescription);
  const titleTier = Object.keys(node.rewards).find((t) => node.rewards[t]?.length);

  return (
    <>
      <PointsCorner node={node} />

      <div className="flex items-start gap-3 p-3 pl-4">
        <ChallengeToken node={node} size={56} />
        <div className="min-w-0 flex-1 pt-1">
          {/* `inset` reserves room for the sheet's close button, which would
              otherwise land on top of the kind label. */}
          <div className={`flex items-start justify-between gap-2 ${inset ? 'pr-6' : ''}`}>
            <p className="truncate text-sm font-semibold uppercase tracking-wide text-foreground">
              {node.name}
            </p>
            <span className="flex-shrink-0 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {KIND_LABEL[node.kind]}
            </span>
          </div>
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: tierVar(node.level) }}
          >
            {node.level === 'NONE' ? 'Unranked' : node.level}
          </p>
          {earned && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] italic text-muted-foreground">
              <Users className="h-3 w-3" /> {earned} of players earned
            </p>
          )}
        </div>
      </div>

      {desc && (
        <p className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      )}

      <div className="px-4 pb-3">
        <div className="lol-bar-track relative h-5 overflow-hidden">
          <div
            className="lol-bar-fill absolute inset-y-0 left-0"
            style={{ width: `${frac * 100}%`, transition: 'width 700ms ease-out' }}
          />
          <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums text-foreground">
            {progressLabel(node)}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Players by tier
        </p>
        <RarityChart node={node} />
      </div>

      {(node.nextPoints !== null || titleTier) && (
        <div className="border-t border-border px-4 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Next level rewards
          </p>
          {node.nextPoints !== null && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Award className="h-3 w-3 text-primary" />
              <span className="font-mono tabular-nums text-foreground">{node.nextPoints}</span>
              {node.kind === 'challenge' ? 'Group Progress' : 'Capstone Progress'}
            </p>
          )}
          {/* Riot ships title rewards as a bare UUID with no display string
              anywhere in the manifests, so we name the tier that unlocks it
              rather than guessing at the title itself. */}
          {titleTier && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Award className="h-3 w-3" style={{ color: tierVar(titleTier) }} />
              Title at
              <span style={{ color: tierVar(titleTier) }}>{titleTier}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** True once mounted on the client — portals need a real document. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Pointer-device presentation: a card anchored beside whatever is hovered.
 *
 * `lol-theme` is repeated on the portal root. The card is portaled to
 * document.body to escape transformed ancestors that would otherwise capture
 * its `position: fixed` — which also takes it outside the page's theme scope,
 * where every --lol-* variable would resolve to nothing.
 */
export function ChallengeHoverCard({ node, rect }: { node: ChallengeNode; rect: DOMRect }) {
  if (!useMounted()) return null;
  const { left, top } = place(rect);
  return createPortal(
    <div
      className="lol-theme lol-plate lol-plate-gold pointer-events-none fixed z-50 shadow-2xl"
      style={{ left, top, width: CARD_W }}
      role="tooltip"
    >
      <DetailBody node={node} />
    </div>,
    document.body
  );
}

/**
 * Touch presentation: the same content as a dismissible sheet.
 *
 * Touch devices have no hover, so without this the rarity curve, description
 * and rewards would simply be unreachable on a phone. Sits at the bottom of
 * the viewport on narrow screens (within thumb reach) and centres on larger
 * ones, where it doubles as a way to pin a card open with a click.
 */
export function ChallengeDetailSheet({
  node, onClose,
}: { node: ChallengeNode; onClose: () => void }) {
  const mounted = useMounted();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="lol-theme fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={node.name}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="lol-plate lol-plate-gold relative max-h-[85vh] w-full max-w-[400px] overflow-y-auto shadow-2xl sm:w-[400px]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-20 p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <DetailBody node={node} inset />
      </div>
    </div>,
    document.body
  );
}
