'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Download, FolderOpen, ChevronRight, ChevronDown,
  Clock, User, Zap, CheckCircle, Loader, Music, ArrowDown,
  ArrowUp, Trash2, Check, X, Edit3, File, Folder, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useAudio } from '@/components/AudioProvider';
import { adminFetch } from '@/lib/admin-client';
import { buildLibraryIndex, matchFolder, type FolderMatch, type LibraryIndex } from '@/lib/libraryMatch';
import { useHeaderConfig } from '@/components/header-config';
import { fmtBytes as fmtBytesShared, fmtSpeed, fmtTime } from '@/lib/format';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { isActiveTransferState } from '@/lib/soulseek-transfers';
import LedgerTab from './_components/ledger';

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
  cleanedName?: string;
  coverImage?: string | null;
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

interface SearchHistoryItem {
  id: number;
  query: string;
  result_count: number;
  slskd_search_id: string;
  created_at: string;
}

// ── Helpers ──

// Soulseek shows '0 B' (not the shared '–') for empty/zero sizes.
function fmtBytes(bytes: number): string {
  return fmtBytesShared(bytes, '0 B');
}

// Clock-style m:ss duration (track length) — intentionally local, not in format.ts.
function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Quality reads in room colors: copper = lossless, signal green = top-rate lossy.
function qualityBadge(file: SearchFile): { label: string; color: string } {
  const ext = file.filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac' || file.bitDepth) {
    const depth = file.bitDepth || 16;
    const rate = file.sampleRate ? Math.round(file.sampleRate / 1000) : 44.1;
    return { label: `FLAC ${depth}/${rate}`, color: 'text-accent bg-accent/10' };
  }
  if (file.bitRate) {
    if (file.bitRate >= 320) return { label: `${ext.toUpperCase()} 320`, color: 'text-primary bg-primary/10' };
    if (file.bitRate >= 192) return { label: `${ext.toUpperCase()} ${file.bitRate}`, color: 'text-foreground/70 bg-muted/70' };
    return { label: `${ext.toUpperCase()} ${file.bitRate}`, color: 'text-muted-foreground bg-muted/60' };
  }
  return { label: ext.toUpperCase(), color: 'text-muted-foreground bg-muted/60' };
}

function basename(filepath: string): string {
  return filepath.replace(/\\/g, '/').split('/').pop() || filepath;
}

/** "In Library" — this folder is an album already on the BarFoo shelves.
    The tooltip says which album and on what evidence. */
function InLibraryBadge({ match }: { match: FolderMatch | null }) {
  if (!match) return null;
  const title = match.via === 'songs'
    ? `${match.artist} — ${match.album}: ${match.matched} of ${match.of} tracks already shelved`
    : `Folder name matches ${match.artist} — ${match.album}`;
  return (
    <span
      title={title}
      className="text-[9px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm border border-primary/40 bg-primary/5 text-primary shrink-0"
    >
      In Library
    </span>
  );
}

function transferStateLabel(state: string): { label: string; color: string } {
  if (state.includes('Completed') && state.includes('Succeeded')) return { label: 'Done', color: 'text-primary' };
  if (state.includes('InProgress')) return { label: 'On the wire', color: 'text-primary' };
  if (state.includes('Queued') || state.includes('Initializing')) return { label: 'Hold', color: 'text-accent' };
  if (state.includes('Cancelled')) return { label: 'Dropped', color: 'text-muted-foreground' };
  if (state.includes('Errored') || state.includes('Rejected')) return { label: 'Fault', color: 'text-destructive' };
  return { label: state.split(',')[0] || state, color: 'text-muted-foreground' };
}

function isActive(t: Transfer): boolean {
  return isActiveTransferState(t.state);
}

function isMoving(t: Transfer): boolean {
  return t.state.includes('InProgress');
}

// ── Tab definitions ──

type TabId = 'search' | 'transfers' | 'ledger';
const TABS: { id: TabId; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'ledger', label: 'Ledger' },
];

// ── Small room hardware ──

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.2em]';

