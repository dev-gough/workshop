'use client';

// The timing tower: live standings for the running heat, one row per car
// worth watching. Click a row to put that car on the brain monitor.

import type { Retirement } from '../_lib/engine';

export interface TowerRow {
  id: number;
  metres: number;
  laps: number;
  gap: number;
  alive: boolean;
  out: Retirement;
}

interface Props {
  rows: TowerRow[];
  tick: number;
  budget: number;
  recordLive: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Focus float: fewer rows, no header chrome. */
  compact?: boolean;
}

function fmtM(m: number): string {
  return `${Math.round(m)} m`;
}

export default function Tower({ rows, tick, budget, recordLive, selectedId, onSelect, compact }: Props) {
  const shown = rows.slice(0, compact ? 5 : 10);
  const selIdx = selectedId === null ? -1 : rows.findIndex(r => r.id === selectedId);
  const extra = selIdx >= shown.length ? rows[selIdx] : null;

  const row = (r: TowerRow, pos: number) => {
    const isP1 = pos === 1;
    const led = !r.alive
      ? r.out === 'wall' ? 'var(--drs-crash)' : 'var(--drs-faint)'
      : isP1 ? (recordLive ? 'var(--drs-purple)' : 'var(--drs-flag)') : 'var(--drs-lit-field)';
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => onSelect(selectedId === r.id ? null : r.id)}
        data-sel={selectedId === r.id}
        className="grid w-full grid-cols-[26px_30px_1fr_auto] items-baseline gap-1.5 border-l-2 px-1.5 py-[3px] text-left transition-colors hover:bg-muted/60 data-[sel=true]:bg-muted"
        style={{
          borderLeftColor: isP1 ? (recordLive ? 'var(--drs-purple)' : 'var(--drs-flag)') : 'transparent',
        }}
      >
        <span className="drs-display text-[9px] leading-none" style={{ color: isP1 ? (recordLive ? 'var(--drs-purple)' : 'var(--drs-flag)') : 'var(--drs-dim)' }}>
          P{pos}
        </span>
        <span className="drs-readout text-[10px] text-muted-foreground">
          {String(r.id + 1).padStart(2, '0')}
        </span>
        <span className="drs-readout flex items-baseline gap-1.5 text-[10px] text-foreground">
          {fmtM(r.metres)}
          {r.laps >= 1 && (
            <span className="text-[8px] text-muted-foreground">L{Math.floor(r.laps)}</span>
          )}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="drs-readout text-[9px] text-muted-foreground">
            {!r.alive
              ? r.out === 'wall' ? 'wall' : 'stall'
              : pos === 1 ? 'leader' : `−${fmtM(r.gap)}`}
          </span>
          <span
            className="inline-block h-[5px] w-[5px] shrink-0 self-center rounded-[1px]"
            style={{ background: led, opacity: r.alive ? 1 : 0.55 }}
          />
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      {!compact && (
        <div className="flex items-baseline justify-between border-b border-border px-1.5 pb-1.5">
          <span className="drs-etch">Timing</span>
          <span className="drs-readout text-[9px] text-muted-foreground">
            flag in {Math.max(0, budget - tick).toLocaleString()} t
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        {shown.map((r, i) => row(r, i + 1))}
        {extra && (
          <>
            <div className="mx-1.5 my-0.5 border-t border-dashed border-border" />
            {row(extra, selIdx + 1)}
          </>
        )}
      </div>
    </div>
  );
}
