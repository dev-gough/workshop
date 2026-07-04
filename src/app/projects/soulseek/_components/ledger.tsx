'use client';

// The Ledger — the wire room's traffic records. uPlot charts of what ran
// down each wire, who it went to, and a paginated log of every transfer
// the exchange has ever put through. Chart tooltips are "call tickets":
// slips of exchange paper with a punched-tape edge (.slsk-ticket).

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowDown, ArrowUp, Search, User } from 'lucide-react';
import type { Series } from 'uplot';
import UplotChart from '@/components/charts/uplot-chart';
import { fmtBytes as fmtBytesShared, fmtSpeed } from '@/lib/format';

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.2em]';

function fmtBytes(bytes: number): string {
  return fmtBytesShared(bytes, '0 B');
}

// ── Types (mirror /api/soulseek/stats and /api/soulseek/transfers) ──

interface DailyPoint { date: string; count: string; bytes: string }
interface PeerStat { username: string; count: string; total_bytes: string; last_at?: string }

interface StatsData {
  downloads: {
    summary: { total: string; completed: string; staging: string; failed: string; total_bytes: string; avg_speed: string; unique_sources: string };
    topSources: PeerStat[];
    daily: DailyPoint[];
  };
  uploads: {
    summary: { total: string; completed: string; total_bytes: string; avg_speed: string; unique_users: string };
    topUsers: PeerStat[];
    daily: DailyPoint[];
    hourly: { hour: number; count: string }[];
    topRecords: { artist: string; album: string | null; count: string; total_bytes: string }[];
    formats: { ext: string | null; count: string; bytes: string }[];
  };
}

interface LogRow {
  id: number;
  direction: 'down' | 'up';
  username: string;
  filename: string;
  artist: string | null;
  album: string | null;
  size_bytes: number | null;
  speed_bytes_per_sec: number | null;
  status: string;
  created_at: string;
}

// ── Chart plumbing ──

// The room is dark-always, so the chart inks are stable — read them once
// from the scope (with the globals.css values as fallback for first paint).
const INK_FALLBACK = { signal: '#2ba176', copper: '#b97131', line: '#232e29', dim: '#8a968f' };
function useChartInk() {
  const [ink, setInk] = useState(INK_FALLBACK);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const cs = getComputedStyle(ref.current);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    setInk({
      signal: v('--slsk-signal-deep', INK_FALLBACK.signal),
      copper: v('--slsk-copper-deep', INK_FALLBACK.copper),
      line: v('--slsk-line', INK_FALLBACK.line),
      dim: v('--slsk-dim', INK_FALLBACK.dim),
    });
  }, []);
  return { ink, ref };
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DAY = 86400;
const WINDOW_DAYS = 90;

// Zero-filled daily timeline for the last 90 days. X values sit at noon UTC
// so day labels render on the correct calendar day in any nearby timezone.
function useDailyTimeline(stats: StatsData | null) {
  return useMemo(() => {
    const xs: number[] = [];
    const keys: string[] = [];
    const now = new Date();
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      xs.push(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 1000);
    }
    const zeros = () => keys.map(() => 0);
    const out = { xs, keys, dlBytes: zeros(), ulBytes: zeros(), dlCount: zeros(), ulCount: zeros() };
    if (!stats) return out;
    const fill = (points: DailyPoint[], bytesArr: number[], countArr: number[]) => {
      const byDate = new Map(points.map(p => [p.date, p]));
      keys.forEach((k, i) => {
        const p = byDate.get(k);
        if (p) { bytesArr[i] = Number(p.bytes); countArr[i] = Number(p.count); }
      });
    };
    fill(stats.downloads.daily, out.dlBytes, out.dlCount);
    fill(stats.uploads.daily, out.ulBytes, out.ulCount);
    return out;
  }, [stats]);
}

// ── The call ticket (chart tooltip) ──

function ticketDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).toUpperCase();
}