function QualityTag({ file }: { file: SearchFile }) {
  const badge = qualityBadge(file);
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${badge.color}`}>{badge.label}</span>;
}

function EmptySlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-6 text-muted-foreground text-sm rounded-lg border border-dashed border-border/70 bg-card/30">
      {children}
    </div>
  );
}

function LineLamp({ connected }: { connected: boolean | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3.5 py-2">
      <span className={`slsk-lamp ${connected ? 'text-primary slsk-lamp-live' : connected === false ? 'text-destructive' : 'slsk-lamp-off'}`} />
      <div className="leading-tight">
        <p className={`${EYEBROW} !text-[9px] text-muted-foreground`}>Line</p>
        <p className="font-mono text-[11px] tabular-nums text-foreground">
          {connected == null ? 'checking…' : connected ? 'CONNECTED' : 'NO CARRIER'}
        </p>
      </div>
    </div>
  );
}

/** The exchange's two wires — live from the SSE feed on every tab. */
function WireMeter({ liveDownloads, liveUploads }: {
  liveDownloads: Record<string, Transfer[]>;
  liveUploads: Record<string, Transfer[]>;
}) {
  const rows: { dir: 'down' | 'up'; transfers: Transfer[] }[] = [
    { dir: 'down', transfers: Object.values(liveDownloads).flat().filter(isActive) },
    { dir: 'up', transfers: Object.values(liveUploads).flat().filter(isActive) },
  ];
  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3 space-y-2.5">
      {rows.map(({ dir, transfers }) => {
        const moving = transfers.filter(isMoving);
        const speed = moving.reduce((sum, t) => sum + (t.averageSpeed || 0), 0);
        const color = dir === 'down' ? 'text-primary' : 'text-accent';
        const live = transfers.length > 0;
        return (
          <div key={dir} className="flex items-center gap-3">
            <span className={`${EYEBROW} w-24 shrink-0 ${color}`}>
              {dir === 'down' ? '▼ down wire' : '▲ up wire'}
            </span>
            <span className={`slsk-lamp ${live ? `${color} slsk-lamp-live` : 'slsk-lamp-off'}`} />
            <span className="font-mono text-xs tabular-nums text-foreground w-40 shrink-0">
              {live ? `${transfers.length} live · ${fmtSpeed(speed)}` : 'idle'}
            </span>
            <div className={`slsk-wire flex-1 ${live ? `${color} slsk-wire-live` : 'text-border'} ${dir === 'up' ? 'slsk-wire-out' : ''}`} />
          </div>
        );
      })}
    </div>
  );
}

// ── Search tab (network search + peer browse) ──

function SearchTab({ libraryIndex, initialSearch }: { libraryIndex: LibraryIndex; initialSearch: string | null }) {
  const [mode, setMode] = useState<'network' | 'peer'>('network');
  const [peerSeed, setPeerSeed] = useState<{ name: string; key: number } | null>(null);
  const seedCounter = useRef(0);

  const browsePeer = (name: string) => {
    seedCounter.current += 1;
    setPeerSeed({ name, key: seedCounter.current });
    setMode('peer');
  };

  return (
    <div className="space-y-4">
      {/* Mode toggle — network-wide search, or patch straight into one peer */}
      <div className="flex w-fit rounded-md border border-border bg-muted/40 p-0.5">
        {(['network', 'peer'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-[5px] text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m === 'network' ? 'Network' : 'One peer'}
          </button>
        ))}
      </div>

      <div className={mode === 'network' ? '' : 'hidden'}>
        <NetworkSearch libraryIndex={libraryIndex} initialSearch={initialSearch} onBrowsePeer={browsePeer} />
      </div>
      <div className={mode === 'peer' ? '' : 'hidden'}>
        <PeerBrowse seed={peerSeed} libraryIndex={libraryIndex} />
      </div>
    </div>
  );
}

function NetworkSearch({ libraryIndex, initialSearch, onBrowsePeer }: {
  libraryIndex: LibraryIndex;
  initialSearch: string | null;
  onBrowsePeer: (username: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [searchId, setSearchId] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const FILE_TYPES = ['flac', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma'] as const;
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('slsk_file_types') || 'null')); }
    catch { return new Set(FILE_TYPES); }
  });
  const toggleType = (ext: string) => {
    setEnabledTypes(prev => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext); else next.add(ext);
      localStorage.setItem('slsk_file_types', JSON.stringify([...next]));
      return next;
    });
  };

  // Load search history
  useEffect(() => {
    fetch('/api/soulseek/search').then(r => r.json()).then(d => setHistory(d.searches || [])).catch(() => {});
  }, []);

  // Auto-search from ?search= query param
  const initialSearchHandled = useRef(false);
  useEffect(() => {
    if (initialSearch && !initialSearchHandled.current) {
      initialSearchHandled.current = true;
      setQuery(initialSearch);
      handleSearch(initialSearch);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch]);

  // Poll for results when searching
  useEffect(() => {
    if (!searchId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/soulseek/search/${searchId}`);
        const data: SearchResult = await res.json();
        setResults(data);
        if (data.state.includes('Completed')) {
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

  const [downloadingKeys, setDownloadingKeys] = useState<Set<string>>(new Set());

  const handleDownload = async (username: string, files: SearchFile[], buttonKey: string) => {
    setDownloadingKeys(prev => new Set(prev).add(buttonKey));
    try {
      await fetch('/api/soulseek/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, files: files.map(f => ({ filename: f.filename, size: f.size })) }),
      });
    } catch {}
    // Keep green for 2s then clear
    setTimeout(() => {
      setDownloadingKeys(prev => { const next = new Set(prev); next.delete(buttonKey); return next; });
    }, 2000);
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
    // Filter files by enabled types, then exclude empty responses
    return results.responses
      .map(r => {
        const filtered = r.files.filter(f => {
          const ext = f.filename.split('.').pop()?.toLowerCase() || '';
          return enabledTypes.has(ext);
        });
        return { ...r, files: filtered, fileCount: filtered.length };
      })
      .filter(r => r.fileCount > 0)
      .sort((a, b) => {
        if (a.hasFreeUploadSlot !== b.hasFreeUploadSlot) return a.hasFreeUploadSlot ? -1 : 1;
        return b.fileCount - a.fileCount;
      });
  }, [results, enabledTypes]);

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
              placeholder="Put a call out on the network…"
              className="w-full pl-10 pr-4 py-2.5 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={searching || !query.trim()}
            className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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
              className="absolute z-20 top-full mt-1 w-full rounded-md bg-popover border border-border shadow-xl overflow-hidden"
            >
              <div className="p-2 border-b border-border/60">
                <span className={`${EYEBROW} text-muted-foreground`}>Call log</span>
              </div>
              {history.slice(0, 8).map(h => (
                <button
                  key={h.id}
                  onClick={() => { handleSearch(h.query); setShowHistory(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span>{h.query}</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">{h.result_count} results</span>
                </button>
              ))}
              <button
                onClick={() => setShowHistory(false)}
                className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground text-center border-t border-border/60"
              >
                Close
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Click-away to close history */}
      {showHistory && <div className="fixed inset-0 z-10" onClick={() => setShowHistory(false)} />}

      {/* File type filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`${EYEBROW} text-muted-foreground`}>Formats:</span>
        {FILE_TYPES.map(ext => (
          <button
            key={ext}
            onClick={() => toggleType(ext)}
            className={`text-[11px] font-mono px-2 py-0.5 rounded-sm transition-colors ${
              enabledTypes.has(ext)
                ? ext === 'flac' ? 'bg-accent/15 text-accent' : 'bg-muted/70 text-foreground'
                : 'bg-transparent text-muted-foreground/40 line-through'
            }`}
          >
            {ext}
          </button>
        ))}
      </div>

      {/* Search status */}
      {searching && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card/60 border border-border">
          <span className="slsk-lamp text-primary slsk-lamp-live" />
          <span className="text-sm text-muted-foreground">
            Ringing the network…
            {results && <span className="text-foreground font-mono tabular-nums ml-1">{results.responseCount} peers, {results.fileCount} files</span>}
          </span>
        </div>
      )}

      {/* Results */}
      {results && sortedResponses.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {results.responseCount} peers · {results.fileCount} files
            </span>
          </div>

          <div className="space-y-1">
            {sortedResponses.map(response => {
              const expanded = expandedUsers.has(response.username);
              return (
                <div key={response.username} className="rounded-lg border border-border/70 bg-card/60 overflow-hidden">
                  {/* Peer header */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleUser(response.username)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleUser(response.username); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{response.username}</span>
                    <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
                      {response.hasFreeUploadSlot && (
                        <span className="text-primary flex items-center gap-1"><Zap className="h-3 w-3" /> Free slot</span>
                      )}
                      <span className="font-mono tabular-nums">{fmtSpeed(response.uploadSpeed)}</span>
                      <span className="font-mono tabular-nums">Q:{response.queueLength}</span>
                      <span className="font-mono tabular-nums">{response.fileCount} files</span>
                      <button
                        onClick={e => { e.stopPropagation(); onBrowsePeer(response.username); }}
                        className="p-1 rounded hover:bg-accent/15 text-accent transition-colors"
                        title="Browse this peer's full share"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* File list */}
                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-border/60">
                          <div className="max-h-96 overflow-y-auto">
                            {(() => {
                              // Group files by parent folder
                              const folders = new Map<string, SearchFile[]>();
                              for (const file of response.files) {
                                const normalized = file.filename.replace(/\\/g, '/');
                                const lastSlash = normalized.lastIndexOf('/');
                                const folder = lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
                                if (!folders.has(folder)) folders.set(folder, []);
                                folders.get(folder)!.push(file);
                              }

                              return Array.from(folders.entries()).map(([folder, files]) => {
                                // Show last 2 path segments as folder name
                                const folderParts = folder.split('/').filter(Boolean);
                                const folderDisplay = folderParts.slice(-2).join(' / ') || 'Root';
                                const libraryMatch = matchFolder(libraryIndex, folder, files);

                                return (
                                  <div key={folder} className="border-b border-border/40 last:border-b-0">
                                    {/* Folder header */}
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40">
                                      <Folder className="h-3 w-3 text-accent shrink-0" />
                                      <span className="text-xs font-medium text-foreground truncate flex-1" title={folder}>{folderDisplay}</span>
                                      <InLibraryBadge match={libraryMatch} />
                                      <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{files.length} files</span>
                                      {(() => {
                                        const key = `${response.username}:${folder}`;
                                        const active = downloadingKeys.has(key);
                                        return (
                                          <button
                                            onClick={() => handleDownload(response.username, files, key)}
                                            disabled={active}
                                            className={`text-xs px-2 py-0.5 rounded-sm flex items-center gap-1 transition-colors ${
                                              active ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary hover:bg-primary/20'
                                            }`}
                                          >
                                            {active ? <Loader className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />}
                                            {active ? 'Patched' : 'All'}
                                          </button>
                                        );
                                      })()}
                                    </div>
                                    {/* Files in folder */}
                                    {files.map((file, i) => {
                                      const fileKey = `${response.username}:${file.filename}`;
                                      const fileActive = downloadingKeys.has(fileKey);
                                      return (
                                      <div
                                        key={i}
                                        className="flex items-center gap-2 px-3 pl-8 py-1 hover:bg-muted/30 transition-colors text-xs group"
                                      >
                                        <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="text-foreground truncate flex-1 min-w-0 font-mono" title={file.filename}>
                                          {basename(file.filename)}
                                        </span>
                                        <QualityTag file={file} />
                                        {file.length ? <span className="text-muted-foreground font-mono tabular-nums w-10 text-right">{fmtDuration(file.length)}</span> : null}
                                        <span className="text-muted-foreground font-mono tabular-nums w-14 text-right">{fmtBytes(file.size)}</span>
                                        <button
                                          onClick={() => handleDownload(response.username, [file], fileKey)}
                                          disabled={fileActive}
                                          className={`p-1 rounded transition-all ${
                                            fileActive ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-primary hover:bg-primary/20'
                                          }`}
                                        >
                                          {fileActive ? <CheckCircle className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                                        </button>
                                      </div>
                                      );
                                    })}
                                  </div>
                                );
                              });
                            })()}
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
          <p className="text-sm">Nobody answered</p>
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

// ── Peer browse (inside Search tab) ──

function PeerBrowse({ seed, libraryIndex }: { seed: { name: string; key: number } | null; libraryIndex: LibraryIndex }) {
  const [username, setUsername] = useState('');
  const [dirs, setDirs] = useState<BrowseDir[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [browsedUser, setBrowsedUser] = useState('');

  const runBrowse = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setDirs([]);
    setExpandedDirs(new Set());
    setBrowsedUser(name.trim());
    try {
      const res = await fetch(`/api/soulseek/browse?username=${encodeURIComponent(name.trim())}`);
      if (!res.ok) throw new Error('Failed to browse user');
      const data = await res.json();
      setDirs(data.directories || []);
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  }, []);

  // A seed arrives when a peer's "browse" jack is clicked in search results.
  useEffect(() => {
    if (!seed) return;
    setUsername(seed.name);
    runBrowse(seed.name);
  }, [seed, runBrowse]);

  // A full share can be hundreds of dirs — match once per browse, not per render.
  const dirMatches = useMemo(
    () => new Map(dirs.map(d => [d.name, matchFolder(libraryIndex, d.name, d.files)])),
    [dirs, libraryIndex]
  );

  const toggleDir = (name: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDownloadFiles = async (files: SearchFile[]) => {
    try {
      await fetch('/api/soulseek/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: browsedUser, files: files.map(f => ({ filename: f.filename, size: f.size })) }),
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
            onKeyDown={e => e.key === 'Enter' && runBrowse(username)}
            placeholder="Patch into a peer by username…"
            className="w-full pl-10 pr-4 py-2.5 rounded-md bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
          />
        </div>
        <button
          onClick={() => runBrowse(username)}
          disabled={loading || !username.trim()}
          className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? <Loader className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          Browse
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/25 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 px-4 py-6 justify-center text-muted-foreground">
          <span className="slsk-lamp text-accent slsk-lamp-live" />
          <span className="text-sm">Pulling the file list from {username}…</span>
        </div>
      )}

      {dirs.length > 0 && (
        <div className="space-y-0.5">
          {dirs.map(dir => {
            const expanded = expandedDirs.has(dir.name);
            const dirName = dir.name.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/');
            return (
              <div key={dir.name} className="rounded-lg border border-border/70 bg-card/60 overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleDir(dir.name)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleDir(dir.name); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors text-xs cursor-pointer"
                >
                  {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  <Folder className="h-3.5 w-3.5 text-accent" />
                  <span className="text-foreground font-mono truncate flex-1 text-left">{dirName}</span>
                  <InLibraryBadge match={dirMatches.get(dir.name) ?? null} />
                  <span className="text-muted-foreground font-mono tabular-nums">{dir.fileCount} files</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownloadFiles(dir.files); }}
                    className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                    title="Download directory"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                </div>
                <AnimatePresence>
                  {expanded && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="border-t border-border/60 max-h-60 overflow-y-auto">
                        {dir.files.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors text-xs group pl-8">
                            <File className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-mono text-foreground truncate flex-1">{basename(file.filename)}</span>
                            <QualityTag file={file} />
                            {file.length ? <span className="text-muted-foreground font-mono tabular-nums">{fmtDuration(file.length)}</span> : null}
                            <span className="text-muted-foreground font-mono tabular-nums">{fmtBytes(file.size)}</span>
                            <button
                              onClick={() => handleDownloadFiles([file])}
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
          <p className="text-sm">Browse a peer&apos;s shared files</p>
          <p className="text-xs mt-1 opacity-60">Enter their username, or hit the folder icon on any search result</p>
        </div>
      )}
    </div>
  );
}

// ── Transfers tab (down wire + up wire) ──

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function Pagination({ page, totalPages, pageSize, onPageChange, onPageSizeChange }: {
  page: number; totalPages: number; pageSize: number;
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
  if (totalPages <= 1 && pageSize === PAGE_SIZE_OPTIONS[0]) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Per page:</span>
        {PAGE_SIZE_OPTIONS.map(s => (
          <button key={s} onClick={() => onPageSizeChange(s)}
            className={`text-[11px] px-1.5 py-0.5 rounded-sm transition-colors ${pageSize === s ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >{s}</button>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPageChange(page - 1)} disabled={page === 0}
            className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >Prev</button>
          <span className="text-[11px] text-muted-foreground tabular-nums">{page + 1} / {totalPages}</span>
          <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1}
            className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >Next</button>
        </div>
      )}
    </div>
  );
}

function SectionHead({ tone, children }: { tone: 'down' | 'up' | 'hold' | 'plain'; children: React.ReactNode }) {
  const color = tone === 'down' ? 'text-primary' : tone === 'up' ? 'text-accent' : tone === 'hold' ? 'text-accent' : 'text-muted-foreground';
  return <div className={`flex items-center gap-2 ${EYEBROW} ${color}`}>{children}</div>;
}

function TransfersTab({ liveDownloads, liveUploads, staging, refetchStaging, onCancel }: {
  liveDownloads: Record<string, Transfer[]>;
  liveUploads: Record<string, Transfer[]>;
  staging: StagingItem[];
  refetchStaging: () => void;
  onCancel: (direction: 'down' | 'up', transfer: Transfer) => Promise<void>;
}) {
  const [completed, setCompleted] = useState<DownloadRecord[]>([]);
  const [uploadHistory, setUploadHistory] = useState<DownloadRecord[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editArtist, setEditArtist] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const [cancellingKeys, setCancellingKeys] = useState<Set<string>>(new Set());
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Pagination state
  const [activePage, setActivePage] = useState(0);
  const [activePageSize, setActivePageSize] = useState(10);
  const [completedPage, setCompletedPage] = useState(0);
  const [completedPageSize, setCompletedPageSize] = useState(10);
  const [sentPage, setSentPage] = useState(0);
  const [sentPageSize, setSentPageSize] = useState(10);

  const fetchHistories = useCallback(async () => {
    try {
      const [comp, ul] = await Promise.all([
        fetch('/api/soulseek/downloads?status=completed&limit=100').then(r => r.json()),
        fetch('/api/soulseek/uploads?limit=50').then(r => r.json()),
      ]);
      setCompleted(comp.downloads || []);
      setUploadHistory(ul.uploads || []);
    } catch {}
  }, []);

  useEffect(() => { fetchHistories(); }, [fetchHistories]);
  useEffect(() => { const i = setInterval(fetchHistories, 15000); return () => clearInterval(i); }, [fetchHistories]);

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
      refetchStaging();
      fetchHistories();
    } catch {}
  };

  const handleReject = async (item: StagingItem) => {
    try {
      await fetch('/api/soulseek/ingest', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      refetchStaging();
    } catch {}
  };

  const handleCancel = async (direction: 'down' | 'up', transfer: Transfer) => {
    const key = `${direction}:${transfer.username}:${transfer.id}`;
    setCancelError(null);
    setCancellingKeys(prev => new Set(prev).add(key));
    try {
      await onCancel(direction, transfer);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Could not cancel transfer');
    } finally {
      setCancellingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const activeDownloads = Object.entries(liveDownloads).flatMap(([username, transfers]) =>
    transfers.filter(isActive).map(t => ({ ...t, username }))
  );
  const activeUploads = Object.entries(liveUploads).flatMap(([username, transfers]) =>
    transfers.filter(isActive).map(t => ({ ...t, username }))
  );

  return (
    <div className="space-y-8">
      {cancelError && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/25 text-sm text-destructive">
          {cancelError}
        </div>
      )}
      {/* ══ DOWN WIRE ══ */}
      <div className="space-y-5">
        {/* Active downloads */}
        <div className="space-y-2">
          <SectionHead tone="down">
            <ArrowDown className="h-3.5 w-3.5" />
            Down wire
            {activeDownloads.length > 0 && <span className="font-mono tabular-nums text-foreground">({activeDownloads.length})</span>}
          </SectionHead>
          {activeDownloads.length === 0 ? (
            <EmptySlot>The down wire is quiet</EmptySlot>
          ) : (
            <div className="space-y-1">
              <div style={{ minHeight: Math.min(activeDownloads.length, activePageSize) * 52 }}>
                {activeDownloads.slice(activePage * activePageSize, (activePage + 1) * activePageSize).map(t => {
                  const stateInfo = transferStateLabel(t.state);
                  return (
                    <div key={t.id} className="rounded-lg border border-border/70 bg-card/60 px-3 py-2 space-y-1.5 mb-1">
                      <div className="flex items-center gap-2 text-xs">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{t.username}</span>
                        <span className="text-foreground font-mono truncate flex-1">{basename(t.filename)}</span>
                        <span className={stateInfo.color}>{stateInfo.label}</span>
                        <span className="text-muted-foreground font-mono tabular-nums">{fmtSpeed(t.averageSpeed)}</span>
                        <span className="text-muted-foreground font-mono tabular-nums">{fmtBytes(t.bytesTransferred)} / {fmtBytes(t.size)}</span>
                        <button
                          onClick={() => handleCancel('down', t)}
                          disabled={cancellingKeys.has(`down:${t.username}:${t.id}`)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                          title="Cancel download"
                          aria-label={`Cancel download ${basename(t.filename)}`}
                        >
                          {cancellingKeys.has(`down:${t.username}:${t.id}`)
                            ? <Loader className="h-3 w-3 animate-spin" />
                            : <X className="h-3 w-3" />}
                        </button>
                      </div>
                      <ProgressBar percent={t.percentComplete} color="bg-primary" />
                    </div>
                  );
                })}
              </div>
              <Pagination
                page={activePage} totalPages={Math.ceil(activeDownloads.length / activePageSize)}
                pageSize={activePageSize}
                onPageChange={setActivePage}
                onPageSizeChange={s => { setActivePageSize(s); setActivePage(0); }}
              />
            </div>
          )}
        </div>

        {/* Staging (review before ingest) */}
        <div className="space-y-2">
          <SectionHead tone="hold">
            <Edit3 className="h-3.5 w-3.5" />
            Switchboard hold — review before ingest
            {staging.length > 0 && <span className="font-mono tabular-nums">({staging.length})</span>}
          </SectionHead>
          {staging.length === 0 ? (
            <EmptySlot>Nothing waiting on the switchboard</EmptySlot>
          ) : (
            <div className="space-y-1">
              {staging.map(item => {
                const isEditing = editingId === item.id;
                return (
                  <div key={item.id} className="rounded-lg border border-accent/25 bg-accent/5 px-3 py-2.5 space-y-2">
                    <div className="flex items-center gap-3">
                      {/* Cover art */}
                      {item.coverImage ? (
                        <div className="w-10 h-10 rounded-sm bg-cover bg-center shadow shrink-0" style={{ backgroundImage: `url(${item.coverImage})` }} />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-muted/70 flex items-center justify-center shrink-0">
                          <Music className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.cleanedName || item.filename}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>from {item.username}</span>
                          <span className="font-mono tabular-nums">{fmtBytes(item.size_bytes)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <input
                            value={editArtist}
                            onChange={e => setEditArtist(e.target.value)}
                            placeholder="Artist"
                            className="flex-1 px-2 py-1 rounded-sm bg-muted/60 border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                          <input
                            value={editAlbum}
                            onChange={e => setEditAlbum(e.target.value)}
                            placeholder="Album"
                            className="flex-1 px-2 py-1 rounded-sm bg-muted/60 border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit metadata"
                          >
                            <Edit3 className="h-3 w-3" />
                          </button>
                        )}
                        {isEditing && (
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleApprove(item)}
                          className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                          title="Approve & ingest"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleReject(item)}
                          className="p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
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

        {/* Completed downloads */}
        <div className="space-y-2">
          <SectionHead tone="plain">
            <CheckCircle className="h-3.5 w-3.5" />
            Logged
          </SectionHead>
          {completed.length === 0 ? (
            <EmptySlot>No completed downloads yet</EmptySlot>
          ) : (
            <>
              <div className="rounded-lg border border-border/70 bg-card/60 overflow-hidden" style={{ minHeight: Math.min(completed.length, completedPageSize) * 33 }}>
                {completed.slice(completedPage * completedPageSize, (completedPage + 1) * completedPageSize).map((dl, i) => (
                  <div key={dl.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/40' : ''}`}>
                    <CheckCircle className="h-3 w-3 text-primary shrink-0" />
                    <span className="font-mono text-foreground truncate flex-1">{dl.filename}</span>
                    <span className="text-muted-foreground">{dl.artist} — {dl.album}</span>
                    <span className="text-muted-foreground font-mono tabular-nums">{fmtBytes(dl.size_bytes)}</span>
                    {dl.completed_at && <span className="text-muted-foreground font-mono tabular-nums">{fmtTime(dl.completed_at)}</span>}
                    {dl.artist && dl.album && (
                      <Link
                        href={`/projects/barfoo`}
                        className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                        title="Play in Barfoo"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              <Pagination
                page={completedPage} totalPages={Math.ceil(completed.length / completedPageSize)}
                pageSize={completedPageSize}
                onPageChange={setCompletedPage}
                onPageSizeChange={s => { setCompletedPageSize(s); setCompletedPage(0); }}
              />
            </>
          )}
        </div>
      </div>

      {/* ══ UP WIRE ══ */}
      <div className="space-y-5 border-t border-border/60 pt-6">
        {/* Active uploads */}
        <div className="space-y-2">
          <SectionHead tone="up">
            <ArrowUp className="h-3.5 w-3.5" />
            Up wire
            {activeUploads.length > 0 && <span className="font-mono tabular-nums text-foreground">({activeUploads.length})</span>}
          </SectionHead>
          {activeUploads.length === 0 ? (
            <EmptySlot>The up wire is quiet</EmptySlot>
          ) : (
            <div className="space-y-1">
              {activeUploads.map(t => {
                const stateInfo = transferStateLabel(t.state);
                return (
                  <div key={t.id} className="rounded-lg border border-border/70 bg-card/60 px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">{t.username}</span>
                      <span className="text-foreground font-mono truncate flex-1">{basename(t.filename)}</span>
                      <span className={stateInfo.color}>{stateInfo.label}</span>
                      <span className="text-muted-foreground font-mono tabular-nums">{fmtSpeed(t.averageSpeed)}</span>
                      <button
                        onClick={() => handleCancel('up', t)}
                        disabled={cancellingKeys.has(`up:${t.username}:${t.id}`)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                        title="Cancel upload"
                        aria-label={`Cancel upload ${basename(t.filename)}`}
                      >
                        {cancellingKeys.has(`up:${t.username}:${t.id}`)
                          ? <Loader className="h-3 w-3 animate-spin" />
                          : <X className="h-3 w-3" />}
                      </button>
                    </div>
                    <ProgressBar percent={t.percentComplete} color="bg-accent" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload history */}
        <div className="space-y-2">
          <SectionHead tone="plain">
            <Clock className="h-3.5 w-3.5" />
            Sent out
          </SectionHead>
          {uploadHistory.length === 0 ? (
            <EmptySlot>Nothing sent out yet</EmptySlot>
          ) : (
            <>
              <div className="rounded-lg border border-border/70 bg-card/60 overflow-hidden" style={{ minHeight: Math.min(uploadHistory.length, sentPageSize) * 33 }}>
                {uploadHistory.slice(sentPage * sentPageSize, (sentPage + 1) * sentPageSize).map((ul, i) => (
                  <div key={ul.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/40' : ''}`}>
                    <ArrowUp className="h-3 w-3 text-accent shrink-0" />
                    <User className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-foreground">{ul.username}</span>
                    <span className="font-mono text-muted-foreground truncate flex-1">{ul.filename}</span>
                    <span className="text-muted-foreground font-mono tabular-nums">{fmtBytes(ul.size_bytes)}</span>
                    {ul.speed_bytes_per_sec > 0 && <span className="text-muted-foreground font-mono tabular-nums">{fmtSpeed(ul.speed_bytes_per_sec)}</span>}
                    <span className="text-muted-foreground font-mono tabular-nums">{fmtTime(ul.created_at)}</span>
                  </div>
                ))}
              </div>
              <Pagination
                page={sentPage} totalPages={Math.ceil(uploadHistory.length / sentPageSize)}
                pageSize={sentPageSize}
                onPageChange={setSentPage}
                onPageSizeChange={s => { setSentPageSize(s); setSentPage(0); }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──

export default function SoulseekPage() {
  // Recolor + refont the global site header to match the wire room.
  useHeaderConfig({ scopeClass: 'slsk-theme' });

  const [activeTab, setActiveTab] = useState<TabId>('search');
  const [connected, setConnected] = useState<boolean | null>(null);
  const { albums } = useAudio();

  // Single SSE connection for live transfers, open for the whole visit so the
  // wire meter reads live from any tab (the server polls slskd every 2s).
  // Auto-reconnect is EventSource's default.
  const [liveDownloads, setLiveDownloads] = useState<Record<string, Transfer[]>>({});
  const [liveUploads, setLiveUploads] = useState<Record<string, Transfer[]>>({});
  const recentlyCancelledRef = useRef(new Set<string>());
  useEffect(() => {
    const es = new EventSource('/api/soulseek/transfers/stream');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const withoutCancelled = (
          direction: 'down' | 'up',
          groups: Record<string, Transfer[]>,
        ) => Object.fromEntries(
          Object.entries(groups)
            .map(([username, transfers]) => [
              username,
              transfers.filter((transfer) =>
                !recentlyCancelledRef.current.has(`${direction}:${username}:${transfer.id}`)
              ),
            ])
            .filter(([, transfers]) => (transfers as Transfer[]).length > 0),
        ) as Record<string, Transfer[]>;
        if (data.downloads) setLiveDownloads(withoutCancelled('down', data.downloads));
        if (data.uploads) setLiveUploads(withoutCancelled('up', data.uploads));
      } catch {}
    };
    return () => { es.close(); };
  }, []);

  const cancelTransfer = useCallback(async (direction: 'down' | 'up', transfer: Transfer) => {
    const response = await adminFetch('/api/soulseek/transfers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, username: transfer.username, id: transfer.id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not cancel transfer');

    const cancelledKey = `${direction}:${transfer.username}:${transfer.id}`;
    recentlyCancelledRef.current.add(cancelledKey);
    window.setTimeout(() => recentlyCancelledRef.current.delete(cancelledKey), 10_000);
    const removeTransfer = (current: Record<string, Transfer[]>) => {
      const next = { ...current };
      const remaining = (next[transfer.username] || []).filter(item => item.id !== transfer.id);
      if (remaining.length > 0) next[transfer.username] = remaining;
      else delete next[transfer.username];
      return next;
    };
    if (direction === 'down') setLiveDownloads(removeTransfer);
    else setLiveUploads(removeTransfer);
  }, []);

  // Staging lives at page level: the Transfers tab lists it and its count
  // badges the tab from anywhere in the room.
  const [staging, setStaging] = useState<StagingItem[]>([]);
  const fetchStaging = useCallback(async () => {
    try {
      const d = await fetch('/api/soulseek/ingest').then(r => r.json());
      setStaging(d.staging || []);
    } catch {}
  }, []);
  useEffect(() => {
    fetchStaging();
    const i = setInterval(fetchStaging, 15000);
    return () => clearInterval(i);
  }, [fetchStaging]);

  // Album-level index for "In Library" matching (song titles + album names)
  const libraryIndex = useMemo(() => buildLibraryIndex(albums), [albums]);

  // Handle ?search= query param from Barfoo links
  const [initialSearch, setInitialSearch] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('search');
    if (q) {
      setInitialSearch(q);
      setActiveTab('search');
      // Clean the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetch('/api/soulseek/status')
      .then(r => r.json())
      .then(d => setConnected(d.connected ?? false))
      .catch(() => setConnected(false));
  }, []);

  return (
    <PageTransition>
      <div className="slsk-theme" style={{ minHeight: 'calc(100vh - 57px)' }}>
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
          {/* Masthead */}
          <FadeIn>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className={`${EYEBROW} text-primary`}>RM 10 · The Wire Room</p>
                <h1 className="ws-serif text-3xl font-semibold tracking-tight text-foreground mt-1">Soulseek Wire</h1>
                <p className="text-[11px] text-muted-foreground mt-1">Peer-to-peer music exchange, patched through slskd</p>
              </div>
              <LineLamp connected={connected} />
            </div>
          </FadeIn>

          {/* Wire meter */}
          <FadeIn delay={0.05}>
            <div className="mb-6">
              <WireMeter liveDownloads={liveDownloads} liveUploads={liveUploads} />
            </div>
          </FadeIn>

          {/* Patch-bay tabs */}
          <FadeIn delay={0.1}>
            <div className="flex items-center gap-1.5 mb-6">
              {TABS.map(tab => {
                const active = activeTab === tab.id;
                const holdCount = tab.id === 'transfers' ? staging.length : 0;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-md border text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                      active
                        ? 'border-border bg-card text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className={`slsk-lamp ${active ? 'text-primary' : 'slsk-lamp-off'}`} />
                    {tab.label}
                    {holdCount > 0 && <span className="font-mono tabular-nums text-accent">{holdCount}</span>}
                  </button>
                );
              })}
            </div>
          </FadeIn>

          {/* Tab content */}
          <FadeIn delay={0.15}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'search' && <SearchTab libraryIndex={libraryIndex} initialSearch={initialSearch} />}
                {activeTab === 'transfers' && (
                  <TransfersTab
                    liveDownloads={liveDownloads}
                    liveUploads={liveUploads}
                    staging={staging}
                    refetchStaging={fetchStaging}
                    onCancel={cancelTransfer}
                  />
                )}
                {activeTab === 'ledger' && <LedgerTab />}
              </motion.div>
            </AnimatePresence>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
