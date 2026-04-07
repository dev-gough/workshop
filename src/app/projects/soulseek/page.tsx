'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Download, Upload, FolderOpen, BarChart3,
  ChevronRight, ChevronDown, Clock, User, Zap,
  CheckCircle, XCircle, Loader, Music, ArrowDown,
  ArrowUp, Wifi, WifiOff, RefreshCw, Trash2,
  Check, X, Edit3, Play, File, Folder,
  HardDrive, Users, TrendingUp, Activity,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

// ── Types ──

interface SearchResponse {
  username: string;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
  fileCount: number;
  lockedFileCount: number;
  files: SearchFile[];
}

interface SearchFile {
  filename: string;
  size: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
  code?: string;
}

interface SearchResult {
  id: string;
  searchText: string;
  state: string;
  responseCount: number;
  fileCount: number;
  responses: SearchResponse[];
}

interface Transfer {
  id: string;
  username: string;
  direction: string;
  filename: string;
  size: number;
  startOffset: number;
  state: string;
  bytesTransferred: number;
  bytesRemaining: number;
  averageSpeed: number;
  percentComplete: number;
  startedAt?: string;
  endedAt?: string;
  exception?: string;
}

interface StagingItem {
  id: number;
  username: string;
  remote_path: string;
  filename: string;
  artist: string | null;
  album: string | null;
  size_bytes: number;
  speed_bytes_per_sec: number;
  status: string;
  created_at: string;
}

interface DownloadRecord {
  id: number;
  username: string;
  filename: string;
  artist: string | null;
  album: string | null;
  size_bytes: number;
  speed_bytes_per_sec: number;
  status: string;
  local_path: string | null;
  created_at: string;
  completed_at: string | null;
}

interface BrowseDir {
  name: string;
  fileCount: number;
  files: SearchFile[];
}

interface StatsData {
  downloads: {
    summary: { total: string; completed: string; staging: string; failed: string; total_bytes: string; avg_speed: string; unique_sources: string };
    topSources: { username: string; count: string; total_bytes: string }[];
    daily: { date: string; count: string }[];
    recent: DownloadRecord[];
  };
  uploads: {
    summary: { total: string; completed: string; total_bytes: string; avg_speed: string; unique_users: string };
    topUsers: { username: string; count: string; total_bytes: string }[];
    daily: { date: string; count: string }[];
    recent: DownloadRecord[];
  };
}

interface SearchHistoryItem {
  id: number;
  query: string;
  result_count: number;
  slskd_search_id: string;
  created_at: string;
}

// ── Helpers ──

function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function qualityBadge(file: SearchFile): { label: string; color: string } {
  const ext = file.filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac' || file.bitDepth) {
    const depth = file.bitDepth || 16;
    const rate = file.sampleRate ? Math.round(file.sampleRate / 1000) : 44.1;
    return { label: `FLAC ${depth}/${rate}`, color: 'text-amber-400 bg-amber-400/10' };
  }
  if (file.bitRate) {
    if (file.bitRate >= 320) return { label: `${ext.toUpperCase()} 320`, color: 'text-emerald-400 bg-emerald-400/10' };
    if (file.bitRate >= 256) return { label: `${ext.toUpperCase()} ${file.bitRate}`, color: 'text-blue-400 bg-blue-400/10' };
    if (file.bitRate >= 192) return { label: `${ext.toUpperCase()} ${file.bitRate}`, color: 'text-cyan-400 bg-cyan-400/10' };
    return { label: `${ext.toUpperCase()} ${file.bitRate}`, color: 'text-zinc-400 bg-zinc-400/10' };
  }
  return { label: ext.toUpperCase(), color: 'text-zinc-500 bg-zinc-500/10' };
}

function basename(filepath: string): string {
  return filepath.replace(/\\/g, '/').split('/').pop() || filepath;
}

