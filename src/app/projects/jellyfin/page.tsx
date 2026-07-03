'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Tv, Download, Loader, WifiOff, Plus, X,
  CheckCircle, AlertTriangle, ArrowRight, Clock, Trash2, Eye,
  Upload, HeartHandshake, Share2, ExternalLink, Pause, Play,
  Search, Archive, ListFilter,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { fmtBytes, fmtSpeed, fmtEta, fmtDuration, fmtTime } from '@/lib/format';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ConnectionBadge } from '@/components/ui/ConnectionBadge';

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

const GROUP_META: Record<StatusGroup, { label: string; icon: React.ElementType; color: string; dot: string }> = {
  downloading: { label: 'Downloading', icon: Download, color: 'text-blue-400', dot: 'bg-blue-400' },
  seeding:     { label: 'Seeding',     icon: Share2,   color: 'text-emerald-400', dot: 'bg-emerald-400' },
  verifying:   { label: 'Verifying',   icon: Loader,   color: 'text-amber-400', dot: 'bg-amber-400' },
  paused:      { label: 'Paused',      icon: Pause,    color: 'text-zinc-400',  dot: 'bg-zinc-500' },
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
}

// ── Helpers ──

function statusColor(status: string): string {
  if (status === 'Downloading') return 'text-blue-400';
  if (status === 'Seeding') return 'text-emerald-400';
  if (status === 'Verifying') return 'text-amber-400';
  if (status === 'Stopped' || status === 'Paused') return 'text-zinc-500';
  return 'text-zinc-400';
}

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

function jellyfinSearchUrl(serverBase: string, finalPath: string | null): string | null {
  const title = titleFromPath(finalPath);
  if (!title) return null;
  return `${serverBase}/web/#/search.html?query=${encodeURIComponent(searchableTitle(title))}`;
}

function modeBadge(mode: Mode) {
  return mode === 'tv'
    ? { label: 'TV', icon: Tv, color: 'text-purple-400 bg-purple-400/10' }
    : { label: 'Movie', icon: Film, color: 'text-amber-400 bg-amber-400/10' };
}

// ── Seeding stats ──

function ratioColor(r: number): string {
  if (r >= 5) return 'text-emerald-400';
  if (r >= 2) return 'text-lime-400';
  if (r >= 1) return 'text-amber-400';
  return 'text-zinc-400';
}

function StatTile({
  label, value, sublabel, icon: Icon, accent = 'text-cyan-400',
}: {
  label: string; value: string; sublabel?: string; icon: React.ElementType; accent?: string;
}) {
  return (
    <div className="rounded-lg bg-card/60 border border-border/40 p-3 flex-1 min-w-[140px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
        <Icon className={`h-3 w-3 ${accent}`} />
        {label}
      </div>
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>}
    </div>
  );
}

