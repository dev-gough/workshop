'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Film, Tv, Download, Loader, Wifi, WifiOff, Plus, X,
  CheckCircle, AlertTriangle, ArrowRight, Clock, Trash2, Eye,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

// ── Types ──

type Mode = 'tv' | 'movie';

interface Transfer {
  id: number;
  hash: string;
  name: string;
  status: string;
  percent: number;
  totalBytes: number;
  downBps: number;
  upBps: number;
  eta: number;
  ratio: number;
  error: string | null;
  downloadDir: string;
  mode: Mode;
  addedAt: string | null;
  doneAt: string | null;
  dbId: number | null;
  dbStatus: string | null;
}

interface IngestFile {
  id: number;
  source: string;
  dest: string;
  size: number;
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

function fmtBytes(bytes: number | string | null): string {
  const n = typeof bytes === 'string' ? parseInt(bytes) : bytes;
  if (!n || n <= 0) return '–';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function fmtSpeed(bps: number): string {
  if (!bps || bps <= 0) return '0';
  if (bps < 1024 * 1024) return (bps / 1024).toFixed(1) + ' KB/s';
  return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function fmtEta(seconds: number): string {
  if (!seconds || seconds < 0) return '–';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function statusColor(status: string): string {
  if (status === 'Downloading') return 'text-blue-400';
  if (status === 'Seeding') return 'text-emerald-400';
  if (status === 'Verifying') return 'text-amber-400';
  if (status === 'Stopped' || status === 'Paused') return 'text-zinc-500';
  return 'text-zinc-400';
}

function modeBadge(mode: Mode) {
  return mode === 'tv'
    ? { label: 'TV', icon: Tv, color: 'text-purple-400 bg-purple-400/10' }
    : { label: 'Movie', icon: Film, color: 'text-amber-400 bg-amber-400/10' };
}

// ── Components ──

function ProgressBar({ percent, color = 'bg-blue-500' }: { percent: number; color?: string }) {
  return (
    <div className="h-1 bg-muted/60 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent * 100, 100)}%` }}
        transition={{ duration: 0.3 }}
      />
    </div>
  );
}

function ConnectionBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return (
    <span className="text-xs text-zinc-500 flex items-center gap-1">
      <Loader className="h-3 w-3 animate-spin" /> Checking…
    </span>
  );
  return ok
    ? <span className="text-xs text-emerald-400 flex items-center gap-1"><Wifi className="h-3 w-3" /> Daemon up</span>
    : <span className="text-xs text-red-400 flex items-center gap-1"><WifiOff className="h-3 w-3" /> Daemon down</span>;
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

// ── Active transfers ──

function ActiveTransfers({
  transfers, onRemove, daemonOk,
}: { transfers: Transfer[]; onRemove: (t: Transfer, deleteData: boolean) => void; daemonOk: boolean }) {
  if (!daemonOk) {
    return (
      <div className="rounded-xl border border-border/60 p-5 text-center text-sm text-muted-foreground">
        <WifiOff className="h-5 w-5 mx-auto mb-2 text-red-400/60" />
        Can&#39;t reach transmission-daemon. Run <span className="font-mono text-foreground">scripts/jellyfin/setup-daemon.sh</span>.
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 p-5 text-center text-sm text-muted-foreground">
        No active torrents. Submit a link above to start.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transfers.map((t) => {
        const badge = modeBadge(t.mode);
        const Icon = badge.icon;
        const pct = Math.round(t.percent * 100);
        const isDone = t.percent >= 1;
        return (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-card border border-border/60 p-4 space-y-2.5"
          >
            <div className="flex items-start gap-3">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1 mt-0.5`}>
                <Icon className="h-3 w-3" /> {badge.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate font-mono">{t.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1 flex-wrap">
                  <span className={statusColor(t.status)}>{t.status}</span>
                  <span>{fmtBytes(t.totalBytes)}</span>
                  {!isDone && (
                    <>
                      <span className="text-blue-400">↓ {fmtSpeed(t.downBps)}</span>
                      <span className="text-amber-400">↑ {fmtSpeed(t.upBps)}</span>
                      {t.eta > 0 && <span>ETA {fmtEta(t.eta)}</span>}
                    </>
                  )}
                  {isDone && (
                    <>
                      <span className="text-amber-400">↑ {fmtSpeed(t.upBps)}</span>
                      <span>ratio {t.ratio.toFixed(2)}</span>
                    </>
                  )}
                </div>
                {t.error && (
                  <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {t.error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
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
              <ProgressBar percent={t.percent} color={isDone ? 'bg-emerald-500' : 'bg-blue-500'} />
              <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{pct}%</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── History ──

function History({ history }: { history: HistoryRow[] }) {
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
        return (
          <motion.div
            key={row.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg bg-card/60 border border-border/40 p-3"
          >
            <div className="flex items-start gap-3">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1 mt-0.5`}>
                <Icon className="h-3 w-3" /> {badge.label}
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm text-foreground/90 truncate font-mono">
                  {row.original_name || '(unknown)'}
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
              {ingested && <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5" />}
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
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);

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

  useEffect(() => {
    refreshTransfers();
    refreshHistory();
    const t = setInterval(refreshTransfers, 2000);
    const h = setInterval(refreshHistory, 6000);
    return () => { clearInterval(t); clearInterval(h); };
  }, [refreshTransfers, refreshHistory]);

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
              <ConnectionBadge ok={daemonOk} />
            </div>
          </FadeIn>

          <FadeIn delay={0.05}>
            <SubmitForm onSubmitted={() => { refreshTransfers(); refreshHistory(); }} />
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Download className="h-4 w-4 text-blue-400" />
                  Active
                  {transfers.length > 0 && (
                    <span className="text-xs text-muted-foreground">({transfers.length})</span>
                  )}
                </h2>
              </div>
              <ActiveTransfers transfers={transfers} onRemove={handleRemove} daemonOk={daemonOk !== false} />
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
              <History history={history} />
            </div>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
