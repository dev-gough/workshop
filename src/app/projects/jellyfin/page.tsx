'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Tv, Loader, Plus, X, CheckCircle, AlertTriangle, ArrowRight,
  Clock, Trash2, ExternalLink, Pause, Play, Search, Archive,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import { fmtBytes, fmtSpeed, fmtEta, fmtDuration, fmtTime } from '@/lib/format';

// ── Types ──

type Mode = 'tv' | 'movie';

interface Transfer {
  id: number;
  hash: string;
  name: string;
  status: string;
  rawStatus: number;        // 0 stopped, 1-2 verify, 3-4 download, 5-6 seed
  percent: number;
  totalBytes: number;
  downBps: number;
  upBps: number;
  eta: number;
  ratio: number;
  uploadedEver: number;
  secondsSeeding: number;
  error: string | null;
  downloadDir: string;
  mode: Mode;
  addedAt: string | null;
  doneAt: string | null;
  dbId: number | null;
  dbStatus: string | null;
  archived: boolean;
}

type StatusGroup = 'downloading' | 'seeding' | 'paused' | 'verifying';
type Filter = 'all' | StatusGroup;

function groupOf(t: Transfer): StatusGroup {
  if (t.rawStatus === 0) return 'paused';
  if (t.rawStatus === 1 || t.rawStatus === 2) return 'verifying';
  if (t.rawStatus === 3 || t.rawStatus === 4) return 'downloading';
  return 'seeding';
}

const GROUP_ORDER: StatusGroup[] = ['downloading', 'verifying', 'seeding', 'paused'];

// Projection-booth vocabulary: prints arrive, get inspected, are held over
// for the crowd (seeding), or sit through an intermission (paused).
const GROUP_META: Record<StatusGroup, { label: string; color: string; dot: string }> = {
  downloading: { label: 'Arriving',     color: 'text-primary',          dot: 'text-primary' },
  verifying:   { label: 'Inspecting',   color: 'text-foreground/80',    dot: 'text-foreground/70' },
  seeding:     { label: 'Held over',    color: 'text-accent',           dot: 'text-accent' },
  paused:      { label: 'Intermission', color: 'text-muted-foreground', dot: 'text-muted-foreground' },
};

interface IngestFile {
  id: number;
  source: string;
  dest: string;
  size: number;
}

interface SeedStats {
  session: {
    activeTorrentCount: number;
    pausedTorrentCount: number;
    torrentCount: number;
    downloadSpeed: number;
    uploadSpeed: number;
    cumulative: { uploadedBytes: number; downloadedBytes: number; secondsActive: number; sessionCount: number };
    current: { uploadedBytes: number; downloadedBytes: number; secondsActive: number };
  };
  seedingNow: number;
  ratio: number;
  topSeeded: { name: string; uploadedEver: number; ratio: number; secondsSeeding: number; isFinished: boolean; status: number }[];
}

interface HistoryRow {
  id: number;
  transmission_id: number | null;
  hash: string | null;
  mode: Mode;
  link: string;
  original_name: string | null;
  staging_path: string | null;
  cleaned_title: string | null;
  cleaned_year: number | null;
  cleaned_season: number | null;
  final_path: string | null;
  size_bytes: string | null;
  status: string;
  error_message: string | null;
  submitted_at: string;
  completed_at: string | null;
  ingested_at: string | null;
  files: IngestFile[];
  jellyfin_item_id: string | null;
  jellyfin_server_id: string | null;
}

// ── Helpers ──

// Pull the show/movie folder name out of a final_path like
// "/Media/TV Shows/Severance (2022)/Season 02" → "Severance (2022)".
// Returns null if we can't infer one.
function titleFromPath(finalPath: string | null): string | null {
  if (!finalPath) return null;
  const parts = finalPath.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'TV Shows' || p === 'Movies');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