function SeedingPanel({ stats }: { stats: SeedStats | null }) {
  if (!stats) return null;
  const { session, ratio, seedingNow, topSeeded } = stats;
  const cum = session.cumulative;
  return (
    <div className="rounded-xl bg-card border border-border/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-foreground">Seeding</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">
          across {session.cumulative.sessionCount} session{session.cumulative.sessionCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatTile
          label="Ratio"
          value={ratio.toFixed(2)}
          sublabel={`target 10.00`}
          icon={Share2}
          accent={ratioColor(ratio)}
        />
        <StatTile
          label="Uploaded"
          value={fmtBytes(cum.uploadedBytes)}
          sublabel={`↑ ${fmtSpeed(session.uploadSpeed, '0')} now`}
          icon={Upload}
          accent="text-amber-400"
        />
        <StatTile
          label="Downloaded"
          value={fmtBytes(cum.downloadedBytes)}
          sublabel={`↓ ${fmtSpeed(session.downloadSpeed, '0')} now`}
          icon={Download}
          accent="text-blue-400"
        />
        <StatTile
          label="Active"
          value={`${seedingNow} / ${session.torrentCount}`}
          sublabel={`${session.pausedTorrentCount} paused`}
          icon={CheckCircle}
          accent="text-emerald-400"
        />
      </div>

      {topSeeded.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Top contributors
          </div>
          {topSeeded.map((t, i) => (
            <div key={i} className="flex items-center gap-3 text-xs py-1">
              <span className="text-muted-foreground tabular-nums w-4 text-right">{i + 1}.</span>
              <span className="flex-1 truncate font-mono text-foreground/80">{t.name}</span>
              <span className="text-amber-400 tabular-nums">{fmtBytes(t.uploadedEver)}</span>
              <span className={`tabular-nums w-12 text-right ${ratioColor(t.ratio)}`}>
                {t.ratio.toFixed(2)}x
              </span>
              <span className="text-muted-foreground tabular-nums w-10 text-right">
                {fmtDuration(t.secondsSeeding)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Submit form ──

function SubmitForm({ onSubmitted }: { onSubmitted: () => void }) {
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
    <div className="rounded-xl bg-card border border-border/60 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-foreground">Add a torrent</h3>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['movie', 'tv'] as const).map((m) => {
          const badge = modeBadge(m);
          const Icon = badge.icon;
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
                active
                  ? 'bg-primary/15 border-primary/40 text-foreground'
                  : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {m === 'movie' ? 'Movie' : 'TV Show'}
            </button>
          );
        })}
      </div>

      {/* Link input */}
      <div className="space-y-2">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="magnet:?xt=urn:btih:…  or  https://…/file.torrent"
          className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
        />

        {preview && (
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-muted-foreground flex items-start gap-2 px-1"
          >
            <Eye className="h-3 w-3 mt-0.5 flex-shrink-0 text-cyan-400/70" />
            <span className="font-mono break-all">
              <span className="text-zinc-500">→ </span>
              <span className="text-cyan-300/80">{preview}</span>
            </span>
          </motion.div>
        )}
      </div>

      {/* Submit + status */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={submitting || !link.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Submit
        </button>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="text-xs text-red-400 flex items-center gap-1.5"
            >
              <AlertTriangle className="h-3 w-3" /> {error}
            </motion.div>
          )}
          {okFlash && (
            <motion.div
              key="ok"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="text-xs text-emerald-400 flex items-center gap-1.5"
            >
              <CheckCircle className="h-3 w-3" />
              <span className="truncate max-w-xs">Added: {okFlash}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Torrent row ──

function TorrentRow({
  t, onRemove, onSeed,
}: {
  t: Transfer;
  onRemove: (t: Transfer, deleteData: boolean) => void;
  onSeed: (t: Transfer, action: 'start' | 'stop') => void;
}) {
  const badge = modeBadge(t.mode);
  const Icon = badge.icon;
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
      className={`relative rounded-lg bg-card border border-border/60 p-4 pl-5 space-y-2.5 overflow-hidden ${
        paused ? 'opacity-60' : ''
      }`}
    >
      {/* Status spine on the left edge */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.dot}`} />

      <div className="flex items-start gap-3">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1 mt-0.5`}>
          <Icon className="h-3 w-3" /> {badge.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm text-foreground truncate font-mono flex-1 min-w-0">{t.name}</div>
            {t.archived && (
              <span title="Archived (.torrent saved)" className="text-cyan-400/60">
                <Archive className="h-3 w-3" />
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1 flex-wrap">
            <span className={statusColor(t.status)}>{t.status}</span>
            <span>{fmtBytes(t.totalBytes)}</span>
            {!isDone && !paused && (
              <>
                <span className="text-blue-400">↓ {fmtSpeed(t.downBps, '0')}</span>
                <span className="text-amber-400">↑ {fmtSpeed(t.upBps, '0')}</span>
                {t.eta > 0 && <span>ETA {fmtEta(t.eta)}</span>}
              </>
            )}
            {isDone && !paused && (
              <>
                <span className="text-amber-400">↑ {fmtSpeed(t.upBps, '0')}</span>
                <span className={`tabular-nums ${ratioColor(t.ratio)}`}>ratio {t.ratio.toFixed(2)}</span>
                {t.uploadedEver > 0 && <span>shared {fmtBytes(t.uploadedEver)}</span>}
                {seeding && t.secondsSeeding > 0 && <span>{fmtDuration(t.secondsSeeding)} seeded</span>}
              </>
            )}
            {paused && t.uploadedEver > 0 && (
              <span>shared {fmtBytes(t.uploadedEver)} · ratio {t.ratio.toFixed(2)}</span>
            )}
          </div>
          {t.error && (
            <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {t.error}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {paused ? (
            <button
              onClick={() => onSeed(t, 'start')}
              className="p-1.5 rounded hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-400 transition-colors"
              title="Resume"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => onSeed(t, 'stop')}
              className="p-1.5 rounded hover:bg-amber-500/15 text-muted-foreground hover:text-amber-400 transition-colors"
              title={seeding ? 'Pause seeding' : 'Pause'}
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
            className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Remove (keep data)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Remove "${t.name}" AND delete its files in staging?`)) {
                onRemove(t, true);
              }
            }}
            className="p-1.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors"
            title="Remove and delete data"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ProgressBar
          percent={t.percent * 100}
          color={paused ? 'bg-zinc-500' : isDone ? 'bg-emerald-500' : 'bg-blue-500'}
        />
        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{pct}%</span>
      </div>
    </motion.div>
  );
}

// ── Torrents (unified, filterable, grouped) ──

function TorrentsPanel({
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
      <div className="rounded-xl border border-border/60 p-5 text-center text-sm text-muted-foreground">
        <WifiOff className="h-5 w-5 mx-auto mb-2 text-red-400/60" />
        Can&#39;t reach transmission-daemon. Run <span className="font-mono text-foreground">scripts/jellyfin/setup-daemon.sh</span>.
      </div>
    );
  }

  const filterPills: { value: Filter; label: string }[] = [
    { value: 'all',         label: 'All' },
    { value: 'downloading', label: 'Downloading' },
    { value: 'seeding',     label: 'Seeding' },
    { value: 'paused',      label: 'Paused' },
  ];

  return (
    <div className="space-y-3">
      {/* Filter + search bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <ListFilter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <div className="flex items-center gap-1 flex-wrap">
          {filterPills.map((p) => {
            const active = filter === p.value;
            const count = counts[p.value];
            return (
              <button
                key={p.value}
                onClick={() => setFilter(p.value)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${
                  active
                    ? 'bg-primary/15 border-primary/40 text-foreground'
                    : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {p.label}
                <span className={`tabular-nums text-[10px] ${active ? 'text-foreground/70' : 'text-muted-foreground/70'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto flex-1 min-w-[180px] max-w-xs">
          <Search className="h-3 w-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name…"
            className="w-full pl-7 pr-7 py-1.5 rounded-md bg-muted/40 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
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
        <div className="rounded-xl border border-border/60 p-5 text-center text-sm text-muted-foreground">
          {transfers.length === 0
            ? 'No torrents yet. Submit a link above to start.'
            : q
              ? <>No torrents match <span className="font-mono text-foreground">&ldquo;{query}&rdquo;</span>.</>
              : 'No torrents in this state.'}
        </div>
      ) : (
        <div className="space-y-4">
          {GROUP_ORDER.map((g) => {
            const items = grouped[g];
            if (items.length === 0) return null;
            const meta = GROUP_META[g];
            const GIcon = meta.icon;
            // Hide the section header when filter narrows to one group anyway.
            const showHeader = filter === 'all';
            return (
              <div key={g} className="space-y-2">
                {showHeader && (
                  <div className="sticky top-[57px] z-10 -mx-1 px-1 py-1 backdrop-blur-sm bg-background/80 border-b border-border/30">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      <GIcon className={`h-3 w-3 ${meta.color}`} />
                      <span className={meta.color}>{meta.label}</span>
                      <span className="text-muted-foreground tabular-nums">{items.length}</span>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {items.map((t) => (
                    <TorrentRow key={t.id} t={t} onRemove={onRemove} onSeed={onSeed} />
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

// ── History ──

function History({ history, jellyfinBase }: { history: HistoryRow[]; jellyfinBase: string | null }) {
  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 p-5 text-center text-sm text-muted-foreground">
        No history yet.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {history.map((row) => {
        const badge = modeBadge(row.mode);
        const Icon = badge.icon;
        const ingested = row.status === 'ingested';
        const openUrl = ingested && jellyfinBase ? jellyfinSearchUrl(jellyfinBase, row.final_path) : null;
        const handleOpen = openUrl
          ? () => window.open(openUrl, '_blank', 'noopener,noreferrer')
          : undefined;
        return (
          <motion.div
            key={row.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={handleOpen}
            className={`rounded-lg bg-card/60 border border-border/40 p-3 transition-colors ${
              handleOpen
                ? 'cursor-pointer hover:bg-card hover:border-cyan-400/30 active:bg-card/80'
                : ''
            }`}
            title={handleOpen ? 'Open in Jellyfin' : undefined}
          >
            <div className="flex items-start gap-3">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1 mt-0.5`}>
                <Icon className="h-3 w-3" /> {badge.label}
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm text-foreground/90 truncate font-mono">
                  {(row.original_name || '(unknown)').replace(/\+/g, ' ')}
                </div>
                {row.final_path && (
                  <div className="text-xs text-cyan-300/70 flex items-start gap-1.5 font-mono">
                    <ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-zinc-500" />
                    <span className="break-all">{row.final_path}</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap pt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {fmtTime(row.submitted_at)}
                  </span>
                  <span className={ingested ? 'text-emerald-400' : 'text-amber-400'}>
                    {row.status}
                  </span>
                  {row.files.length > 0 && (
                    <span>{row.files.length} file{row.files.length === 1 ? '' : 's'}</span>
                  )}
                  {row.error_message && (
                    <span className="text-red-400">{row.error_message}</span>
                  )}
                </div>
              </div>
              {ingested && (
                handleOpen ? (
                  <ExternalLink className="h-4 w-4 text-cyan-400/80 mt-0.5" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" />
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
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<SeedStats | null>(null);
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [jellyfinBase, setJellyfinBase] = useState<string | null>(null);

  // Build the Jellyfin server URL from whatever hostname the user is on.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJellyfinBase(`${window.location.protocol}//${window.location.hostname}:8096`);
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

  return (
    <PageTransition>
      <div className="p-6 md:p-8">
        <div className="container mx-auto max-w-4xl space-y-6">
          <FadeIn>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-3">
                  <Film className="h-7 w-7 text-cyan-400" />
                  Jellyfin Fetcher
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                  Submit a magnet or .torrent. Files are auto-cleaned and dropped into the right Jellyfin folder.
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <ConnectionBadge ok={daemonOk} upLabel="Daemon up" downLabel="Daemon down" />
                {jellyfinBase && (
                  <a
                    href={jellyfinBase}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-cyan-400/10 transition-colors"
                  >
                    Open Jellyfin
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.05}>
            <SubmitForm onSubmitted={() => { refreshTransfers(); refreshHistory(); }} />
          </FadeIn>

          {daemonOk && stats && (
            <FadeIn delay={0.07}>
              <SeedingPanel stats={stats} />
            </FadeIn>
          )}

          <FadeIn delay={0.1}>
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Download className="h-4 w-4 text-blue-400" />
                Torrents
                {transfers.length > 0 && (
                  <span className="text-xs text-muted-foreground">({transfers.length})</span>
                )}
              </h2>
              <TorrentsPanel
                transfers={transfers}
                onRemove={handleRemove}
                onSeed={handleSeed}
                daemonOk={daemonOk !== false}
              />
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-400" />
                Recent
                {history.length > 0 && (
                  <span className="text-xs text-muted-foreground">({history.length})</span>
                )}
              </h2>
              <History history={history} jellyfinBase={jellyfinBase} />
            </div>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
