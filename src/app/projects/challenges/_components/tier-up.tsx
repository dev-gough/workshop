'use client';

/**
 * RM 04 — Tier-up herald.
 *
 * The room's one celebratory surface: when a challenge crosses a tier
 * boundary, a plate slides into the corner carrying the new token, the tier it
 * came from, and the tier it landed on.
 *
 * Tier-ups are detected by the background poller, not by anything the user does
 * here, so "when it happens" is really "since you last looked". A localStorage
 * watermark carries the newest tracked game the browser has already celebrated;
 * everything newer than that gets heralded exactly once, then the watermark
 * advances. A browser with no watermark at all is a first visit — it seeds
 * silently rather than replaying the whole account in confetti.
 *
 * Palette is the `.lol-theme` tier ramp read through `tierVar()`; the plate
 * chrome is the room's own `lol-plate`. Portaled to document.body (and so
 * re-scoped with `lol-theme`, same as the hover card) to escape the transformed
 * ancestors the page is full of.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, X } from 'lucide-react';
import { tokenIconPath } from '@/lib/cdragon';
import { ChallengeToken } from './token';
import { pctLabel, tierVar, timeAgo, type ChallengeNode } from './types';

// ── Constants ──────────────────────────────────────────

const WATERMARK_KEY = 'lol:tierups:seen';
/** Heralded one by one; anything older than this collapses into the tally. */
const HERALD_LIMIT = 5;
/** How many plates share the corner before the rest wait their turn. */
const STACK_MAX = 3;
const DWELL_MS = 16000;
const STAGGER_MS = 420;

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 24 };

export interface TierUpEvent {
  challengeId: number;
  name: string;
  oldLevel: string;
  newLevel: string;
  newValue: number;
  at: number;
  matchId: string | null;
  champion: string | null;
}

const keyOf = (e: TierUpEvent) => `${e.matchId ?? e.at}:${e.challengeId}`;

// ── Watermark ──────────────────────────────────────────
// Wrapped because localStorage throws outright in some privacy modes, and a
// celebration is never worth taking the page down for.

function readWatermark(): number | null {
  try {
    const raw = window.localStorage.getItem(WATERMARK_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeWatermark(ts: number) {
  try {
    window.localStorage.setItem(WATERMARK_KEY, String(ts));
  } catch {
    /* ignore — worst case the same tier-up is heralded again next visit */
  }
}

// ── Feed ───────────────────────────────────────────────

/**
 * Fetches whatever has tiered up since the watermark and advances it.
 *
 * Re-runs when `pulse` changes, which the page bumps after a manual sync — a
 * sync that pulls in a fresh game should herald it rather than making the user
 * reload. The watermark makes that idempotent: a second look finds nothing.
 */
function useTierUpFeed(ready: boolean, pulse: number) {
  const [batch, setBatch] = useState<{ events: TierUpEvent[]; overflow: number } | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const since = readWatermark();
    const url = since === null ? '/api/challenges/tierups' : `/api/challenges/tierups?since=${since}`;

    fetch(url)
      .then((r) => r.json())
      .then((d: { newest?: number | null; events?: TierUpEvent[] }) => {
        if (cancelled) return;
        if (typeof d.newest === 'number') writeWatermark(d.newest);
        const events = Array.isArray(d.events) ? d.events : [];
        if (events.length === 0) return;
        // The API returns newest-first. Herald oldest-first so a batch reads up
        // the stack in the order it actually happened.
        const shown = events.slice(0, HERALD_LIMIT).reverse();
        setBatch({ events: shown, overflow: events.length - shown.length });
      })
      .catch((e) => console.error('Failed to load tier-ups:', e));

    return () => { cancelled = true; };
  }, [ready, pulse]);

  return batch;
}

/** True when the visitor has asked for less movement. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

// ── Pieces ─────────────────────────────────────────────

function TierPip({ tier, dim = false }: { tier: string; dim?: boolean }) {
  const c = tierVar(tier);
  return (
    <span
      className="inline-flex items-center rounded-sm border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={{
        color: c,
        opacity: dim ? 0.55 : 1,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
      }}
    >
      {tier}
    </span>
  );
}

/**
 * One tier-up, announced.
 *
 * The token mounts with an empty ring and closes it on the next frame, which
 * hands the existing 700ms `stroke-dasharray` transition in `ChallengeToken`
 * the job of drawing the moment the tier was earned. Two rings bloom out behind
 * it in the new tier's colour; both are dropped under reduced motion.
 *
 * When the page can resolve the challenge, the plate itself is a button that
 * opens it (`onOpen`) — the X stays a separate control so dismissing never
 * navigates.
 */
function Herald({
  ev, node, onDismiss, onOpen, reduced,
}: {
  ev: TierUpEvent;
  node: ChallengeNode | undefined;
  onDismiss: () => void;
  onOpen?: () => void;
  reduced: boolean;
}) {
  const [ringFull, setRingFull] = useState(reduced);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DWELL_MS);
  const c = tierVar(ev.newLevel);

  useEffect(() => {
    if (reduced) return;
    const raf = requestAnimationFrame(() => setRingFull(true));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Dwell clock. Hovering banks the time left rather than restarting it, so
  // reading a plate can't cost you the one queued behind it.
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const t = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onDismiss]);

  // ChallengeToken reads only these four fields. Pinning value/nextThreshold to
  // a 0→1 pair drives the ring; the icon is the event's tier, which is not
  // necessarily the challenge's current one when replaying an older tier-up.
  const tokenNode = useMemo(
    () => ({
      ...(node ?? ({} as ChallengeNode)),
      level: ev.newLevel,
      icon: tokenIconPath(ev.challengeId, ev.newLevel),
      value: ringFull ? 1 : 0,
      nextThreshold: 1,
    }) as ChallengeNode,
    [node, ev.newLevel, ev.challengeId, ringFull]
  );

  const earned = pctLabel(node?.percentiles?.[ev.newLevel]);
  const name = node?.name || ev.name || `Challenge ${ev.challengeId}`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.18 } }}
      transition={SPRING}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="lol-plate lol-plate-gold pointer-events-auto relative w-[302px] overflow-hidden"
      style={{ boxShadow: `0 6px 28px rgba(0,0,0,0.55), 0 0 22px color-mix(in srgb, ${c} 18%, transparent)` }}
      role="status"
      aria-live="polite"
    >
      {/* Tier rail */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c }} />

      {/* One pass of light across the plate as it lands. */}
      {!reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/3"
          initial={{ x: '-120%' }}
          animate={{ x: '420%' }}
          transition={{ duration: 1.1, ease: 'easeOut', delay: 0.15 }}
          style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${c} 16%, transparent), transparent)` }}
        />
      )}

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 z-10 p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>

      {(() => {
        const inner = (
          <>
            <div className="relative flex-shrink-0">
              {!reduced && [0, 0.22].map((delay) => (
                <motion.span
                  key={delay}
                  aria-hidden
                  className="absolute inset-0 rounded-full border"
                  style={{ borderColor: c }}
                  initial={{ scale: 0.6, opacity: 0.7 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ duration: 1.05, ease: 'easeOut', delay }}
                />
              ))}
              <motion.div
                initial={reduced ? false : { scale: 0.45, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ ...SPRING, delay: 0.05 }}
              >
                <ChallengeToken node={tokenNode} size={46} />
              </motion.div>
            </div>

            <div className="min-w-0 flex-1 pr-3">
              {/* Brass, not the tier colour: this label is the room's ceremonial
                  voice, and Iron/Bronze are too dim to carry it legibly. */}
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                Tier up
              </p>
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <TierPip tier={ev.oldLevel} dim />
                <ChevronRight className="h-3 w-3 flex-shrink-0" style={{ color: c }} />
                <TierPip tier={ev.newLevel} />
              </div>
              <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                {earned ? `${earned} of players earned · ` : ''}{timeAgo(ev.at)}
              </p>
            </div>
          </>
        );
        return onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title="View challenge"
            aria-label={`View challenge: ${name}`}
            className="flex w-full cursor-pointer items-center gap-3 py-3 pl-4 pr-3 text-left"
          >
            {inner}
          </button>
        ) : (
          <div className="flex items-center gap-3 py-3 pl-4 pr-3">{inner}</div>
        );
      })()}

      {/* Dwell bar — decoration for the clock above, and it stalls on hover too. */}
      <span
        aria-hidden
        className="lol-herald-dwell absolute bottom-0 left-0 h-[2px] w-full origin-left"
        style={{
          background: c,
          animationDuration: `${DWELL_MS}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </motion.div>
  );
}