// Strip a trailing "(YYYY)" so Jellyfin's search query is more forgiving.
function searchableTitle(name: string): string {
  return name.replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

// Prefer a resolved library item (details page); fall back to a search link.
function jellyfinOpenUrl(serverBase: string, row: HistoryRow): string | null {
  if (row.jellyfin_item_id) {
    const sid = row.jellyfin_server_id ? `&serverId=${row.jellyfin_server_id}` : '';
    return `${serverBase}/web/#/details?id=${row.jellyfin_item_id}${sid}`;
  }
  const title = titleFromPath(row.final_path);
  if (!title) return null;
  return `${serverBase}/web/#/search.html?query=${encodeURIComponent(searchableTitle(title))}`;
}

function ModeChip({ mode }: { mode: Mode }) {
  const Icon = mode === 'tv' ? Tv : Film;
  return (
    <span className="cine-title mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-muted-foreground">
      <Icon className="h-3 w-3" /> {mode === 'tv' ? 'Series' : 'Feature'}
    </span>
  );
}

function ratioColor(r: number): string {
  if (r >= 2) return 'text-accent';
  if (r >= 1) return 'text-primary';
  return 'text-muted-foreground';
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`cine-title text-[10px] font-semibold tracking-[0.22em] text-muted-foreground ${className}`}>
      {children}
    </h2>
  );
}

// ── Box office (seeding stats rail) ──

