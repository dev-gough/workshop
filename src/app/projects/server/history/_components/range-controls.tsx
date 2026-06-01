'use client';

import { RotateCcw } from 'lucide-react';

const PRESETS = [
  { label: '1h',  secs: 3600 },
  { label: '6h',  secs: 21600 },
  { label: '24h', secs: 86400 },
  { label: '7d',  secs: 604800 },
  { label: '30d', secs: 2592000 },
] as const;

interface RangeControlsProps {
  fromMs: number;
  toMs: number;
  onPreset: (secs: number) => void;
  onReset: () => void;
  bucketSec?: number;
}

export default function RangeControls({ fromMs, toMs, onPreset, onReset, bucketSec }: RangeControlsProps) {
  const windowSec = Math.round((toMs - fromMs) / 1000);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-[3px] border border-[color:var(--cc-border)] bg-[color:var(--cc-card)] p-0.5 shadow-[inset_0_1px_0_hsl(220_30%_22%/0.5)]">
        {PRESETS.map((p) => {
          const active = Math.abs(windowSec - p.secs) / p.secs < 0.05;
          return (
            <button
              key={p.label}
              onClick={() => onPreset(p.secs)}
              className={`px-3 py-1 text-[11px] font-mono uppercase tracking-[0.2em] rounded-[2px] transition-all ${
                active
                  ? 'text-[color:var(--cc-cyan)] bg-[color:color-mix(in_srgb,var(--cc-cyan)_12%,transparent)]'
                  : 'text-[color:var(--cc-muted)] hover:text-[color:var(--cc-text)]'
              }`}
              style={active ? { boxShadow: '0 0 12px color-mix(in srgb, var(--cc-cyan) 22%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--cc-cyan) 40%, transparent)' } : undefined}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <button
        onClick={onReset}
        title="Reset to last hour, live"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.2em] rounded-[3px] border border-[color:var(--cc-border)] bg-[color:var(--cc-card)] text-[color:var(--cc-muted)] hover:text-[color:var(--cc-text)] hover:border-[color:var(--cc-cyan-deep)] transition-colors"
      >
        <RotateCcw className="h-3 w-3" /> Reset
      </button>
      <div className="ml-auto flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--cc-dim)] tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="text-[color:var(--cc-muted)]">FROM</span>
          <span className="text-[color:var(--cc-cyan)]">{new Date(fromMs).toISOString().replace('T', ' ').slice(0, 19)}</span>
        </span>
        <span className="text-[color:var(--cc-muted)]">→</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[color:var(--cc-muted)]">TO</span>
          <span className="text-[color:var(--cc-cyan)]">{new Date(toMs).toISOString().replace('T', ' ').slice(0, 19)}</span>
        </span>
        {bucketSec != null && (
          <span className="flex items-center gap-1.5">
            <span className="text-[color:var(--cc-muted)]">BUCKET</span>
            <span className="text-[color:var(--cc-amber)]">
              {bucketSec < 60 ? `${bucketSec}s` : bucketSec < 3600 ? `${Math.round(bucketSec / 60)}m` : `${Math.round(bucketSec / 3600)}h`}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