// ── Component ──────────────────────────────────────────

/**
 * The corner stack. Mounted once at the page root so it heralds on whichever
 * tab is open, and renders nothing at all until there is something to say.
 */
export default function TierUpHerald({
  challenges, ready, pulse, onOpenHistory, onSelect,
}: {
  challenges: ChallengeNode[];
  ready: boolean;
  pulse: number;
  onOpenHistory: () => void;
  /** Open a challenge's detail sheet — clicking a plate shows what tiered up. */
  onSelect: (node: ChallengeNode) => void;
}) {
  const batch = useTierUpFeed(ready, pulse);
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [queue, setQueue] = useState<TierUpEvent[]>([]);
  const [live, setLive] = useState<TierUpEvent[]>([]);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!batch) return;
    setQueue((q) => [...q, ...batch.events]);
    setOverflow((n) => n + batch.overflow);
  }, [batch]);

  // Promote one plate at a time. Re-running on `live` gives the stagger for
  // free: each promotion schedules the next.
  useEffect(() => {
    if (queue.length === 0 || live.length >= STACK_MAX) return;
    const t = setTimeout(() => {
      setQueue((q) => q.slice(1));
      setLive((l) => [...l, queue[0]]);
    }, STAGGER_MS);
    return () => clearTimeout(t);
  }, [queue, live]);

  const byId = useMemo(() => {
    const m = new Map<number, ChallengeNode>();
    for (const c of challenges) m.set(c.challengeId, c);
    return m;
  }, [challenges]);

  const dismiss = useCallback((key: string) => {
    setLive((l) => l.filter((e) => keyOf(e) !== key));
  }, []);

  const idle = live.length === 0 && queue.length === 0;
  if (!mounted || idle) return null;

  return createPortal(
    <div className="lol-theme pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[302px] flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {live.map((ev) => {
          const node = byId.get(ev.challengeId);
          return (
            <Herald
              key={keyOf(ev)}
              ev={ev}
              node={node}
              reduced={reduced}
              onDismiss={() => dismiss(keyOf(ev))}
              onOpen={
                node
                  ? () => {
                      onSelect(node);
                      dismiss(keyOf(ev));
                    }
                  : undefined
              }
            />
          );
        })}
      </AnimatePresence>

      {overflow > 0 && (
        <motion.button
          layout
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={SPRING}
          onClick={() => { setOverflow(0); onOpenHistory(); }}
          className="lol-plate pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-primary"
        >
          +{overflow} earlier tier-up{overflow === 1 ? '' : 's'}
          <ChevronRight className="h-3 w-3" />
        </motion.button>
      )}
    </div>,
    document.body
  );
}
