'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pin, PinOff, ChevronDown, ChevronRight } from 'lucide-react';
import UplotChart from '@/components/charts/uplot-chart';
import Sparkline from '@/components/charts/sparkline';
import type { Series } from 'uplot';
import { useMetrics } from '../_lib/use-metrics';
import { formatBytes, formatPercent } from '../_lib/align';

interface ProcessExplorerProps {
  fromMs: number;
  toMs: number;
  onZoom: (fromUnix: number, toUnix: number) => void;
  onHover: (ts: number | null) => void;
}

type SortKey = 'cpu' | 'rss' | 'label';

interface Row {
  label: string;
  comm: string;
  pinned: boolean;
  curCpu: number;
  curRss: number;
  peakCpu: number;
  peakRss: number;
  xs: number[];
  cpuSeries: Array<number | null>;
  rssSeries: Array<number | null>;
}

export default function ProcessExplorer({ fromMs, toMs, onZoom, onHover }: ProcessExplorerProps) {
  const { data, loading } = useMetrics('process', fromMs, toMs, { maxPoints: 200 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [pinning, setPinning] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const label of Object.keys(data.series)) {
      const points = data.series[label];
      if (points.length === 0) continue;
      const xs = points.map((p) => Math.round(new Date(p.ts as string).getTime() / 1000));
      const cpuSeries = points.map((p) => typeof p.cpuPercent === 'number' ? p.cpuPercent : null);
      const rssSeries = points.map((p) => typeof p.rssBytes === 'number' ? p.rssBytes : null);
      const last = points[points.length - 1];
      const comm = (last.comm as string) ?? (last.label as string) ?? label;
      // pinned status is in the label endpoint, not here; approximate by checking if any point has pinned=true.
      // Better: read from a separate fetch. For now, infer via the conventional service names list.
      const pinned = isPinnedLabel(label);
      const curCpu = typeof last.cpuPercent === 'number' ? last.cpuPercent : 0;
      const curRss = typeof last.rssBytes === 'number' ? last.rssBytes : 0;
      const peakCpu = cpuSeries.reduce<number>((m, v) => v != null && v > m ? v : m, 0);
      const peakRss = rssSeries.reduce<number>((m, v) => v != null && v > m ? v : m, 0);
      out.push({ label, comm, pinned, curCpu, curRss, peakCpu, peakRss, xs, cpuSeries, rssSeries });
    }
    return out.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortKey === 'label') return a.label.localeCompare(b.label);
      if (sortKey === 'rss')   return b.curRss - a.curRss;
      return b.curCpu - a.curCpu;
    });
  }, [data, sortKey]);

  const togglePin = useCallback(async (row: Row) => {
    setPinning(row.label);
    try {
      if (row.pinned) {
        await fetch('/api/server/pins', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: row.label }) });
      } else {
        await fetch('/api/server/pins', { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: row.label, comm: row.comm }) });
      }
    } finally {
      setPinning(null);
    }
  }, []);

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-6 text-center text-sm text-muted-foreground">
        loading processes…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between border-b border-border/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          process explorer · {rows.length} comms tracked
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
          <span className="opacity-60">sort</span>
          {(['cpu', 'rss', 'label'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`px-1.5 py-0.5 rounded transition-colors ${sortKey === k ? 'text-foreground bg-primary/15' : 'hover:text-foreground'}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              <th className="text-left px-2 py-2 w-8"></th>
              <th className="text-left px-2 py-2">comm</th>
              <th className="text-right px-2 py-2 w-20">cpu%</th>
              <th className="text-right px-2 py-2 w-24">rss</th>
              <th className="px-2 py-2 w-[120px]">cpu trend</th>
              <th className="px-2 py-2 w-[120px]">rss trend</th>
              <th className="text-right px-2 py-2 w-16">peak cpu</th>
              <th className="text-right px-2 py-2 w-24">peak rss</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded === row.label;
              return (
                <ProcessRow
                  key={row.label}
                  row={row}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : row.label)}
                  onTogglePin={() => togglePin(row)}
                  pinning={pinning === row.label}
                  onZoom={onZoom}
                  onHover={onHover}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PINNED_LABELS = new Set([
  'workshop', 'challenge-poller', 'nginx', 'postgresql@16-main', 'jellyfin',
  'plexmediaserver', 'tailscaled', 'ssh',
  'minecraft-atm6', 'minecraft-atm10', 'minecraft-stoneblock3', 'minecraft-meatballcraft',
  'minecraft-atm9sky', 'minecraft-above-beyond', 'minecraft-star-technology',
]);
function isPinnedLabel(label: string): boolean { return PINNED_LABELS.has(label); }

interface ProcessRowProps {
  row: Row;
  isOpen: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  pinning: boolean;
  onZoom: (fromUnix: number, toUnix: number) => void;
  onHover: (ts: number | null) => void;
}

function ProcessRow({ row, isOpen, onToggle, onTogglePin, pinning, onZoom, onHover }: ProcessRowProps) {
  const cpuSeries: Series[] = useMemo(() => ([
    {},
    { label: 'cpu %', stroke: 'hsl(184 95% 58%)', fill: 'color-mix(in srgb, hsl(184 95% 58%) 16%, transparent)', width: 2, points: { show: false } },
  ]), []);
  const rssSeries: Series[] = useMemo(() => ([
    {},
    { label: 'rss', stroke: 'hsl(38 100% 62%)', fill: 'color-mix(in srgb, hsl(38 100% 62%) 16%, transparent)', width: 2, points: { show: false } },
  ]), []);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer border-t border-border/30 hover:bg-primary/[0.04] transition-colors ${row.pinned ? '' : 'opacity-90'}`}
      >
        <td className="px-2 py-1.5 text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[13px] truncate text-foreground/90">{row.comm}</span>
            {row.pinned && (
              <span
                className="font-mono text-[9px] uppercase tracking-[0.15em] px-1 py-px rounded"
                style={{ color: 'var(--color-brand-maroon)', backgroundColor: 'color-mix(in oklab, var(--color-brand-maroon) 14%, transparent)' }}
              >
                pinned
              </span>
            )}
          </div>
        </td>
        <td
          className="px-2 py-1.5 text-right tabular-nums"
          style={{ fontFamily: 'var(--font-readout), monospace', color: row.curCpu >= 75 ? 'var(--color-brand-maroon)' : undefined }}
        >
          {row.curCpu.toFixed(1)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-foreground/80" style={{ fontFamily: 'var(--font-readout), monospace' }}>
          {formatBytes(row.curRss)}
        </td>
        <td className="px-2 py-1.5">
          <Sparkline xs={row.xs} ys={row.cpuSeries} color="var(--color-primary)" width={110} height={22} />
        </td>
        <td className="px-2 py-1.5">
          <Sparkline xs={row.xs} ys={row.rssSeries} color="var(--color-brand-maroon)" width={110} height={22} />
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground/80 text-xs" style={{ fontFamily: 'var(--font-readout), monospace' }}>
          {row.peakCpu.toFixed(0)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground/80 text-xs" style={{ fontFamily: 'var(--font-readout), monospace' }}>
          {formatBytes(row.peakRss)}
        </td>
        <td className="px-2 py-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            disabled={pinning}
            className="opacity-30 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-foreground/5"
            title={row.pinned ? 'Unpin' : 'Pin for persistent tracking'}
          >
            {row.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
        </td>
      </tr>
      <AnimatePresence>
        {isOpen && (
          <tr>
            <td colSpan={9} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden bg-background/40"
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
                  <div className="rounded-lg border border-border/40 bg-card/60 p-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground px-1 mb-1">cpu % over window</div>
                    <UplotChart
                      data={[row.xs, row.cpuSeries]}
                      series={cpuSeries}
                      height={140}
                      onZoom={onZoom}
                      onHover={onHover}
                    />
                  </div>
                  <div className="rounded-lg border border-border/40 bg-card/60 p-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground px-1 mb-1">resident set over window</div>
                    <UplotChart
                      data={[row.xs, row.rssSeries]}
                      series={rssSeries}
                      height={140}
                      onZoom={onZoom}
                      onHover={onHover}
                    />
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}
