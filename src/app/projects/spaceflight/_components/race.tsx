'use client';

// The Time Machine: a replayable leaderboard of cumulative tonnage. Scrub
// the year or press play in 1957 and watch families overtake each other for
// seven decades. Standings follow whatever counting mode / accounting basis
// the tracking console has dialed in.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  familyColor,
  familyLabel,
  fmtTonnes,
  yearValue,
  type Accounting,
  type Mode,
  type WorldFamily,
} from '../_lib/model';

const TOP_N = 12;
const TICK_MS = 160;

// One-line captions that anchor the replay in history; the latest one at or
// before the scrub year is shown under the readout.
const MILESTONES: Array<[number, string]> = [
  [1957, 'Sputnik opens the ledger'],
  [1961, 'Gagarin orbits'],
  [1969, 'Apollo 11 lands'],
  [1971, 'Salyut 1, first station'],
  [1981, 'Columbia flies — the orbiter weighs in'],
  [1986, 'Mir core module'],
  [1998, 'ISS assembly begins'],
  [2010, 'Falcon 9 debuts'],
  [2015, 'First booster landing'],
  [2019, 'Starlink begins stacking'],
  [2024, 'Starship reaches the ledger'],
];

export function TimeMachine({
  families,
  mode,
  acct,
  colors,
  minYear,
  maxYear,
}: {
  families: WorldFamily[];
  mode: Mode;
  acct: Accounting;
  colors: Map<string, string>;
  minYear: number;
  maxYear: number;
}) {
  const nYears = maxYear - minYear + 1;
  const [yiRaw, setYi] = useState(nYears - 1); // start at the present
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // When the console re-winds the window, snap the replay to the new end —
  // and clamp for the render in between, so a shrunken window never reads
  // beyond its own years.
  const yi = Math.min(yiRaw, nYears - 1);
  useEffect(() => {
    setYi(nYears - 1);
    setPlaying(false);
  }, [minYear, maxYear, nYears]);

  // Prefix sums per family: cum[k] = tonnes through year minYear+k. Also the
  // world total + flight count per year for the subline.
  const { cum, totals } = useMemo(() => {
    const cum = new Map<string, Float64Array>();
    const totals = { t: new Float64Array(nYears), n: new Float64Array(nYears) };
    for (const f of families) {
      const arr = new Float64Array(nYears);
      for (const r of f.yearly) {
        if (r.y < minYear || r.y > maxYear) continue;
        arr[r.y - minYear] += yearValue(r, mode, acct);
        totals.n[r.y - minYear] += r.n;
      }
      for (let i = 1; i < nYears; i++) arr[i] += arr[i - 1];
      for (let i = 0; i < nYears; i++) totals.t[i] += arr[i] - (i > 0 ? arr[i - 1] : 0);
      cum.set(f.key, arr);
    }
    for (let i = 1; i < nYears; i++) {
      totals.t[i] += totals.t[i - 1];
      totals.n[i] += totals.n[i - 1];
    }
    return { cum, totals };
  }, [families, mode, acct, minYear, maxYear, nYears]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setYi((v) => {
        if (v >= nYears - 1) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, nYears]);

  const year = minYear + yi;
  const rows = useMemo(() => {
    return families
      .map((f) => ({ f, v: cum.get(f.key)![yi] }))
      .filter((r) => r.v > 0.05)
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP_N);
  }, [families, cum, yi]);
  const maxV = rows[0]?.v ?? 1;

  const milestone = MILESTONES.filter(([y]) => y <= year).at(-1);

  const scrubTo = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const f = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    setYi(Math.round(f * (nYears - 1)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-[240px] flex-1">
          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={() => {
                if (!playing && yi >= nYears - 1) setYi(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? 'Pause replay' : 'Play replay from the beginning'}
              data-on={playing}
              className="sf-chip flex h-8 w-8 shrink-0 items-center justify-center text-[11px]"
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <div
              ref={trackRef}
              role="slider"
              aria-label="Replay year"
              aria-valuemin={minYear}
              aria-valuemax={maxYear}
              aria-valuenow={year}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setYi((v) => Math.max(v - 1, 0));
                if (e.key === 'ArrowRight') setYi((v) => Math.min(v + 1, nYears - 1));
              }}
              onPointerDown={(e) => {
                setPlaying(false);
                scrubTo(e.clientX);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.buttons > 0) scrubTo(e.clientX);
              }}
              className="relative h-8 w-full cursor-pointer touch-none select-none"
            >
              <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted" />
              <div
                className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                style={{ width: `${(yi / (nYears - 1)) * 100}%`, background: 'var(--sf-amber)' }}
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border"
                style={{
                  left: `${(yi / (nYears - 1)) * 100}%`,
                  background: 'var(--sf-raise)',
                  borderColor: 'var(--sf-amber)',
                }}
              />
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="sf-readout text-5xl font-semibold tracking-tight text-primary tabular-nums">
            {year}
          </p>
          <p className="sf-readout mt-0.5 text-[11px] text-muted-foreground">
            {fmtTonnes(totals.t[yi])} · {Math.round(totals.n[yi]).toLocaleString('en-US')} launches
          </p>
          {milestone && (
            <p className="mt-0.5 text-[10px] text-muted-foreground" style={{ color: 'var(--sf-amber)' }}>
              {milestone[0]} — {milestone[1]}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {rows.map(({ f, v }, i) => (
          <motion.div
            key={f.key}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="grid h-6 grid-cols-[20px_minmax(96px,150px)_1fr_76px] items-center gap-2"
          >
            <span className="sf-readout text-[10px] text-muted-foreground">{i + 1}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: familyColor(f, colors) }}
              />
              <span className="truncate">{familyLabel(f.key)}</span>
            </span>
            <div className="relative h-2.5 overflow-hidden rounded-[2px] bg-muted">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-[2px]"
                animate={{ width: `${Math.max((v / maxV) * 100, 0.8)}%` }}
                transition={{ duration: TICK_MS / 1000, ease: 'linear' }}
                style={{ background: familyColor(f, colors) }}
              />
            </div>
            <span className="sf-readout text-right text-[11px] text-foreground tabular-nums">
              {fmtTonnes(v)}
            </span>
          </motion.div>
        ))}
        {rows.length === 0 && (
          <p className="py-4 text-center text-[11px] text-muted-foreground">
            Nothing on orbit yet — press play.
          </p>
        )}
      </div>
    </div>
  );
}