function StatRow({ label, value, valueClass, sub }: {
  label: string; value: string; valueClass?: string; sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className={`cine-readout text-sm ${valueClass ?? 'text-foreground'}`}>{value}</span>
        {sub && <span className="cine-readout ml-2 text-[10px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function BoxOffice({ stats }: { stats: SeedStats }) {
  const { session, ratio, seedingNow, topSeeded } = stats;
  const cum = session.cumulative;
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Box office</Eyebrow>
          <span className="text-[10px] text-muted-foreground">
            {cum.sessionCount} session{cum.sessionCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className={`cine-readout text-3xl ${ratioColor(ratio)}`}>×{ratio.toFixed(2)}</span>
          <span className="text-[11px] text-muted-foreground">given back · target ×10</span>
        </div>
        <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
          <StatRow
            label="Shared out"
            value={fmtBytes(cum.uploadedBytes)}
            valueClass="text-accent"
            sub={`↑ ${fmtSpeed(session.uploadSpeed, '0')}`}
          />
          <StatRow
            label="Taken in"
            value={fmtBytes(cum.downloadedBytes)}
            valueClass="text-primary"
            sub={`↓ ${fmtSpeed(session.downloadSpeed, '0')}`}
          />
          <StatRow
            label="Reels on hand"
            value={`${seedingNow} / ${session.torrentCount}`}
            sub={`${session.pausedTorrentCount} paused`}
          />
        </div>
      </section>

      {topSeeded.length > 0 && (
        <section className="rounded-md border border-border bg-card p-4">
          <Eyebrow>Long runs</Eyebrow>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Most shared back, all time</p>
          <div className="mt-2 space-y-2">
            {topSeeded.map((t, i) => (
              <div key={i} className="flex items-baseline gap-2 text-xs">
                <span className="cine-readout w-3 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">{t.name}</span>
                <span className="cine-readout shrink-0 text-accent">{fmtBytes(t.uploadedEver)}</span>
                <span className={`cine-readout w-12 shrink-0 text-right ${ratioColor(t.ratio)}`}>
                  ×{t.ratio.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Booking (submit form) ──

function BookingForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [link, setLink] = useState('');
  const [mode, setMode] = useState<Mode>('movie');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live preview as the user types — debounced. Pulls a name out of the magnet
  // (dn= param) or the URL path; otherwise just runs the cleaner on the link.
  useEffect(() => {
    setPreview(null);
    if (!link.trim()) return;

    let candidate = link.trim();
    const dn = candidate.match(/[?&]dn=([^&]+)/);
    if (dn) {
      try { candidate = decodeURIComponent(dn[1]).replace(/\+/g, ' '); }
      catch { candidate = dn[1]; }
    } else if (candidate.startsWith('magnet:')) {
      return; // no display name in magnet
    } else {
      try {
        const u = new URL(candidate);
        candidate = decodeURIComponent(u.pathname.split('/').pop() || candidate);
      } catch { /* keep as-is */ }
    }

    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/jellyfin/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: candidate, mode }),
        });
        const data = await res.json();
        if (data.preview) setPreview(data.preview);
      } catch { /* ignore */ }
    }, 350);

    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [link, mode]);

  const handleSubmit = async () => {
    if (!link.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/jellyfin/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: link.trim(), mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Submit failed');
      } else {
        setOkFlash(data.transmission?.name || 'Added');
        setLink('');
        setPreview(null);
        onSubmitted();
        setTimeout(() => setOkFlash(null), 3000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Booking</Eyebrow>
        <span className="text-[10px] text-muted-foreground">magnet link or .torrent URL</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['movie', 'tv'] as const).map((m) => {
          const Icon = m === 'movie' ? Film : Tv;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-on={mode === m}
              className="cine-tab cine-title flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold tracking-[0.14em]"
            >
              <Icon className="h-3.5 w-3.5" />
              {m === 'movie' ? 'Feature' : 'Series'}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="magnet:?xt=urn:btih:…"
          className="min-w-0 flex-1 rounded-[4px] border border-border bg-muted/50 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !link.trim()}
          className="cine-title flex shrink-0 items-center justify-center gap-2 rounded-[4px] bg-primary px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add to program
        </button>
      </div>

      {preview && (
        <motion.div
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 flex items-start gap-1.5 px-1 text-xs"
        >
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 font-mono text-primary/85 break-all">{preview}</span>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertTriangle className="h-3 w-3" /> {error}
          </motion.div>
        )}
        {okFlash && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 flex items-center gap-1.5 text-xs text-accent"
          >
            <CheckCircle className="h-3 w-3" />
            <span className="max-w-xs truncate">On the program: {okFlash}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ── A frame on the strip (torrent row) ──

function FrameRow({
  t, onRemove, onSeed,
}: {
  t: Transfer;
  onRemove: (t: Transfer, deleteData: boolean) => void;
  onSeed: (t: Transfer, action: 'start' | 'stop') => void;
}) {
  const grp = groupOf(t);
  const meta = GROUP_META[grp];
  const pct = Math.round(t.percent * 100);
  const isDone = t.percent >= 1;
  const paused = grp === 'paused';
  const seeding = grp === 'seeding';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex overflow-hidden rounded-[4px] border border-border bg-card ${paused ? 'opacity-60' : ''}`}
    >
      <div className="cine-rail" />
      <div className="min-w-0 flex-1 space-y-2.5 p-3.5">
        <div className="flex items-start gap-2.5">
          <ModeChip mode={t.mode} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{t.name}</div>
              {t.archived && (
                <span title="Print archived (.torrent saved)" className="text-primary/50">
                  <Archive className="h-3 w-3" />
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className={`flex items-center gap-1.5 ${meta.color}`}>
                <span className={`cine-lamp-dot ${paused ? 'cine-lamp-off' : meta.dot}`} style={{ width: 6, height: 6 }} />
                {t.status}
              </span>
              <span className="cine-readout">{fmtBytes(t.totalBytes)}</span>
              {!isDone && !paused && (
                <>
                  <span className="cine-readout text-primary">↓ {fmtSpeed(t.downBps, '0')}</span>
                  <span className="cine-readout text-accent">↑ {fmtSpeed(t.upBps, '0')}</span>
                  {t.eta > 0 && <span className="cine-readout">ETA {fmtEta(t.eta)}</span>}
                </>
              )}
              {isDone && !paused && (
                <>
                  <span className="cine-readout text-accent">↑ {fmtSpeed(t.upBps, '0')}</span>
                  <span className={`cine-readout ${ratioColor(t.ratio)}`}>×{t.ratio.toFixed(2)}</span>
                  {t.uploadedEver > 0 && <span className="cine-readout">shared {fmtBytes(t.uploadedEver)}</span>}
                  {seeding && t.secondsSeeding > 0 && <span className="cine-readout">{fmtDuration(t.secondsSeeding)} run</span>}
                </>
              )}
              {paused && t.uploadedEver > 0 && (
                <span className="cine-readout">shared {fmtBytes(t.uploadedEver)} · ×{t.ratio.toFixed(2)}</span>
              )}
            </div>
            {t.error && (
              <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" /> {t.error}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {paused ? (
              <button
                onClick={() => onSeed(t, 'start')}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent/15 hover:text-accent"
                title="Resume"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => onSeed(t, 'stop')}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
                title="Pause"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`Remove "${t.name}" from transmission?\n(Data on disk is kept.)`)) {
                  onRemove(t, false);
                }
              }}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              title="Remove (keep files)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (confirm(`Remove "${t.name}" AND delete its files in staging?`)) {
                  onRemove(t, true);
                }
              }}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              title="Remove and delete files"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="cine-gauge">
            <span data-done={isDone} data-paused={paused} style={{ width: `${t.percent * 100}%` }} />
          </div>
          <span className="cine-readout w-10 text-right text-xs text-muted-foreground">{pct}%</span>
        </div>
      </div>
      <div className="cine-rail" />
    </motion.div>
  );
}

// ── The program (unified, filterable, grouped) ──

function ProgramPanel({
  transfers, onRemove, onSeed, daemonOk,
}: {
  transfers: Transfer[];
  onRemove: (t: Transfer, deleteData: boolean) => void;
  onSeed: (t: Transfer, action: 'start' | 'stop') => void;
  daemonOk: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  // Group counts always reflect the full transfer set, not the post-search subset.
  // This is intentional — the search box is a within-group narrowing tool and the
  // pill counts should keep showing how many torrents are actually in each state.
  const counts = transfers.reduce<Record<Filter, number>>(
    (acc, t) => { acc.all += 1; acc[groupOf(t)] += 1; return acc; },
    { all: 0, downloading: 0, seeding: 0, paused: 0, verifying: 0 },
  );

  const q = query.trim().toLowerCase();
  const filtered = transfers.filter((t) => {
    if (filter !== 'all' && groupOf(t) !== filter) return false;
    if (q && !t.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // Group + sort within group: downloads by ETA asc, seeders by upload speed desc, others by added desc.
  const grouped: Record<StatusGroup, Transfer[]> = { downloading: [], verifying: [], seeding: [], paused: [] };
  for (const t of filtered) grouped[groupOf(t)].push(t);
  grouped.downloading.sort((a, b) => (a.eta < 0 ? Infinity : a.eta) - (b.eta < 0 ? Infinity : b.eta));
  grouped.seeding.sort((a, b) => b.upBps - a.upBps || b.uploadedEver - a.uploadedEver);
  grouped.verifying.sort((a, b) => b.percent - a.percent);
  grouped.paused.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  if (!daemonOk) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        <span className="cine-lamp-dot cine-lamp-off mx-auto mb-3 block h-2.5 w-2.5" />
        The projection booth isn&#39;t answering — transmission-daemon looks offline.
        <div className="mt-1">
          Run <span className="font-mono text-foreground">scripts/jellyfin/setup-daemon.sh</span> to relight it.
        </div>
      </div>
    );
  }

  const filterPills: { value: Filter; label: string }[] = [
    { value: 'all',         label: 'All' },
    { value: 'downloading', label: 'Arriving' },
    { value: 'verifying',   label: 'Inspecting' },
    { value: 'seeding',     label: 'Held over' },
    { value: 'paused',      label: 'Intermission' },
  ];

  return (
    <div className="space-y-3">
      {/* Filter + search bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {filterPills.map((p) => (
            <button
              key={p.value}
              onClick={() => setFilter(p.value)}
              data-on={filter === p.value}
              className="cine-tab flex items-center gap-1.5 px-2.5 py-1 text-xs"
            >
              {p.label}
              <span className="cine-readout text-[10px] opacity-70">{counts[p.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[170px] max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a print…"
            className="w-full rounded-[4px] border border-border bg-muted/50 py-1.5 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {transfers.length === 0
            ? 'Nothing on the program — book a picture above.'
            : q
              ? <>No prints match <span className="font-mono text-foreground">&ldquo;{query}&rdquo;</span>.</>
              : 'No prints in this state.'}
        </div>
      ) : (
        <div className="space-y-5">
          {GROUP_ORDER.map((g) => {
            const items = grouped[g];
            if (items.length === 0) return null;
            const meta = GROUP_META[g];
            // Hide the section header when filter narrows to one group anyway.
            const showHeader = filter === 'all';
            return (
              <div key={g} className="space-y-2">
                {showHeader && (
                  <div className="sticky top-[57px] z-10 -mx-1 border-b border-border/50 bg-background/85 px-1 py-1.5 backdrop-blur-sm">
                    {g === 'seeding' ? (
                      <span className="cine-exit-sign cine-title text-[10px] font-bold tracking-[0.2em]">
                        Held over
                        <span className="cine-readout font-normal opacity-80">{items.length}</span>
                      </span>
                    ) : (
                      <div className={`cine-title flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] ${meta.color}`}>
                        <span className={`cine-lamp-dot ${meta.dot}`} style={{ width: 6, height: 6 }} />
                        {meta.label}
                        <span className="cine-readout text-muted-foreground">{items.length}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {items.map((t) => (
                    <FrameRow key={t.id} t={t} onRemove={onRemove} onSeed={onSeed} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Program archive (history) ──

function statusWord(status: string): { word: string; className: string } {
  if (status === 'ingested') return { word: 'in the library', className: 'text-accent' };
  if (status === 'downloading') return { word: 'arriving', className: 'text-primary' };
  if (status === 'removed') return { word: 'removed', className: 'text-muted-foreground' };
  return { word: status, className: 'text-primary' };
}

function ProgramArchive({ history, jellyfinBase }: { history: HistoryRow[]; jellyfinBase: string | null }) {
  if (history.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No screenings on record yet.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {history.map((row) => {
        const ingested = row.status === 'ingested';
        const openUrl = ingested && jellyfinBase ? jellyfinOpenUrl(jellyfinBase, row) : null;
        const handleOpen = openUrl
          ? () => window.open(openUrl, '_blank', 'noopener,noreferrer')
          : undefined;
        const st = statusWord(row.status);
        return (
          <motion.div
            key={row.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={handleOpen}
            className={`rounded-[4px] border border-border bg-card/70 p-3 transition-colors ${
              handleOpen ? 'cursor-pointer hover:border-primary/50 hover:bg-card active:bg-card/80' : ''
            }`}
            title={handleOpen ? (row.jellyfin_item_id ? 'Open in Jellyfin' : 'Search in Jellyfin') : undefined}
          >
            <div className="flex items-start gap-3">
              <ModeChip mode={row.mode} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="truncate font-mono text-sm text-foreground/90">
                  {(row.original_name || '(unknown)').replace(/\+/g, ' ')}
                </div>
                {row.final_path && (
                  <div className="flex items-start gap-1.5 font-mono text-xs text-primary/75">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                    <span className="break-all">{row.final_path}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {fmtTime(row.submitted_at)}
                  </span>
                  <span className={st.className}>{st.word}</span>
                  {row.files.length > 0 && (
                    <span>{row.files.length} file{row.files.length === 1 ? '' : 's'}</span>
                  )}
                  {row.error_message && (
                    <span className="text-destructive">{row.error_message}</span>
                  )}
                </div>
              </div>
              {ingested && (
                handleOpen ? (
                  <ExternalLink className="mt-0.5 h-4 w-4 text-primary/80" />
                ) : (
                  <CheckCircle className="mt-0.5 h-4 w-4 text-accent" />
                )
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Page ──

export default function JellyfinPage() {
  useHeaderConfig({ scopeClass: 'cine-theme' });

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<SeedStats | null>(null);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [jellyfinBase, setJellyfinBase] = useState<string | null>(null);

  // Jellyfin's web address as seen from this browser: portless jellyfin.local
  // when we're already browsing over mDNS, otherwise the same host on :8096.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { protocol, hostname } = window.location;
    setJellyfinBase(
      hostname.endsWith('.local') ? `${protocol}//jellyfin.local` : `${protocol}//${hostname}:8096`,
    );
  }, []);

  const refreshTransfers = useCallback(async () => {
    try {
      const res = await fetch('/api/jellyfin/transfers');
      const data = await res.json();
      setTransfers(data.transfers || []);
      setDaemonOk(!data.error);
    } catch {
      setDaemonOk(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/jellyfin/history?limit=30');
      const data = await res.json();
      setHistory(data.history || []);
    } catch { /* ignore */ }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch('/api/jellyfin/stats');
      const data = await res.json();
      if (!data.error) setStats(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshTransfers();
    refreshHistory();
    refreshStats();
    const t = setInterval(refreshTransfers, 2000);
    const h = setInterval(refreshHistory, 6000);
    const s = setInterval(refreshStats, 5000);
    return () => { clearInterval(t); clearInterval(h); clearInterval(s); };
  }, [refreshTransfers, refreshHistory, refreshStats]);

  const handleRemove = useCallback(async (t: Transfer, deleteData: boolean) => {
    try {
      await fetch('/api/jellyfin/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, hash: t.hash, deleteData }),
      });
      refreshTransfers();
    } catch { /* ignore */ }
  }, [refreshTransfers]);

  const handleSeed = useCallback(async (t: Transfer, action: 'start' | 'stop') => {
    // Optimistic flip so the UI reacts before the next 2s poll lands.
    setTransfers((prev) => prev.map((p) =>
      p.id === t.id ? { ...p, rawStatus: action === 'stop' ? 0 : (p.percent >= 1 ? 6 : 4) } : p
    ));
    try {
      await fetch('/api/jellyfin/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, action }),
      });
    } catch { /* refresh will reconcile */ }
    refreshTransfers();
  }, [refreshTransfers]);

  const arriving = transfers.filter((t) => groupOf(t) === 'downloading').length;
  const heldOver = transfers.filter((t) => groupOf(t) === 'seeding').length;
  const marqueeLine =
    daemonOk === false
      ? 'Projector offline'
      : transfers.length === 0
        ? 'Projector idle'
        : [
            arriving > 0 ? `${arriving} arriving` : null,
            heldOver > 0 ? `${heldOver} held over` : null,
          ].filter(Boolean).join(' · ') || `${transfers.length} on the program`;

  return (
    <PageTransition>
      <div className="cine-theme min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="cine-marquee">
              <div className="cine-bulbs" />
              <div className="px-6 py-6 text-center">
                <p className="cine-title text-[10px] font-semibold tracking-[0.3em] text-muted-foreground">
                  RM 08 · The projection booth
                </p>
                <h1 className="cine-title mt-1.5 text-2xl font-bold tracking-[0.28em] text-foreground sm:text-3xl">
                  Screening Room
                </h1>
                <p className={`cine-title mt-2 text-[11px] font-semibold tracking-[0.25em] ${
                  daemonOk === false ? 'text-destructive' : 'text-primary'
                }`}>
                  {marqueeLine}
                </p>
              </div>
              <div className="cine-bulbs" />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className={`cine-lamp-dot ${daemonOk ? 'text-primary' : 'cine-lamp-off'}`} />
                {daemonOk == null ? 'Checking the projector…' : daemonOk ? 'Projector running' : 'Projector offline'}
              </span>
              {jellyfinBase && (
                <a href={jellyfinBase} target="_blank" rel="noreferrer" className="cine-ticket text-xs">
                  Open Jellyfin
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </FadeIn>

          <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-6">
              <FadeIn delay={0.05}>
                <BookingForm onSubmitted={() => { refreshTransfers(); refreshHistory(); }} />
              </FadeIn>

              <FadeIn delay={0.1}>
                <div className="space-y-3">
                  <Eyebrow>
                    On the program
                    {transfers.length > 0 && (
                      <span className="cine-readout ml-2 normal-case tracking-normal">{transfers.length}</span>
                    )}
                  </Eyebrow>
                  <ProgramPanel
                    transfers={transfers}
                    onRemove={handleRemove}
                    onSeed={handleSeed}
                    daemonOk={daemonOk !== false}
                  />
                </div>
              </FadeIn>

              <FadeIn delay={0.15}>
                <div className="space-y-3">
                  <Eyebrow>Program archive</Eyebrow>
                  <ProgramArchive history={history} jellyfinBase={jellyfinBase} />
                </div>
              </FadeIn>
            </div>

            <div className="space-y-6">
              {daemonOk && stats && (
                <FadeIn delay={0.07}>
                  <BoxOffice stats={stats} />
                </FadeIn>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