function transferStateLabel(state: string): { label: string; color: string } {
  if (state.includes('Completed') && state.includes('Succeeded')) return { label: 'Done', color: 'text-emerald-400' };
  if (state.includes('InProgress')) return { label: 'Downloading', color: 'text-blue-400' };
  if (state.includes('Queued') || state.includes('Initializing')) return { label: 'Queued', color: 'text-amber-400' };
  if (state.includes('Cancelled')) return { label: 'Cancelled', color: 'text-zinc-500' };
  if (state.includes('Errored') || state.includes('Rejected')) return { label: 'Error', color: 'text-red-400' };
  return { label: state.split(',')[0] || state, color: 'text-zinc-400' };
}

// ── Tab definitions ──

type TabId = 'search' | 'downloads' | 'uploads' | 'browse' | 'stats';
const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'browse', label: 'Browse', icon: FolderOpen },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
];

// ── Components ──

function ConnectionBadge({ connected }: { connected: boolean | null }) {
  if (connected === null) return <span className="text-xs text-zinc-500 flex items-center gap-1"><Loader className="h-3 w-3 animate-spin" /> Checking...</span>;
  return connected
    ? <span className="text-xs text-emerald-400 flex items-center gap-1"><Wifi className="h-3 w-3" /> Connected</span>
    : <span className="text-xs text-red-400 flex items-center gap-1"><WifiOff className="h-3 w-3" /> Disconnected</span>;
}

function ProgressBar({ percent, color = 'bg-blue-500' }: { percent: number; color?: string }) {
  return (
    <div className="h-1 bg-muted/60 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent, 100)}%` }}
        transition={{ duration: 0.3 }}
      />
    </div>
  );
}

function QualityTag({ file }: { file: SearchFile }) {
  const badge = qualityBadge(file);
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>;
}

// ── Search Tab ──

