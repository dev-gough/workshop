'use client';

// The tracking-parameters console: every dial that changes how the room
// weighs spaceflight. Counting mode (delivered/launched), accounting basis
// (payload / + spacecraft / + stages) and the year window all recompute the
// whole page instantly — no refetch.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RANGE_MIN, type Accounting, type Mode, type YearRange } from '../_lib/model';

function Chip({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="radio"
      aria-checked={on}
      data-on={on}
      onClick={onClick}
      className="sf-chip px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap"
    >
      {label}
    </button>
  );
}

const ACCT_HINT: Record<Accounting, string> = {
  payload: 'satellites, cargo & capsules only',
  craft: 'adds orbited spacecraft — Shuttle orbiters, Buran, Starship ships (GCAT convention)',
  stages: 'adds the upper stage each vehicle leaves in orbit (approx. dry mass)',
};

// ── Year brush ──────────────────────────────────────────────────────────────

function YearBrush({
  range,
  bounds,
  onChange,
}: {
  range: YearRange;
  bounds: YearRange;
  onChange: (r: YearRange) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const span = bounds[1] - bounds[0];

  const pct = (y: number) => ((y - bounds[0]) / span) * 100;
  const yearAt = useCallback(
    (clientX: number) => {
      const rect = ref.current!.getBoundingClientRect();
      const f = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return Math.round(bounds[0] + f * span);
    },
    [bounds, span]
  );

  const moveHandle = useCallback(
    (which: 0 | 1, y: number) => {
      const next: YearRange = [...range] as YearRange;
      next[which] = Math.min(Math.max(y, bounds[0]), bounds[1]);
      if (which === 0) next[0] = Math.min(next[0], range[1]);
      else next[1] = Math.max(next[1], range[0]);
      if (next[0] !== range[0] || next[1] !== range[1]) onChange(next);
    },
    [range, bounds, onChange]
  );

  useEffect(() => {
    if (drag === null) return;
    const onMove = (e: PointerEvent) => moveHandle(drag, yearAt(e.clientX));
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, moveHandle, yearAt]);

  const key = (which: 0 | 1) => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    moveHandle(which, range[which] + step);
  };

  return (
    <div
      ref={ref}
      className="relative h-8 w-full min-w-[180px] cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        const y = yearAt(e.clientX);
        // Grab whichever handle is nearer to the press.
        const which =
          Math.abs(y - range[0]) <= Math.abs(y - range[1]) ? 0 : 1;
        moveHandle(which, y);
        setDrag(which);
      }}
    >
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
        style={{
          left: `${pct(range[0])}%`,
          width: `${pct(range[1]) - pct(range[0])}%`,
          background: 'var(--sf-green)',
        }}
      />
      {([0, 1] as const).map((which) => (
        <button
          key={which}
          role="slider"
          aria-label={which === 0 ? 'Window start year' : 'Window end year'}
          aria-valuemin={bounds[0]}
          aria-valuemax={bounds[1]}
          aria-valuenow={range[which]}
          onKeyDown={key(which)}
          onPointerDown={(e) => {
            e.stopPropagation();
            setDrag(which);
          }}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border"
          style={{
            left: `${pct(range[which])}%`,
            background: 'var(--sf-raise)',
            borderColor: 'var(--sf-green)',
            boxShadow: drag === which ? '0 0 0 4px color-mix(in oklab, var(--sf-green) 25%, transparent)' : 'none',
          }}
        />
      ))}
    </div>
  );
}

// ── The console ─────────────────────────────────────────────────────────────

export function TrackingConsole({
  mode,
  onMode,
  acct,
  onAcct,
  range,
  onRange,
  maxYear,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  acct: Accounting;
  onAcct: (a: Accounting) => void;
  range: YearRange;
  onRange: (r: YearRange) => void;
  maxYear: number;
}) {
  const bounds: YearRange = [RANGE_MIN, maxYear];
  const presets: Array<[string, YearRange]> = [
    ['All', bounds],
    ['Space race', [1957, 1975]],
    ['Shuttle era', [1981, 2011]],
    ['Falcon era', [2010, maxYear]],
  ];

  return (
    <div className="sf-console mt-6 px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div role="radiogroup" aria-label="Counting mode">
          <p className="sf-etch">Counting</p>
          <div className="mt-2 flex gap-1.5">
            <Chip on={mode === 'delivered'} label="Delivered" onClick={() => onMode('delivered')} />
            <Chip on={mode === 'launched'} label="Launched" onClick={() => onMode('launched')} />
          </div>
        </div>

        <div role="radiogroup" aria-label="Accounting basis">
          <p className="sf-etch">Accounting</p>
          <div className="mt-2 flex gap-1.5">
            <Chip on={acct === 'payload'} label="Payload" onClick={() => onAcct('payload')} />
            <Chip on={acct === 'craft'} label="+ Spacecraft" onClick={() => onAcct('craft')} />
            <Chip on={acct === 'stages'} label="+ Stages" onClick={() => onAcct('stages')} />
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{ACCT_HINT[acct]}</p>
        </div>

        <div className="min-w-[240px] flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <p className="sf-etch">Window</p>
            <p className="sf-readout text-[11px] text-foreground">
              {range[0]} – {range[1] >= maxYear ? 'now' : range[1]}
            </p>
          </div>
          <YearBrush range={range} bounds={bounds} onChange={onRange} />
          <div className="flex flex-wrap gap-1.5">
            {presets.map(([label, r]) => (
              <Chip
                key={label}
                on={range[0] === r[0] && range[1] === r[1]}
                label={label}
                onClick={() => onRange(r)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
