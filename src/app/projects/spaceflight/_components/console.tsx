'use client';

// The non-chart instruments of the firing room: vehicle consoles, the
// next-launch countdown, the launch log, and the mode pushbuttons.

import { useEffect, useState } from 'react';
import {
  VEHICLE_COLOR,
  countedKg,
  fmtTonnes,
  isEstimate,
  type Accounting,
  type Launch,
  type Mode,
  type UpcomingLaunch,
  type Vehicle,
  type VehicleStats,
} from '../_lib/model';

// ── Vehicle console ─────────────────────────────────────────────────────────

function Spark({ yearly, color }: { yearly: VehicleStats['yearly']; color: string }) {
  const W = 132;
  const H = 26;
  const max = Math.max(...yearly.map((d) => d.tonnes), 0.001);
  const slot = W / yearly.length;
  const barW = Math.max(Math.min(slot - 2, 8), 1.5);
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      {yearly.map((d, i) => {
        const h = d.tonnes > 0 ? Math.max((d.tonnes / max) * (H - 2), 1.5) : 0;
        return h > 0 ? (
          <rect
            key={d.year}
            x={i * slot + (slot - barW) / 2}
            y={H - h}
            width={barW}
            height={h}
            rx={1}
            fill={color}
            opacity={0.85}
          />
        ) : null;
      })}
    </svg>
  );
}

export function VehicleConsole({ s, mode }: { s: VehicleStats; mode: Mode }) {
  const color = VEHICLE_COLOR[s.vehicle as Vehicle];
  return (
    <div className="sf-console p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
          <span className="sf-etch !text-foreground">{s.vehicle}</span>
        </span>
        <span
          className="flex items-center gap-1.5 text-[10px]"
          style={{ color: s.active ? 'var(--sf-green)' : 'var(--sf-faint)' }}
        >
          <span className="sf-led" data-live={s.active} style={{ background: 'currentcolor' }} />
          {s.active ? 'ACTIVE' : 'RETIRED'}
        </span>
      </div>

      <p className="sf-readout mt-3 text-3xl font-semibold tracking-tight" style={{ color }}>
        {fmtTonnes(s.tonnes)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {mode === 'delivered' ? 'to orbit' : 'launched'} · {s.firstYear}–
        {s.active ? 'present' : s.lastYear}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
        {[
          ['Flights', String(s.flights)],
          ['t / flight', s.tPerFlight >= 0.05 ? s.tPerFlight.toFixed(1) : '0'],
          ['Years op', s.years.toFixed(1)],
          ['t / year', s.tPerYear >= 0.05 ? Math.round(s.tPerYear).toLocaleString('en-US') : '0'],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="sf-etch">{k}</p>
            <p className="sf-readout mt-0.5 text-sm text-foreground">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-border pt-2.5">
        <p className="sf-etch">By year</p>
        <Spark yearly={s.yearly} color={color} />
      </div>
    </div>
  );
}

// ── Countdown ───────────────────────────────────────────────────────────────

function fmtCountdown(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `T-${d}d ${hh}:${mm}:${ss}` : `T-${hh}:${mm}:${ss}`;
}

export function Countdown({ next }: { next: UpcomingLaunch | null }) {
  // Ticks only after mount so server and first client render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!next) {
    return (
      <div className="sf-console px-4 py-3">
        <p className="sf-etch">Next launch</p>
        <p className="mt-1 text-[11px] text-muted-foreground">No launch on the range</p>
      </div>
    );
  }

  const go = next.status === 'Go';
  const netMs = new Date(next.net).getTime();
  return (
    <div className="sf-console px-4 py-3">
      <div className="flex items-center justify-between gap-6">
        <p className="sf-etch">Next launch</p>
        <span
          className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em]"
          style={{ color: go ? 'var(--sf-green)' : 'var(--sf-amber)' }}
        >
          <span className="sf-led" data-live={go} style={{ background: 'currentcolor' }} />
          {go ? 'GO' : next.status.toUpperCase()}
        </span>
      </div>
      <p className="sf-readout mt-1.5 text-2xl font-semibold text-foreground">
        {now === null ? 'T-··:··:··' : fmtCountdown(netMs - now)}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground" title={next.name}>
        {next.mission_name ?? next.name}
        {next.pad_location ? ` · ${next.pad_location}` : ''}
      </p>
    </div>
  );
}

// ── Launch log ──────────────────────────────────────────────────────────────

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  Success: { glyph: '▲', color: 'var(--sf-green)' },
  'Partial Failure': { glyph: '◭', color: 'var(--sf-amber)' },
  Failure: { glyph: '▽', color: 'var(--sf-red)' },
};

export function LaunchLog({
  launches,
  mode,
  acct,
  limit,
}: {
  launches: Launch[];
  mode: Mode;
  acct: Accounting;
  /** cap the list (homepage-style excerpt); omitted = every flight in window */
  limit?: number;
}) {
  const recent = (limit ? launches.slice(-limit) : launches).slice().reverse();
  return (
    <ul className="space-y-0">
      {recent.map((l) => {
        const st = STATUS_GLYPH[l.status] ?? { glyph: '·', color: 'var(--sf-faint)' };
        const t = countedKg(l, mode, acct) / 1000;
        return (
          <li
            key={l.ll2_id}
            className="flex items-center gap-2.5 border-b border-border py-2 text-[11px] last:border-b-0"
            title={l.mass_note ?? undefined}
          >
            <span className="sf-readout w-[76px] shrink-0 text-muted-foreground">
              {new Date(l.net).toLocaleDateString('en-US', {
                year: '2-digit',
                month: 'short',
                day: '2-digit',
              })}
            </span>
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: VEHICLE_COLOR[l.vehicle as Vehicle] ?? 'var(--sf-faint)' }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {l.mission_name ?? l.name}
            </span>
            <span aria-label={l.status} style={{ color: st.color }}>
              {st.glyph}
            </span>
            <span className="sf-readout w-[64px] shrink-0 text-right text-muted-foreground">
              {t > 0 ? `${isEstimate(l) ? '~' : ''}${fmtTonnes(t)}` : '0'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