function SearchTab() {
  const [query, setQuery] = useState('');
  const [searchId, setSearchId] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load search history
  useEffect(() => {
    fetch('/api/soulseek/search').then(r => r.json()).then(d => setHistory(d.searches || [])).catch(() => {});
  }, []);

  // Poll for results when searching
  useEffect(() => {
    if (!searchId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/soulseek/search/${searchId}`);
        const data: SearchResult = await res.json();
        setResults(data);
        if (data.state === 'Completed') {
          setSearching(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [searchId]);

  const handleSearch = async (q?: string) => {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    setSearching(true);
    setResults(null);
    setExpandedUsers(new Set());
    setShowHistory(false);
    if (q) setQuery(q);
    try {
      const res = await fetch('/api/soulseek/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      const data = await res.json();
      setSearchId(data.searchId);
      // Refresh history
      fetch('/api/soulseek/search').then(r => r.json()).then(d => setHistory(d.searches || [])).catch(() => {});
    } catch {
      setSearching(false);
    }
  };

  const handleDownload = async (username: string, files: SearchFile[]) => {
    try {
      await fetch('/api/soulseek/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, files: files.map(f => ({ filename: f.filename, size: f.size })) }),
      });
    } catch {}
  };

  const toggleUser = (username: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const sortedResponses = useMemo(() => {
    if (!results?.responses) return [];
    return [...results.responses].sort((a, b) => {
      // Sort: free slots first, then by file count desc
      if (a.hasFreeUploadSlot !== b.hasFreeUploadSlot) return a.hasFreeUploadSlot ? -1 : 1;
      return b.fileCount - a.fileCount;
    });
  }, [results]);

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => history.length > 0 && setShowHistory(true)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search for music..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={searching || !query.trim()}
            className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {searching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>

        {/* Search history dropdown */}
        <AnimatePresence>
          {showHistory && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute z-20 top-full mt-1 w-full rounded-lg bg-card border border-border/60 shadow-xl overflow-hidden"
            >
              <div className="p-2 border-b border-border/40">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recent Searches</span>
              </div>
              {history.slice(0, 8).map(h => (
                <button
                  key={h.id}
                  onClick={() => { handleSearch(h.query); setShowHistory(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span>{h.query}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{h.result_count} results</span>
                </button>
              ))}
              <button
                onClick={() => setShowHistory(false)}
                className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground text-center border-t border-border/40"
              >
                Close
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Click-away to close history */}
      {showHistory && <div className="fixed inset-0 z-10" onClick={() => setShowHistory(false)} />}

      {/* Search status */}
      {searching && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/30 border border-border/40">
          <Loader className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Searching the network...
            {results && <span className="text-foreground ml-1">{results.responseCount} users, {results.fileCount} files</span>}
          </span>
        </div>
      )}

      {/* Results */}
      {results && sortedResponses.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">
              {results.responseCount} users · {results.fileCount} files
            </span>
          </div>

          <div className="space-y-1">
            {sortedResponses.map(response => {
              const expanded = expandedUsers.has(response.username);
              return (
                <div key={response.username} className="rounded-lg border border-border/40 bg-card/60 overflow-hidden">
                  {/* User header */}
                  <button
                    onClick={() => toggleUser(response.username)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors"
                  >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{response.username}</span>
                    <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
                      {response.hasFreeUploadSlot && (
                        <span className="text-emerald-400 flex items-center gap-1"><Zap className="h-3 w-3" /> Free slot</span>
                      )}
                      <span>{fmtSpeed(response.uploadSpeed)}</span>
                      <span>Q:{response.queueLength}</span>
                      <span>{response.fileCount} files</span>
                    </div>
                  </button>

                  {/* File list */}
                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-border/30">
                          {/* Download all button */}
                          <div className="px-3 py-1.5 flex justify-end border-b border-border/20">
                            <button
                              onClick={() => handleDownload(response.username, response.files)}
                              className="text-xs px-2.5 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
                            >
                              <Download className="h-3 w-3" /> Download All ({response.fileCount})
                            </button>
                          </div>
                          <div className="max-h-80 overflow-y-auto">
                            {response.files.map((file, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors text-xs group"
                              >
                                <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="text-foreground truncate flex-1 min-w-0 font-mono" title={file.filename}>
                                  {basename(file.filename)}
                                </span>
                                <QualityTag file={file} />
                                {file.length ? <span className="text-muted-foreground w-10 text-right">{fmtDuration(file.length)}</span> : null}
                                <span className="text-muted-foreground w-14 text-right">{fmtBytes(file.size)}</span>
                                <button
                                  onClick={() => handleDownload(response.username, [file])}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/20 text-primary transition-all"
                                >
                                  <Download className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results && !searching && sortedResponses.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No results found</p>
        </div>
      )}

      {!results && !searching && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-4 opacity-20" />
          <p className="text-sm">Search the Soulseek network for music</p>
          <p className="text-xs mt-1 opacity-60">Try an artist name, album, or song title</p>
        </div>
      )}
    </div>
  );
}

// ── Downloads Tab ──

function DownloadsTab() {
  const [liveDownloads, setLiveDownloads] = useState<Record<string, Transfer[]>>({});
  const [staging, setStaging] = useState<StagingItem[]>([]);
  const [completed, setCompleted] = useState<DownloadRecord[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editArtist, setEditArtist] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);

  // SSE for live transfers
  useEffect(() => {
    const es = new EventSource('/api/soulseek/transfers/stream');
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.downloads) setLiveDownloads(data.downloads);
      } catch {}
    };
    return () => { es.close(); eventSourceRef.current = null; };
  }, []);

  // Fetch staging and completed
  const fetchData = useCallback(async () => {
    try {
      const [stg, comp] = await Promise.all([
        fetch('/api/soulseek/ingest').then(r => r.json()),
        fetch('/api/soulseek/downloads?status=completed&limit=30').then(r => r.json()),
      ]);
      setStaging(stg.staging || []);
      setCompleted(comp.downloads || []);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const i = setInterval(fetchData, 15000); return () => clearInterval(i); }, [fetchData]);

  const handleApprove = async (item: StagingItem) => {
    const artist = editingId === item.id ? editArtist : item.artist;
    const album = editingId === item.id ? editAlbum : item.album;
    try {
      await fetch('/api/soulseek/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, artist, album }),
      });
      setEditingId(null);
      fetchData();
    } catch {}
  };

  const handleReject = async (item: StagingItem) => {
    try {
      await fetch('/api/soulseek/ingest', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      fetchData();
    } catch {}
  };

  // Flatten live transfers
  const activeTransfers = Object.entries(liveDownloads).flatMap(([username, transfers]) =>
    transfers.filter(t => !t.state.includes('Completed')).map(t => ({ ...t, username }))
  );

  return (
    <div className="space-y-6">
      {/* Active Downloads */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <Activity className="h-3.5 w-3.5" />
          Active Downloads
          {activeTransfers.length > 0 && <span className="text-foreground">({activeTransfers.length})</span>}
        </div>
        {activeTransfers.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-border/30 bg-card/30">
            No active downloads
          </div>
        ) : (
          <div className="space-y-1">
            {activeTransfers.map(t => {
              const stateInfo = transferStateLabel(t.state);
              return (
                <div key={t.id} className="rounded-lg border border-border/40 bg-card/60 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <User className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{t.username}</span>
                    <span className="text-foreground font-mono truncate flex-1">{basename(t.filename)}</span>
                    <span className={stateInfo.color}>{stateInfo.label}</span>
                    <span className="text-muted-foreground">{fmtSpeed(t.averageSpeed)}</span>
                    <span className="text-muted-foreground">{fmtBytes(t.bytesTransferred)} / {fmtBytes(t.size)}</span>
                  </div>
                  <ProgressBar percent={t.percentComplete} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Staging (Review) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <Edit3 className="h-3.5 w-3.5" />
          Staging — Review Before Ingestion
          {staging.length > 0 && <span className="text-amber-400">({staging.length})</span>}
        </div>
        {staging.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-border/30 bg-card/30">
            No files awaiting review
          </div>
        ) : (
          <div className="space-y-1">
            {staging.map(item => {
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Music className="h-3 w-3 text-amber-400" />
                    <span className="font-mono text-foreground truncate flex-1">{item.filename}</span>
                    <span className="text-muted-foreground">from {item.username}</span>
                    <span className="text-muted-foreground">{fmtBytes(item.size_bytes)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <input
                          value={editArtist}
                          onChange={e => setEditArtist(e.target.value)}
                          placeholder="Artist"
                          className="flex-1 px-2 py-1 rounded bg-muted/50 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <input
                          value={editAlbum}
                          onChange={e => setEditAlbum(e.target.value)}
                          placeholder="Album"
                          className="flex-1 px-2 py-1 rounded bg-muted/50 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">Artist:</span>
                        <span className="text-xs text-foreground">{item.artist || '—'}</span>
                        <span className="text-xs text-muted-foreground ml-2">Album:</span>
                        <span className="text-xs text-foreground">{item.album || '—'}</span>
                      </>
                    )}

                    <div className="flex items-center gap-1 ml-auto">
                      {!isEditing && (
                        <button
                          onClick={() => { setEditingId(item.id); setEditArtist(item.artist || ''); setEditAlbum(item.album || ''); }}
                          className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit metadata"
                        >
                          <Edit3 className="h-3 w-3" />
                        </button>
                      )}
                      {isEditing && (
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => handleApprove(item)}
                        className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                        title="Approve & ingest"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleReject(item)}
                        className="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                        title="Reject & delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <CheckCircle className="h-3.5 w-3.5" />
          Completed
        </div>
        {completed.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-border/30 bg-card/30">
            No completed downloads yet
          </div>
        ) : (
          <div className="rounded-lg border border-border/40 bg-card/60 overflow-hidden">
            {completed.map((dl, i) => (
              <div key={dl.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/20' : ''}`}>
                <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="font-mono text-foreground truncate flex-1">{dl.filename}</span>
                <span className="text-muted-foreground">{dl.artist} — {dl.album}</span>
                <span className="text-muted-foreground">{fmtBytes(dl.size_bytes)}</span>
                {dl.completed_at && <span className="text-muted-foreground">{fmtTime(dl.completed_at)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Uploads Tab ──

function UploadsTab() {
  const [liveUploads, setLiveUploads] = useState<Record<string, Transfer[]>>({});
  const [history, setHistory] = useState<DownloadRecord[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/soulseek/transfers/stream');
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.uploads) setLiveUploads(data.uploads);
      } catch {}
    };
    return () => { es.close(); eventSourceRef.current = null; };
  }, []);

  useEffect(() => {
    fetch('/api/soulseek/uploads?limit=50').then(r => r.json()).then(d => setHistory(d.uploads || [])).catch(() => {});
  }, []);

  const activeUploads = Object.entries(liveUploads).flatMap(([username, transfers]) =>
    transfers.filter(t => !t.state.includes('Completed')).map(t => ({ ...t, username }))
  );

  return (
    <div className="space-y-6">
      {/* Active Uploads */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <ArrowUp className="h-3.5 w-3.5" />
          Active Uploads
          {activeUploads.length > 0 && <span className="text-foreground">({activeUploads.length})</span>}
        </div>
        {activeUploads.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-border/30 bg-card/30">
            No active uploads
          </div>
        ) : (
          <div className="space-y-1">
            {activeUploads.map(t => {
              const stateInfo = transferStateLabel(t.state);
              return (
                <div key={t.id} className="rounded-lg border border-border/40 bg-card/60 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <User className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{t.username}</span>
                    <span className="text-foreground font-mono truncate flex-1">{basename(t.filename)}</span>
                    <span className={stateInfo.color}>{stateInfo.label}</span>
                    <span className="text-muted-foreground">{fmtSpeed(t.averageSpeed)}</span>
                  </div>
                  <ProgressBar percent={t.percentComplete} color="bg-emerald-500" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload History */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <Clock className="h-3.5 w-3.5" />
          Upload History
        </div>
        {history.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-border/30 bg-card/30">
            No upload history yet
          </div>
        ) : (
          <div className="rounded-lg border border-border/40 bg-card/60 overflow-hidden">
            {history.map((ul, i) => (
              <div key={ul.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/20' : ''}`}>
                <ArrowUp className="h-3 w-3 text-emerald-400 shrink-0" />
                <User className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-foreground">{ul.username}</span>
                <span className="font-mono text-muted-foreground truncate flex-1">{ul.filename}</span>
                <span className="text-muted-foreground">{fmtBytes(ul.size_bytes)}</span>
                {ul.speed_bytes_per_sec > 0 && <span className="text-muted-foreground">{fmtSpeed(ul.speed_bytes_per_sec)}</span>}
                <span className="text-muted-foreground">{fmtTime(ul.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Browse Tab ──

function BrowseTab() {
  const [username, setUsername] = useState('');
  const [dirs, setDirs] = useState<BrowseDir[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const handleBrowse = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    setDirs([]);
    setExpandedDirs(new Set());
    try {
      const res = await fetch(`/api/soulseek/browse?username=${encodeURIComponent(username.trim())}`);
      if (!res.ok) throw new Error('Failed to browse user');
      const data = await res.json();
      setDirs(data.directories || []);
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  };

  const toggleDir = (name: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDownloadFile = async (file: SearchFile) => {
    try {
      await fetch('/api/soulseek/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), files: [{ filename: file.filename, size: file.size }] }),
      });
    } catch {}
  };

  const handleDownloadDir = async (dir: BrowseDir) => {
    try {
      await fetch('/api/soulseek/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), files: dir.files.map(f => ({ filename: f.filename, size: f.size })) }),
      });
    } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleBrowse()}
            placeholder="Enter a Soulseek username..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
          />
        </div>
        <button
          onClick={handleBrowse}
          disabled={loading || !username.trim()}
          className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? <Loader className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          Browse
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 px-4 py-6 justify-center text-muted-foreground">
          <Loader className="h-4 w-4 animate-spin" />
          <span className="text-sm">Fetching file list from {username}...</span>
        </div>
      )}

      {dirs.length > 0 && (
        <div className="space-y-0.5">
          {dirs.map(dir => {
            const expanded = expandedDirs.has(dir.name);
            const dirName = dir.name.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/');
            return (
              <div key={dir.name} className="rounded-lg border border-border/40 bg-card/60 overflow-hidden">
                <button
                  onClick={() => toggleDir(dir.name)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
                >
                  {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  <Folder className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-foreground font-mono truncate flex-1 text-left">{dirName}</span>
                  <span className="text-muted-foreground">{dir.fileCount} files</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownloadDir(dir); }}
                    className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                    title="Download directory"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                </button>
                <AnimatePresence>
                  {expanded && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="border-t border-border/30 max-h-60 overflow-y-auto">
                        {dir.files.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors text-xs group pl-8">
                            <File className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-mono text-foreground truncate flex-1">{basename(file.filename)}</span>
                            <QualityTag file={file} />
                            {file.length ? <span className="text-muted-foreground">{fmtDuration(file.length)}</span> : null}
                            <span className="text-muted-foreground">{fmtBytes(file.size)}</span>
                            <button
                              onClick={() => handleDownloadFile(file)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/20 text-primary transition-all"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {!loading && dirs.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="h-10 w-10 mx-auto mb-4 opacity-20" />
          <p className="text-sm">Browse a user's shared files</p>
          <p className="text-xs mt-1 opacity-60">Enter their Soulseek username above</p>
        </div>
      )}
    </div>
  );
}

// ── Stats Tab ──

function StatsTab() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/soulseek/stats').then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader className="h-5 w-5 animate-spin mr-2" /> Loading statistics...
    </div>
  );

  if (!stats) return (
    <div className="text-center py-16 text-muted-foreground">
      <BarChart3 className="h-10 w-10 mx-auto mb-4 opacity-20" />
      <p className="text-sm">No statistics available yet</p>
    </div>
  );

  const dl = stats.downloads.summary;
  const ul = stats.uploads.summary;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={ArrowDown} label="Downloads" value={dl.completed} color="text-blue-400" />
        <StatCard icon={ArrowUp} label="Uploads" value={ul.completed} color="text-emerald-400" />
        <StatCard icon={HardDrive} label="Downloaded" value={fmtBytes(parseInt(dl.total_bytes))} color="text-cyan-400" />
        <StatCard icon={HardDrive} label="Uploaded" value={fmtBytes(parseInt(ul.total_bytes))} color="text-purple-400" />
        <StatCard icon={Users} label="Unique Users" value={String(parseInt(dl.unique_sources || '0') + parseInt(ul.unique_users || '0'))} color="text-amber-400" />
      </div>

      {/* Speed Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/40 bg-card/60 p-4">
          <div className="text-xs text-muted-foreground mb-1">Avg Download Speed</div>
          <div className="text-lg font-mono text-foreground">{fmtSpeed(parseFloat(dl.avg_speed))}</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/60 p-4">
          <div className="text-xs text-muted-foreground mb-1">Avg Upload Speed</div>
          <div className="text-lg font-mono text-foreground">{fmtSpeed(parseFloat(ul.avg_speed))}</div>
        </div>
      </div>

      {/* Daily Activity Chart */}
      {(stats.downloads.daily.length > 0 || stats.uploads.daily.length > 0) && (
        <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" /> Daily Activity (30 days)
          </div>
          <DailyChart downloads={stats.downloads.daily} uploads={stats.uploads.daily} />
        </div>
      )}

      {/* Top Sources / Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stats.downloads.topSources.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Download Sources</div>
            {stats.downloads.topSources.map((s, i) => (
              <div key={s.username} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-4">{i + 1}</span>
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="text-foreground flex-1">{s.username}</span>
                <span className="text-muted-foreground">{s.count} files</span>
                <span className="text-muted-foreground">{fmtBytes(parseInt(s.total_bytes))}</span>
              </div>
            ))}
          </div>
        )}
        {stats.uploads.topUsers.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Uploading To</div>
            {stats.uploads.topUsers.map((s, i) => (
              <div key={s.username} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-4">{i + 1}</span>
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="text-foreground flex-1">{s.username}</span>
                <span className="text-muted-foreground">{s.count} files</span>
                <span className="text-muted-foreground">{fmtBytes(parseInt(s.total_bytes))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stats.downloads.recent.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Downloads</div>
            {stats.downloads.recent.map(d => (
              <div key={d.id} className="flex items-center gap-2 text-xs">
                <ArrowDown className="h-3 w-3 text-blue-400 shrink-0" />
                <span className="text-foreground truncate flex-1 font-mono">{d.filename}</span>
                <span className="text-muted-foreground">{fmtTime(d.created_at)}</span>
              </div>
            ))}
          </div>
        )}
        {stats.uploads.recent.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Uploads</div>
            {stats.uploads.recent.map(u => (
              <div key={u.id} className="flex items-center gap-2 text-xs">
                <ArrowUp className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="text-foreground">{u.username}</span>
                <span className="text-muted-foreground truncate flex-1 font-mono">{u.filename}</span>
                <span className="text-muted-foreground">{fmtTime(u.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold font-mono text-foreground">{value}</p>
    </div>
  );
}

function DailyChart({ downloads, uploads }: { downloads: { date: string; count: string }[]; uploads: { date: string; count: string }[] }) {
  // Merge into a single timeline
  const dates = new Set<string>();
  downloads.forEach(d => dates.add(d.date));
  uploads.forEach(d => dates.add(d.date));
  const sortedDates = [...dates].sort();

  if (sortedDates.length === 0) return null;

  const dlMap = Object.fromEntries(downloads.map(d => [d.date, parseInt(d.count)]));
  const ulMap = Object.fromEntries(uploads.map(d => [d.date, parseInt(d.count)]));

  const maxVal = Math.max(
    ...sortedDates.map(d => Math.max(dlMap[d] || 0, ulMap[d] || 0)),
    1
  );

  return (
    <div className="flex items-end gap-0.5 h-24">
      {sortedDates.map(date => {
        const dlCount = dlMap[date] || 0;
        const ulCount = ulMap[date] || 0;
        const dlH = (dlCount / maxVal) * 100;
        const ulH = (ulCount / maxVal) * 100;
        return (
          <div key={date} className="flex-1 flex gap-px items-end h-full" title={`${date}: ${dlCount} dl / ${ulCount} ul`}>
            <div className="flex-1 bg-blue-500/60 rounded-t-sm" style={{ height: `${Math.max(dlH, 2)}%` }} />
            <div className="flex-1 bg-emerald-500/60 rounded-t-sm" style={{ height: `${Math.max(ulH, 2)}%` }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ──

export default function SoulseekPage() {
  const [activeTab, setActiveTab] = useState<TabId>('search');
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/soulseek/status')
      .then(r => r.json())
      .then(d => setConnected(d.server?.isConnected ?? false))
      .catch(() => setConnected(false));
  }, []);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-5xl px-4 py-8">
          {/* Header */}
          <FadeIn>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Soulseek</h1>
                <p className="text-sm text-muted-foreground mt-0.5">P2P Music Network</p>
              </div>
              <ConnectionBadge connected={connected} />
            </div>
          </FadeIn>

          {/* Tab Navigation */}
          <FadeIn delay={0.05}>
            <div className="flex items-center gap-1 mb-6 p-1 bg-muted/30 rounded-lg border border-border/40 w-fit">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </FadeIn>

          {/* Tab Content */}
          <FadeIn delay={0.1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'search' && <SearchTab />}
                {activeTab === 'downloads' && <DownloadsTab />}
                {activeTab === 'uploads' && <UploadsTab />}
                {activeTab === 'browse' && <BrowseTab />}
                {activeTab === 'stats' && <StatsTab />}
              </motion.div>
            </AnimatePresence>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
