'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  type Analysis, type Leaf, BRACKETS, fmtMult,
} from '../_lib/model';

// ── A conic donut ring with the item's glyph in the middle. The ring fill
//    shows that thing's share of your total damage multiplier. ──────────────
export function Ring({ percent, color, emoji, size = 46 }: {
  percent: number; color: string; emoji: string; size?: number;
}) {
  const stroke = size < 40 ? 3.5 : 4.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--color-border)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - p / 100) }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ fontSize: size * 0.42 }}
      >
        {emoji}
      </span>
    </div>
  );
}

// ── The hero: the molten impact multiplier. ───────────────────────────────
export function ImpactHero({ a }: { a: Analysis }) {
  return (
    <div className="mb-plate relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
      {/* faint radial heat behind the number */}
      <div className="pointer-events-none absolute -right-10 -top-14 h-52 w-52 rounded-full"
        style={{ background: 'radial-gradient(circle, var(--color-primary), transparent 68%)', opacity: 0.14 }} />
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
        Total damage output
      </p>
      <div className="mt-1 flex items-end gap-4">
        <div className="mb-readout mb-molten text-6xl font-bold leading-none sm:text-7xl">
          {fmtMult(a.total)}
        </div>
        <p className="mb-4 text-[11px] leading-tight text-muted-foreground">
          vs a bare run with<br />no items or stats
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-3">
        <Stat label="Per hit" value={fmtMult(a.perHit)} />
        <Stat label={a.mode === 'dps' ? 'With attack speed' : 'Attack speed off'}
          value={a.mode === 'dps' ? fmtMult(a.total) : '—'} muted={a.mode !== 'dps'} />
        <Stat label="Active brackets" value={String(a.brackets.filter(b => b.factor > 1).length)} />
        <Stat label="Contributors" value={String(a.leaves.length)} />
      </div>
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className={`mb-readout text-lg font-semibold leading-none ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// ── The headline: a chunky 100%-stacked "damage bar". Each thing's width is
//    its fair share of the final multiplier. ────────────────────────────────
export function DamageBar({ a }: { a: Analysis }) {
  const [hover, setHover] = useState<string | null>(null);
  const leaves = a.leaves.filter(l => l.percent > 0.05);
  return (
    <div className="mb-plate px-4 py-4 sm:px-5">
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Share of your damage multiplier
        </p>
        <p className="text-[10px] text-muted-foreground">sums to 100%</p>
      </div>
      <div className="flex h-11 w-full overflow-hidden rounded-md ring-1 ring-border"
        onMouseLeave={() => setHover(null)}>
        {leaves.map(l => {
          const color = BRACKETS[l.bracket].color;
          const dim = hover && hover !== l.id;
          return (
            <motion.div
              key={l.id}
              layout
              onMouseEnter={() => setHover(l.id)}
              title={`${l.label} — ${l.percent.toFixed(1)}%`}
              className="relative flex items-center justify-center border-r border-black/15 last:border-r-0"
              style={{
                width: `${l.percent}%`,
                background: color,
                opacity: dim ? 0.4 : 1,
                transition: 'opacity 140ms ease',
              }}
            >
              {l.percent > 7 && (
                <span className="select-none text-[13px] drop-shadow-sm">{l.emoji}</span>
              )}
            </motion.div>
          );
        })}
      </div>
      {/* hover readout */}
      <div className="mt-2 h-4 text-[11px]">
        {hover ? (() => {
          const l = a.leaves.find(x => x.id === hover)!;
          return (
            <span className="text-muted-foreground">
              <span style={{ color: BRACKETS[l.bracket].color }}>■</span>{' '}
              <span className="font-medium text-foreground">{l.emoji} {l.label}</span>
              {' · '}{l.percent.toFixed(1)}% of your damage
              {' · '}<span className="text-muted-foreground">{BRACKETS[l.bracket].name} bracket</span>
            </span>
          );
        })() : (
          <span className="text-muted-foreground">Hover a segment for detail.</span>
        )}
      </div>
    </div>
  );
}

// ── The per-thing breakdown: ring + name + mini-bar + marginal. ────────────
export function ContributionList({ a }: { a: Analysis }) {
  const max = a.leaves[0]?.percent ?? 1;
  return (
    <div className="mb-plate divide-y divide-border/70">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          What&apos;s carrying your build
        </p>
        <p className="text-[10px] text-muted-foreground">−% = DPS lost if removed</p>
      </div>
      {a.leaves.map(l => <Row key={l.id} l={l} max={max} />)}
      {a.leaves.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing enabled yet — toggle some items on the right.
        </p>
      )}
    </div>
  );
}

function Row({ l, max }: { l: Leaf; max: number }) {
  const color = BRACKETS[l.bracket].color;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Ring percent={l.percent} color={color} emoji={l.emoji} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">{l.label}</span>
          <span className="mb-readout shrink-0 text-sm font-bold" style={{ color }}>
            {l.percent.toFixed(1)}%
          </span>
        </div>
        {/* comparable mini-bar, scaled to the top contributor */}
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={false}
            animate={{ width: `${max > 0 ? (l.percent / max) * 100 : 0}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">{l.detail}</span>
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
            −{l.marginal.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ── The teaching panel: brackets multiply. 1 × F1 × F2 × … = total. ───────
export function BracketLadder({ a }: { a: Analysis }) {
  const active = a.brackets.filter(b => b.factor > 1).sort((x, y) => y.factor - x.factor);
  return (
    <div className="mb-plate px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Why it multiplies
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Bonuses inside a bracket add; brackets then multiply each other. Spreading
        damage across many brackets beats piling into one.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mb-readout rounded-md bg-muted px-2 py-1 text-sm font-semibold">1.00×</span>
        {active.map(b => (
          <span key={b.id} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">×</span>
            <span
              className="mb-readout rounded-md px-2 py-1 text-sm font-semibold"
              style={{ background: `${BRACKETS[b.id].color}22`, color: BRACKETS[b.id].color }}
              title={`${BRACKETS[b.id].name} — ${BRACKETS[b.id].blurb}`}
            >
              {b.factor.toFixed(2)}×
            </span>
          </span>
        ))}
        <span className="text-muted-foreground">=</span>
        <span className="mb-readout mb-molten rounded-md px-2 py-1 text-base font-bold">
          {fmtMult(a.total)}
        </span>
      </div>
    </div>
  );
}