function CallTicket({ left, title, rows }: {
  /** px offset within the chart, or a CSS percentage like '42%'. */
  left: number | string;
  title: string;
  rows: { color: string; label: string; value: string }[];
}) {
  const leftCss = typeof left === 'number' ? `${left}px` : left;
  return (
    <div className="slsk-ticket" style={{ left: `clamp(96px, ${leftCss}, calc(100% - 96px))` }}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2 text-[11px] whitespace-nowrap">
            <span className="slsk-lamp !h-[5px] !w-[5px]" style={{ color: r.color }} />
            <span className="text-muted-foreground w-9">{r.label}</span>
            <span className="font-mono tabular-nums text-foreground ml-auto">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LampLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map(it => (
        <span key={it.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="slsk-lamp !h-[5px] !w-[5px]" style={{ color: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Wire traffic chart (daily, bytes ↔ files toggle) ──

function WireTrafficChart({ timeline, ink }: {
  timeline: ReturnType<typeof useDailyTimeline>;
  ink: typeof INK_FALLBACK;
}) {
  const [mode, setMode] = useState<'bytes' | 'files'>('bytes');
  const [hover, setHover] = useState<{ idx: number; left: number } | null>(null);

  const { xs, dlBytes, ulBytes, dlCount, ulCount } = timeline;
  const data = useMemo(() => (
    mode === 'bytes'
      ? [xs, dlBytes, ulBytes]
      : [xs, dlCount, ulCount]
  ) as [number[], number[], number[]], [mode, xs, dlBytes, ulBytes, dlCount, ulCount]);

  const series: Series[] = useMemo(() => [
    {},
    { label: 'down', stroke: ink.signal, fill: withAlpha(ink.signal, 0.16), width: 2, points: { show: false } },
    { label: 'up', stroke: ink.copper, fill: withAlpha(ink.copper, 0.16), width: 2, points: { show: false } },
  ], [ink]);

  const opts = useMemo(() => ({
    legend: { show: false },
    scales: { x: { time: true }, y: { range: (_u: unknown, _min: number, max: number) => [0, max * 1.08 || 1] as [number, number] } },
    axes: [
      { stroke: ink.dim, grid: { show: false }, ticks: { stroke: ink.line, width: 1 }, font: '10px ui-monospace, monospace' },
      {
        stroke: ink.dim, grid: { stroke: ink.line, width: 1 }, ticks: { show: false }, font: '10px ui-monospace, monospace',
        size: 56,
        values: (_u: unknown, ticks: number[]) => ticks.map(v => mode === 'bytes' ? fmtBytes(v) : String(v)),
      },
    ],
  }), [ink, mode]);

  const onHover = useCallback((ts: number | null, leftPx?: number) => {
    if (ts == null || leftPx == null) { setHover(null); return; }
    const idx = Math.round((ts - xs[0]) / DAY);
    if (idx < 0 || idx >= xs.length) { setHover(null); return; }
    setHover({ idx, left: leftPx });
  }, [xs]);

  const h = hover?.idx;
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={`${EYEBROW} text-muted-foreground`}>Wire traffic — 90 days</div>
        <div className="flex items-center gap-3">
          <LampLegend items={[{ color: ink.signal, label: 'down wire' }, { color: ink.copper, label: 'up wire' }]} />
          <div className="flex rounded-sm border border-border bg-muted/40 p-0.5">
            {(['bytes', 'files'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  mode === m ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{m}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative">
        {/* Remount on mode switch: the y-axis formatter is baked in at construct time. */}
        <UplotChart key={mode} data={data} series={series} opts={opts} height={210} syncKey="slsk-ledger" onHover={onHover} />
        {h != null && hover && (
          <CallTicket
            left={hover.left}
            title={ticketDate(xs[h])}
            rows={[
              { color: ink.signal, label: 'down', value: `${fmtBytes(timeline.dlBytes[h])} · ${timeline.dlCount[h]} files` },
              { color: ink.copper, label: 'up', value: `${fmtBytes(timeline.ulBytes[h])} · ${timeline.ulCount[h]} files` },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ── Running ledger (cumulative all-time bytes, plotted over the window) ──

function RunningLedgerChart({ timeline, stats, ink }: {
  timeline: ReturnType<typeof useDailyTimeline>;
  stats: StatsData;
  ink: typeof INK_FALLBACK;
}) {
  const [hover, setHover] = useState<{ idx: number; left: number } | null>(null);
  const { xs, dlBytes, ulBytes } = timeline;

  // Running all-time totals: seed each line with everything that moved
  // before the 90-day window so the lines end at the true lifetime figures.
  const { cumDl, cumUl } = useMemo(() => {
    const windowDl = dlBytes.reduce((a, b) => a + b, 0);
    const windowUl = ulBytes.reduce((a, b) => a + b, 0);
    let dl = Math.max(Number(stats.downloads.summary.total_bytes) - windowDl, 0);
    let ul = Math.max(Number(stats.uploads.summary.total_bytes) - windowUl, 0);
    const cumDl = dlBytes.map(b => (dl += b));
    const cumUl = ulBytes.map(b => (ul += b));
    return { cumDl, cumUl };
  }, [dlBytes, ulBytes, stats]);

  const series: Series[] = useMemo(() => [
    {},
    { label: 'in', stroke: ink.signal, width: 2, points: { show: false } },
    { label: 'out', stroke: ink.copper, width: 2, points: { show: false } },
  ], [ink]);

  const opts = useMemo(() => ({
    legend: { show: false },
    scales: { x: { time: true }, y: { range: (_u: unknown, min: number, max: number) => [min * 0.98, max * 1.02 || 1] as [number, number] } },
    axes: [
      { stroke: ink.dim, grid: { show: false }, ticks: { stroke: ink.line, width: 1 }, font: '10px ui-monospace, monospace' },
      {
        stroke: ink.dim, grid: { stroke: ink.line, width: 1 }, ticks: { show: false }, font: '10px ui-monospace, monospace',
        size: 56,
        values: (_u: unknown, ticks: number[]) => ticks.map(v => fmtBytes(v)),
      },
    ],
  }), [ink]);

  const onHover = useCallback((ts: number | null, leftPx?: number) => {
    if (ts == null || leftPx == null) { setHover(null); return; }
    const idx = Math.round((ts - xs[0]) / DAY);
    if (idx < 0 || idx >= xs.length) { setHover(null); return; }
    setHover({ idx, left: leftPx });
  }, [xs]);

  const h = hover?.idx;
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className={`${EYEBROW} text-muted-foreground`}>Running ledger — all-time</div>
        <LampLegend items={[{ color: ink.signal, label: 'taken in' }, { color: ink.copper, label: 'given out' }]} />
      </div>
      <div className="relative">
        <UplotChart data={[xs, cumDl, cumUl] as [number[], number[], number[]]} series={series} opts={opts} height={170} syncKey="slsk-ledger" onHover={onHover} />
        {h != null && hover && (
          <CallTicket
            left={hover.left}
            title={ticketDate(xs[h])}
            rows={[
              { color: ink.signal, label: 'in', value: fmtBytes(cumDl[h]) },
              { color: ink.copper, label: 'out', value: fmtBytes(cumUl[h]) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ── Exchange hours (hour-of-day histogram of files sent) ──

function ExchangeHours({ hourly, ink }: { hourly: StatsData['uploads']['hourly']; ink: typeof INK_FALLBACK }) {
  const [hover, setHover] = useState<number | null>(null);
  const bins = useMemo(() => {
    const b = Array.from({ length: 24 }, () => 0);
    hourly.forEach(hh => { b[hh.hour] = Number(hh.count); });
    return b;
  }, [hourly]);
  const max = Math.max(...bins, 1);

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-3">
      <div className={`${EYEBROW} text-muted-foreground`}>Exchange hours — when the up wire runs</div>
      <div className="relative">
        <div className="flex items-end gap-px h-24" onMouseLeave={() => setHover(null)}>
          {bins.map((count, hour) => (
            <div key={hour} className="flex-1 h-full flex items-end cursor-crosshair" onMouseEnter={() => setHover(hour)}>
              <div
                className="w-full rounded-t-[2px] transition-colors"
                style={{
                  height: count === 0 ? '2px' : `${Math.max((count / max) * 100, 4)}%`,
                  background: count === 0 ? 'var(--slsk-line)' : hover === hour ? 'var(--slsk-copper)' : 'var(--slsk-copper-deep)',
                }}
              />
            </div>
          ))}
        </div>
        {hover != null && (
          <CallTicket
            left={`${((hover + 0.5) / 24) * 100}%`}
            title={`${String(hover).padStart(2, '0')}:00 — ${String(hover).padStart(2, '0')}:59`}
            rows={[{ color: ink.copper, label: 'sent', value: `${bins[hover]} files` }]}
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] font-mono tabular-nums text-muted-foreground">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

// ── Sent-out panels ──

function BarList({ title, tone, rows }: {
  title: string;
  tone: 'up' | 'down';
  rows: { key: string; label: string; sub?: string; bytes: number; count: number }[];
}) {
  const max = Math.max(...rows.map(r => r.bytes), 1);
  const barColor = tone === 'up' ? 'var(--slsk-copper-deep)' : 'var(--slsk-signal-deep)';
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-2.5">
      <div className={`${EYEBROW} ${tone === 'up' ? 'text-accent' : 'text-primary'}`}>{title}</div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Nothing in the ledger yet</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground font-mono tabular-nums w-4 shrink-0">{i + 1}</span>
            <span className="text-foreground truncate">{r.label}</span>
            {r.sub && <span className="text-muted-foreground truncate hidden sm:inline">· {r.sub}</span>}
            <span className="text-muted-foreground font-mono tabular-nums ml-auto shrink-0">{r.count} files</span>
            <span className="text-foreground font-mono tabular-nums w-[4.5rem] text-right shrink-0">{fmtBytes(r.bytes)}</span>
          </div>
          <div className="h-[3px] rounded-full bg-muted/60 overflow-hidden ml-6">
            <div className="h-full rounded-full" style={{ width: `${(r.bytes / max) * 100}%`, background: barColor }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Format split: proportional strip with 2px gaps. FLAC wears copper
// (lossless = copper, as in the search tab's quality tags), MP3 signal.
const AUDIO_EXTS = new Set(['flac', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma']);

function FormatSplit({ formats: raw }: { formats: StatsData['uploads']['formats'] }) {
  // Fold the non-audio riders (covers, cue sheets, logs…) into one bucket.
  const formats = useMemo(() => {
    const audio = raw.filter(f => f.ext && AUDIO_EXTS.has(f.ext));
    const rest = raw.filter(f => !f.ext || !AUDIO_EXTS.has(f.ext));
    const other = rest.reduce((acc, f) => ({
      ext: 'other', count: String(Number(acc.count) + Number(f.count)), bytes: String(Number(acc.bytes) + Number(f.bytes)),
    }), { ext: 'other', count: '0', bytes: '0' });
    return Number(other.count) > 0 ? [...audio, other] : audio;
  }, [raw]);
  const total = formats.reduce((a, f) => a + Number(f.count), 0);
  const colorFor = (ext: string | null) =>
    ext === 'flac' ? 'var(--slsk-copper-deep)'
    : ext === 'mp3' ? 'var(--slsk-signal-deep)'
    : 'var(--slsk-dim)';
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-3">
      <div className={`${EYEBROW} text-accent`}>Formats on the up wire</div>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing sent yet</p>
      ) : (
        <>
          <div className="flex h-3 gap-[2px] rounded-sm overflow-hidden">
            {formats.map(f => (
              <div key={f.ext ?? '?'} style={{ width: `${(Number(f.count) / total) * 100}%`, background: colorFor(f.ext) }} className="min-w-[3px]" />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {formats.map(f => (
              <span key={f.ext ?? '?'} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="slsk-lamp !h-[5px] !w-[5px]" style={{ color: colorFor(f.ext) }} />
                <span className="font-mono">{(f.ext || '?').toUpperCase()}</span>
                <span className="font-mono tabular-nums text-foreground">{f.count}</span>
                <span className="font-mono tabular-nums">· {fmtBytes(Number(f.bytes))}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── The transfer log (every transfer, paginated server-side) ──

const LOG_PAGE_SIZES = [25, 50, 100] as const;
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Done' },
  { id: 'queued', label: 'Queued' },
  { id: 'rejected', label: 'Rejected' },
] as const;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

function statusChip(status: string): { label: string; cls: string } | null {
  if (status === 'completed') return null;
  if (status === 'queued') return { label: 'queued', cls: 'text-accent bg-accent/10' };
  if (status === 'rejected' || status === 'failed') return { label: status, cls: 'text-destructive bg-destructive/10' };
  return { label: status, cls: 'text-muted-foreground bg-muted/60' };
}

function TransferLog() {
  const [direction, setDirection] = useState<'all' | 'down' | 'up'>('all');
  const [status, setStatus] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(query.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    const params = new URLSearchParams({
      direction, status, q: debouncedQ, page: String(page), pageSize: String(pageSize),
    });
    fetch(`/api/soulseek/transfers?${params}`)
      .then(r => r.json())
      .then(d => {
        if (stale) return;
        setRows(d.transfers || []);
        setTotal(d.total || 0);
        setLoading(false);
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [direction, status, debouncedQ, page, pageSize]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  // Clamp back if filters shrank the set under the current page.
  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  return (
    <div className="space-y-2">
      <div className={`${EYEBROW} text-muted-foreground`}>The log — every call on record</div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
          {([['all', 'Both'], ['down', '▼ Down'], ['up', '▲ Up']] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setDirection(id); setPage(0); }}
              className={`px-2.5 py-1 rounded-[5px] text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                direction === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >{label}</button>
          ))}
        </div>
        <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
          {STATUS_FILTERS.map(s => (
            <button key={s.id} onClick={() => { setStatus(s.id); setPage(0); }}
              className={`px-2.5 py-1 rounded-[5px] text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                status === s.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >{s.label}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search peer, file, artist, album…"
            className="w-full pl-8 pr-3 py-1.5 rounded-md bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* Rows */}
      <div className={`rounded-lg border border-border/70 bg-card/60 overflow-hidden transition-opacity ${loading ? 'opacity-60' : ''}`}
        style={{ minHeight: rows.length > 0 ? Math.min(rows.length, pageSize) * 33 : undefined }}
      >
        {rows.length === 0 && !loading && (
          <div className="text-center py-8 text-sm text-muted-foreground">No calls match — clear a filter</div>
        )}
        {rows.length === 0 && loading && (
          <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
            <span className="slsk-lamp text-primary slsk-lamp-live" /> Pulling the log…
          </div>
        )}
        {rows.map((r, i) => {
          const chip = statusChip(r.status);
          return (
            <div key={`${r.direction}-${r.id}`} className={`flex items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/40' : ''}`}>
              {r.direction === 'down'
                ? <ArrowDown className="h-3 w-3 text-primary shrink-0" />
                : <ArrowUp className="h-3 w-3 text-accent shrink-0" />}
              <span className="text-foreground w-20 sm:w-28 truncate shrink-0" title={r.username}>{r.username}</span>
              <span className="font-mono text-muted-foreground truncate flex-1 min-w-0" title={r.filename}>{r.filename}</span>
              {(r.artist || r.album) && (
                <span className="text-muted-foreground truncate max-w-44 hidden lg:inline shrink-0">
                  {[r.artist, r.album].filter(Boolean).join(' — ')}
                </span>
              )}
              {chip && <span className={`text-[9px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm shrink-0 ${chip.cls}`}>{chip.label}</span>}
              <span className="text-muted-foreground font-mono tabular-nums w-[4.75rem] text-right shrink-0 whitespace-nowrap hidden sm:inline">{fmtBytes(Number(r.size_bytes) || 0)}</span>
              <span className="text-muted-foreground font-mono tabular-nums w-20 text-right shrink-0 hidden sm:inline">
                {r.speed_bytes_per_sec ? fmtSpeed(r.speed_bytes_per_sec) : ''}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums w-[5.5rem] text-right shrink-0">{fmtWhen(r.created_at)}</span>
            </div>
          );
        })}
      </div>

      {/* Footer: counts + page size + pager */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {total} record{total === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">Per page:</span>
            {LOG_PAGE_SIZES.map(s => (
              <button key={s} onClick={() => { setPageSize(s); setPage(0); }}
                className={`text-[11px] px-1.5 py-0.5 rounded-sm transition-colors ${pageSize === s ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >{s}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >Prev</button>
            <span className="text-[11px] text-muted-foreground tabular-nums">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
              className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The tab ──

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4 space-y-1">
      <span className={`${EYEBROW} ${color}`}>{label}</span>
      <p className="text-xl font-bold font-mono tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export default function LedgerTab() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { ink, ref } = useChartInk();

  useEffect(() => {
    setLoading(true);
    fetch('/api/soulseek/stats').then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const timeline = useDailyTimeline(stats);

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <span className="slsk-lamp text-primary slsk-lamp-live" /> Opening the ledger…
    </div>
  );

  if (!stats || !stats.downloads) return (
    <div className="text-center py-16 text-muted-foreground">
      <p className="text-sm">No ledger entries yet</p>
    </div>
  );

  const dl = stats.downloads.summary;
  const ul = stats.uploads.summary;
  const bytesIn = Number(dl.total_bytes);
  const bytesOut = Number(ul.total_bytes);
  const giveRatio = bytesIn > 0 ? (bytesOut / bytesIn) : null;

  return (
    <div ref={ref} className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Files in" value={dl.completed} color="text-primary" />
        <StatTile label="Files out" value={ul.completed} color="text-accent" />
        <StatTile label="Pulled down" value={fmtBytes(bytesIn)} color="text-primary" />
        <StatTile label="Sent up" value={fmtBytes(bytesOut)} color="text-accent" />
        <StatTile label="Peers" value={String(Number(dl.unique_sources || 0) + Number(ul.unique_users || 0))} color="text-foreground" />
        <StatTile label="Give ratio" value={giveRatio == null ? '—' : `${giveRatio.toFixed(1)}×`} color="text-foreground" />
      </div>

      {/* Speed stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/70 bg-card/60 p-4">
          <div className={`${EYEBROW} text-primary mb-1`}>▼ avg down speed</div>
          <div className="text-lg font-mono tabular-nums text-foreground">{fmtSpeed(parseFloat(dl.avg_speed))}</div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/60 p-4">
          <div className={`${EYEBROW} text-accent mb-1`}>▲ avg up speed</div>
          <div className="text-lg font-mono tabular-nums text-foreground">{fmtSpeed(parseFloat(ul.avg_speed))}</div>
        </div>
      </div>

      {/* Wire traffic — the hero chart */}
      <WireTrafficChart timeline={timeline} ink={ink} />

      {/* Running ledger + exchange hours */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RunningLedgerChart timeline={timeline} stats={stats} ink={ink} />
        <ExchangeHours hourly={stats.uploads.hourly || []} ink={ink} />
      </div>

      {/* Who & what is going out */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarList
          title="Best customers — up wire"
          tone="up"
          rows={(stats.uploads.topUsers || []).map(u => ({
            key: u.username, label: u.username, bytes: Number(u.total_bytes), count: Number(u.count),
          }))}
        />
        <BarList
          title="Records shipped"
          tone="up"
          rows={(stats.uploads.topRecords || []).map(r => ({
            key: `${r.artist}::${r.album}`, label: r.artist, sub: r.album || undefined,
            bytes: Number(r.total_bytes), count: Number(r.count),
          }))}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FormatSplit formats={stats.uploads.formats || []} />
        <BarList
          title="Best sources — down wire"
          tone="down"
          rows={(stats.downloads.topSources || []).map(u => ({
            key: u.username, label: u.username, bytes: Number(u.total_bytes), count: Number(u.count),
          }))}
        />
      </div>

      {/* Every transfer on record */}
      <TransferLog />
    </div>
  );
}
