'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, BarChart3, Music, Shuffle, ListMusic, X, Plus, Trash2, ListPlus, Disc3, ChevronLeft, Flame, Calendar, Trophy, Disc, Search, Clock, Share2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { motion, AnimatePresence } from 'motion/react';
import { useAudio, type Album } from '@/components/AudioProvider';
import { cleanSongDisplay, extractTrackNumber, sortedTrackIndices } from '@/lib/songUtils';

interface Playlist {
  id: number;
  name: string;
  song_count: number;
}

interface PlaylistDetail {
  id: number;
  name: string;
  songs: { artist: string; album: string; song: string; position: number }[];
}

interface Stats {
  topSongs: { artist: string; album: string; song: string; play_count: number }[];
  topAlbums: { artist: string; album: string; play_count: number; thumbnail?: string }[];
  topArtists: { artist: string; play_count: number }[];
  topListeners: { username: string; play_count: number }[];
  recentPlays: { artist: string; album: string; song: string; username: string; played_at: string }[];
  summary: { total_plays: number; unique_artists: number; unique_albums: number; unique_songs: number; active_listeners: number };
  dailyPlays: { date: string; count: number }[];
  hourlyHeatmap: { dow: number; hour: number; count: number }[];
  streaks: { current: number; longest: number };
  mostActiveDay: { date: string; count: number } | null;
  firstPlay: string | null;
}

// ── Stats Charts & View ──

function PlayActivityChart({ data, className }: { data: { date: string; count: number }[]; className?: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [range, setRange] = useState<'30' | '90' | 'all'>('30');

  const filtered = useMemo(() => {
    if (range === 'all') return data;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (range === '30' ? 30 : 90));
    return data.filter(d => new Date(d.date) >= cutoff);
  }, [data, range]);

  if (filtered.length === 0) return <div className="text-sm text-muted-foreground text-center py-8">No play data yet</div>;

  const maxCount = Math.max(...filtered.map(d => d.count), 1);
  const W = 600, H = 160, PX = 40, PY = 32, PB = 20;
  const plotW = W - PX - 10, plotH = H - PY - PB;

  const xScale = (i: number) => PX + (i / Math.max(filtered.length - 1, 1)) * plotW;
  const yScale = (v: number) => PY + plotH - (v / maxCount) * plotH;

  const linePath = filtered.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d.count).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xScale(filtered.length - 1).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} Z`;

  const tickCount = Math.min(5, filtered.length);
  const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(i * (filtered.length - 1) / (tickCount - 1)));

  return (
    <div className={`rounded-xl border border-border/60 bg-card/40 p-5 ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Listening Activity</h3>
        <div className="flex gap-1">
          {(['30', '90', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-xs rounded-md transition-colors ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40'}`}
            >{r === 'all' ? 'All' : `${r}D`}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width * W;
          if (x < PX || x > PX + plotW) { setHoverIdx(null); return; }
          const idx = Math.round(((x - PX) / plotW) * (filtered.length - 1));
          setHoverIdx(Math.max(0, Math.min(filtered.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={PX} x2={W - 10} y1={yScale(f * maxCount)} y2={yScale(f * maxCount)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={PX - 4} y={yScale(f * maxCount) + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.4} fontFamily="monospace">
              {Math.round(f * maxCount)}
            </text>
          </g>
        ))}
        {/* Time labels */}
        {ticks.map(i => (
          <text key={i} x={xScale(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.4} fontFamily="monospace">
            {new Date(filtered[i].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        ))}
        {/* Area + line */}
        <path d={areaPath} fill="currentColor" fillOpacity={0.08} />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.6} />
        {/* Hover */}
        {hoverIdx !== null && filtered[hoverIdx] && (() => {
          const cx = xScale(hoverIdx);
          const cy = yScale(filtered[hoverIdx].count);
          const tooltipY = cy < PY + 30 ? cy + 8 : cy - 28;
          const textY = cy < PY + 30 ? cy + 22 : cy - 14;
          return (
            <g>
              <line x1={cx} x2={cx} y1={PY} y2={yScale(0)} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="3,3" />
              <circle cx={cx} cy={cy} r={3} fill="currentColor" />
              <rect x={cx - 40} y={tooltipY} width={80} height={22} rx={4} fill="currentColor" fillOpacity={0.1} />
              <text x={cx} y={textY} textAnchor="middle" fontSize={10} fill="currentColor" fontFamily="monospace">
                {filtered[hoverIdx].count} plays
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function ListeningHeatmap({ data }: { data: { dow: number; hour: number; count: number }[] }) {
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    data.forEach(d => { g[d.dow][d.hour] = d.count; });
    return g;
  }, [data]);

  const maxCount = Math.max(...data.map(d => d.count), 1);
  // Remap DOW: postgres DOW is 0=Sun, we want Mon-Sun order
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon=1, Tue=2, ..., Sun=0
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">When You Listen</h3>
      <div className="overflow-x-auto">
        <div className="min-w-[400px]">
          {/* Hour labels */}
          <div className="flex ml-9 mb-1">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground tabular-nums">
                {h % 3 === 0 ? `${h}` : ''}
              </div>
            ))}
          </div>
          {/* Grid rows */}
          {dayOrder.map((dow, rowIdx) => (
            <div key={dow} className="flex items-center gap-1 mb-0.5">
              <span className="text-[10px] text-muted-foreground w-8 text-right">{dayLabels[rowIdx]}</span>
              <div className="flex flex-1 gap-px">
                {Array.from({ length: 24 }, (_, h) => {
                  const count = grid[dow][h];
                  const intensity = count / maxCount;
                  return (
                    <div
                      key={h}
                      className={`flex-1 aspect-square rounded-[2px] transition-colors ${count === 0 ? 'bg-muted/20' : ''}`}
                      style={count > 0 ? { backgroundColor: `color-mix(in srgb, var(--color-primary) ${Math.round(15 + intensity * 85)}%, transparent)` } : undefined}
                      title={`${dayLabels[rowIdx]} ${h}:00 — ${count} play${count !== 1 ? 's' : ''}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsView({ stats }: { stats: Stats }) {
  const summaryCards = [
    { label: 'Total Plays', value: stats.summary.total_plays, icon: Play },
    { label: 'Artists', value: stats.summary.unique_artists, icon: Music },
    { label: 'Albums', value: stats.summary.unique_albums, icon: Disc },
    { label: 'Songs', value: stats.summary.unique_songs, icon: Disc3 },
    { label: 'Listeners', value: stats.summary.active_listeners, icon: BarChart3 },
  ];

  const maxArtistPlays = stats.topArtists.length > 0 ? stats.topArtists[0].play_count : 1;
  const maxSongPlays = stats.topSongs.length > 0 ? stats.topSongs[0].play_count : 1;
  const maxAlbumPlays = stats.topAlbums.length > 0 ? stats.topAlbums[0].play_count : 1;
  const maxListenerPlays = stats.topListeners.length > 0 ? stats.topListeners[0].play_count : 1;

  return (
    <div className="space-y-4">
      {/* Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {summaryCards.map(c => (
          <div key={c.label} className="rounded-xl border border-border/60 bg-card/40 p-4 flex flex-col items-center gap-1">
            <c.icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold tabular-nums">{c.value.toLocaleString()}</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</span>
          </div>
        ))}
      </div>

      {/* Activity Chart */}
      <PlayActivityChart data={stats.dailyPlays} />

      {/* Heatmap + Streaks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ListeningHeatmap data={stats.hourlyHeatmap} />

        {/* Streak & Fun Stats */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-5 flex flex-col gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Highlights</h3>
          <div className="grid grid-cols-2 gap-3 flex-1">
            <div className="rounded-lg bg-muted/20 p-3 flex flex-col items-center justify-center text-center">
              <Flame className="h-4 w-4 text-orange-400 mb-1" />
              <span className="text-xl font-bold tabular-nums">{stats.streaks.current}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Day Streak</span>
            </div>
            <div className="rounded-lg bg-muted/20 p-3 flex flex-col items-center justify-center text-center">
              <Trophy className="h-4 w-4 text-yellow-400 mb-1" />
              <span className="text-xl font-bold tabular-nums">{stats.streaks.longest}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Best Streak</span>
            </div>
            <div className="rounded-lg bg-muted/20 p-3 flex flex-col items-center justify-center text-center">
              <BarChart3 className="h-4 w-4 text-blue-400 mb-1" />
              <span className="text-xl font-bold tabular-nums">{stats.mostActiveDay?.count ?? 0}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {stats.mostActiveDay ? new Date(stats.mostActiveDay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'N/A'}
              </span>
            </div>
            <div className="rounded-lg bg-muted/20 p-3 flex flex-col items-center justify-center text-center">
              <Calendar className="h-4 w-4 text-green-400 mb-1" />
              <span className="text-xs font-semibold">
                {stats.firstPlay ? new Date(stats.firstPlay).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">First Play</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Artists + Top Songs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Artists - Horizontal Bar Chart */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Artists</h3>
          <div className="space-y-1.5">
            {stats.topArtists.map((a, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 left-0 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors"
                    style={{ width: `${(a.play_count / maxArtistPlays) * 100}%` }} />
                  <div className="relative flex items-center justify-between px-2 py-1.5">
                    <span className="text-sm truncate">{a.artist}</span>
                    <span className="text-xs font-mono text-muted-foreground tabular-nums ml-2">{a.play_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Songs */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Songs</h3>
          <div className="space-y-1">
            {stats.topSongs.map((s, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex-1 relative min-w-0">
                  <div className="absolute inset-y-0 left-0 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors"
                    style={{ width: `${(s.play_count / maxSongPlays) * 100}%` }} />
                  <div className="relative flex items-center gap-2 px-2 py-1.5">
                    <span className="text-sm truncate flex-1">{cleanSongDisplay(s.song, s.artist, s.album)}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-28">{s.artist}</span>
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">{s.play_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Albums + Top Listeners */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Albums with thumbnails */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Albums</h3>
          <div className="space-y-1">
            {stats.topAlbums.map((a, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                {a.thumbnail && (
                  <img src={a.thumbnail} alt="" className="h-7 w-7 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 relative min-w-0">
                  <div className="absolute inset-y-0 left-0 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors"
                    style={{ width: `${(a.play_count / maxAlbumPlays) * 100}%` }} />
                  <div className="relative flex items-center gap-2 px-2 py-1.5">
                    <span className="text-sm truncate flex-1">{a.album}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-28">{a.artist}</span>
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">{a.play_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Listeners */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Listeners</h3>
          <div className="space-y-1">
            {stats.topListeners.map((l, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex-1 relative">
                  <div className="absolute inset-y-0 left-0 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors"
                    style={{ width: `${(l.play_count / maxListenerPlays) * 100}%` }} />
                  <div className="relative flex items-center justify-between px-2 py-1.5">
                    <span className="text-sm">{l.username}</span>
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">{l.play_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Plays - Full width */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Recent Plays</h3>
        <div className="space-y-1">
          {stats.recentPlays.map((p, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
              <span className="text-sm truncate flex-1">{cleanSongDisplay(p.song, p.artist, p.album)}</span>
              <span className="text-xs text-muted-foreground truncate max-w-28">{p.artist}</span>
              <span className="text-xs text-muted-foreground">{p.username}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {new Date(p.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BarFooPage() {
  // ── Audio context (global, persists across pages) ──
  const {
    albums, albumsLoading: loading,
    currentTrack, isPlaying, progress, duration, volume, muted,
    queue, queueIndex, shuffleMode,
    username, setUsername,
    playTrack: ctxPlayTrack, playSong, playAlbum, playPlaylist: ctxPlayPlaylist,
    playFromQueue, playNext, playPrev, togglePlayPause, shuffleAll: ctxShuffleAll,
    seek, setVolumeValue, changeVolume, handleVolumeWheel, toggleMute,
    setQueue, setQueueIndex, setShuffleMode,
    formatTime, currentAlbum, currentSongName,
  } = useAudio();

  // ── Local UI state ──
  const [selectedAlbum, setSelectedAlbum] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [pendingSong, setPendingSong] = useState<{ artist: string; album: string; song: string } | null>(null);
  const [activeArtist, setActiveArtist] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const albumGridRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('barfoo_recent_searches') || '[]'); } catch { return []; }
  });
  const addRecentSearch = useCallback((q: string) => {
    setRecentSearches(prev => {
      const next = [q, ...prev.filter(s => s !== q)].slice(0, 8);
      localStorage.setItem('barfoo_recent_searches', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Fuzzy search index ──
  const searchIndex = useMemo(() => {
    if (!albums.length) return [];
    const entries: { type: 'artist' | 'album' | 'song'; label: string; sub: string; albumIndex: number; songIndex?: number; tokens: string[] }[] = [];
    const seenArtists = new Set<string>();
    albums.forEach((album, ai) => {
      // Artist entries (deduplicated)
      if (!seenArtists.has(album.artist.toLowerCase())) {
        seenArtists.add(album.artist.toLowerCase());
        entries.push({ type: 'artist', label: album.artist, sub: `${albums.filter(a => a.artist === album.artist).length} albums`, albumIndex: ai, tokens: album.artist.toLowerCase().split(/\s+/) });
      }
      // Album entries
      entries.push({ type: 'album', label: album.name, sub: album.artist, albumIndex: ai, tokens: [...album.name.toLowerCase().split(/\s+/), ...album.artist.toLowerCase().split(/\s+/)] });
      // Song entries
      album.songs.forEach((song, si) => {
        const clean = cleanSongDisplay(song, album.artist, album.name);
        entries.push({ type: 'song', label: clean, sub: `${album.artist} — ${album.name}`, albumIndex: ai, songIndex: si, tokens: [...clean.toLowerCase().split(/\s+/), ...album.artist.toLowerCase().split(/\s+/)] });
      });
    });
    return entries;
  }, [albums]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const qTokens = q.split(/\s+/);

    // Simple fuzzy: for each query token, check if any entry token starts with it or has edit distance <= 1 for short tokens
    function fuzzyMatch(entryTokens: string[], queryTokens: string[]): number {
      let score = 0;
      for (const qt of queryTokens) {
        let best = 0;
        for (const et of entryTokens) {
          if (et === qt) { best = Math.max(best, 3); }
          else if (et.startsWith(qt)) { best = Math.max(best, 2); }
          else if (qt.length >= 3 && et.includes(qt)) { best = Math.max(best, 1); }
          else if (qt.length >= 3 && editDist1(et, qt)) { best = Math.max(best, 1); }
        }
        if (best === 0) return 0; // All query tokens must match something
        score += best;
      }
      return score;
    }

    // Check if two strings are within edit distance 1
    function editDist1(a: string, b: string): boolean {
      if (Math.abs(a.length - b.length) > 1) return false;
      let diffs = 0;
      if (a.length === b.length) {
        for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diffs++; if (diffs > 1) return false; }
        return diffs === 1;
      }
      const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
      let si = 0;
      for (let li = 0; li < longer.length; li++) {
        if (shorter[si] === longer[li]) si++;
        else { diffs++; if (diffs > 1) return false; }
      }
      return true;
    }

    const scored = searchIndex
      .map(entry => ({ ...entry, score: fuzzyMatch(entry.tokens, qTokens) }))
      .filter(e => e.score > 0)
      .sort((a, b) => {
        // Prioritize: exact match > type (artist > album > song) > score
        if (b.score !== a.score) return b.score - a.score;
        const typeOrder = { artist: 0, album: 1, song: 2 };
        return typeOrder[a.type] - typeOrder[b.type];
      });

    return scored.slice(0, 12);
  }, [searchQuery, searchIndex]);

  const scrollToAlbum = useCallback((index: number) => {
    const container = albumGridRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-album-index="${index}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Sync selectedAlbum when track changes
  useEffect(() => {
    if (currentTrack) setSelectedAlbum(currentTrack.albumIndex);
  }, [currentTrack]);

  const playPlaylistLocal = (songs: PlaylistDetail['songs'], shuffle = false) => {
    setSidebarOpen(true);
    ctxPlayPlaylist(songs, shuffle);
  };

  const shuffleAll = () => {
    setSidebarOpen(true);
    ctxShuffleAll();
  };

  // ── Data fetching ──

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/music/stats');
      setStats(await res.json());
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  const fetchPlaylists = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/music/playlists?username=${encodeURIComponent(username)}`);
      setPlaylists(await res.json());
    } catch (e) { console.error('Error fetching playlists:', e); }
  }, [username]);

  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  // ── Playlist actions ──

  const addToPlaylist = async (playlistId: number, artist: string, album: string, song: string) => {
    if (!username) return;
    await fetch(`/api/music/playlists/${playlistId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, artist, album, song }),
    });
    fetchPlaylists();
    if (activePlaylist?.id === playlistId) fetchPlaylistDetail(playlistId);
  };

  const removeFromPlaylist = async (playlistId: number, artist: string, album: string, song: string) => {
    if (!username) return;
    await fetch(`/api/music/playlists/${playlistId}/songs`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, artist, album, song }),
    });
    fetchPlaylists();
    if (activePlaylist?.id === playlistId) fetchPlaylistDetail(playlistId);
  };

  const createPlaylist = async (name: string) => {
    if (!username) return;
    const res = await fetch('/api/music/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name }),
    });
    const pl = await res.json();
    await fetchPlaylists();
    if (pendingSong) {
      await addToPlaylist(pl.id, pendingSong.artist, pendingSong.album, pendingSong.song);
      setPendingSong(null);
    }
  };

  const deletePlaylist = async (id: number) => {
    if (!username) return;
    await fetch(`/api/music/playlists/${id}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
    fetchPlaylists();
    if (activePlaylist?.id === id) setActivePlaylist(null);
  };

  const fetchPlaylistDetail = async (id: number) => {
    if (!username) return;
    const res = await fetch(`/api/music/playlists/${id}?username=${encodeURIComponent(username)}`);
    setActivePlaylist(await res.json());
  };

  const cleanSongName = cleanSongDisplay;
  const displaySongName = cleanSongDisplay;
  const sortedIndices = sortedTrackIndices;
  const sel = selectedAlbum !== null ? albums[selectedAlbum] : null;

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // ── Song Context Menu ──

  const SongContextMenu = ({ artist, album, song, children }: { artist: string; album: string; song: string; children: React.ReactNode }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger><ListPlus className="h-4 w-4 mr-2" />Add to Playlist</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {playlists.map(pl => (
              <ContextMenuItem key={pl.id} onClick={() => addToPlaylist(pl.id, artist, album, song)}>
                {pl.name}
              </ContextMenuItem>
            ))}
            {playlists.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onClick={() => { setPendingSong({ artist, album, song }); setNewPlaylistOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />New Playlist...
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/projects/soulseek?search=${encodeURIComponent(artist)}`}>
            <Share2 className="h-4 w-4 mr-2" />Find Artist on Soulseek
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  // ── Render helpers ──

  const renderSongList = (albumIdx: number) => {
    const alb = albums[albumIdx];
    const songs = alb.songs;
    const hasDiscs = songs.some(s => s.includes('/'));

    const SongRow = ({ song, globalIdx, num }: { song: string; globalIdx: number; num: number }) => {
      const isCurrent = currentTrack?.albumIndex === albumIdx && currentTrack?.songIndex === globalIdx;
      const cleaned = cleanSongName(song, alb.artist, alb.name);
      return (
        <SongContextMenu artist={alb.artist} album={alb.name} song={songs[globalIdx]}>
          <div
            className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
              isCurrent
                ? 'bg-primary/15 text-primary'
                : 'hover:bg-muted/60'
            }`}
            onClick={() => playSong(albumIdx, globalIdx)}
          >
            <span className={`text-xs w-5 text-right tabular-nums ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num}</span>
            <span className="text-sm flex-1 truncate">{cleaned}</span>
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <div className={`items-center gap-0.5 ${isCurrent && isPlaying ? 'flex' : 'hidden'}`}>
                <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_infinite]" style={{ height: 12 }} />
                <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.15s_infinite]" style={{ height: 16 }} />
                <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.3s_infinite]" style={{ height: 8 }} />
              </div>
              <Play className={`h-3.5 w-3.5 text-muted-foreground ${isCurrent && isPlaying ? 'hidden' : 'hidden group-hover:block'}`} />
            </div>
          </div>
        </SongContextMenu>
      );
    };

    if (hasDiscs) {
      const groups: Record<string, { song: string; globalIdx: number }[]> = {};
      songs.forEach((song, idx) => {
        const slashIdx = song.indexOf('/');
        const disc = slashIdx >= 0 ? song.substring(0, slashIdx) : 'Songs';
        const name = slashIdx >= 0 ? song.substring(slashIdx + 1) : song;
        if (!groups[disc]) groups[disc] = [];
        groups[disc].push({ song: name, globalIdx: idx });
      });
      return Object.entries(groups).map(([disc, tracks]) => {
        const sorted = [...tracks].sort((a, b) => extractTrackNumber(a.song) - extractTrackNumber(b.song) || a.song.localeCompare(b.song));
        return (
          <div key={disc} className="mb-4 last:mb-0">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5 px-3">{disc}</h4>
            {sorted.map(({ song, globalIdx }, idx) => (
              <SongRow key={globalIdx} song={song} globalIdx={globalIdx} num={idx + 1} />
            ))}
          </div>
        );
      });
    }

    const sorted = sortedIndices(songs);
    return sorted.map((origIdx, displayIdx) => (
      <SongRow key={origIdx} song={songs[origIdx]} globalIdx={origIdx} num={displayIdx + 1} />
    ));
  };

  // ── Layout ──

  const hasPlayer = currentTrack !== null;

  return (
    <>
      {/* Audio element lives in AudioProvider */}

      {/* Full-viewport app shell — header is already 56px (h-14) */}
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-3">
            <Disc3 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">BarFoo</h1>
            {username && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                listening as <strong className="text-foreground">{username}</strong>
              </span>
            )}
          </div>

          {/* Search bar */}
          {albums.length > 0 && (
            <div className="relative flex-1 max-w-xs mx-4 hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchQuery(''); setSearchFocused(false); searchRef.current?.blur(); }
                  if (e.key === 'Enter' && searchResults.length > 0) {
                    const top = searchResults[0];
                    addRecentSearch(searchQuery.trim());
                    if (top.type === 'song' && top.songIndex !== undefined) {
                      ctxPlayTrack(top.albumIndex, top.songIndex);
                    } else if (top.type === 'artist') {
                      setActiveArtist(top.label);
                    } else {
                      setSelectedAlbum(top.albumIndex);
                    }
                    setSearchQuery(''); setSearchFocused(false); searchRef.current?.blur();
                    setShowStats(false); setShowPlaylists(false);
                  }
                }}
                placeholder="Search..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md bg-muted/40 border border-border/40 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
              />
              {/* Results dropdown */}
              <AnimatePresence>
                {searchFocused && (searchResults.length > 0 || (searchQuery.trim().length < 2 && recentSearches.length > 0)) && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute z-50 top-full mt-1 w-80 rounded-lg bg-card border border-border/60 shadow-2xl overflow-hidden"
                  >
                    {/* Recent searches (when no query) */}
                    {searchQuery.trim().length < 2 && recentSearches.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 border-b border-border/30">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recent</span>
                        </div>
                        {recentSearches.map((q, i) => (
                          <button
                            key={i}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setSearchQuery(q); }}
                            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors"
                          >
                            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-foreground">{q}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Search results */}
                    <div className="max-h-72 overflow-y-auto">
                      {searchResults.map((r, i) => (
                        <button
                          key={`${r.type}-${r.albumIndex}-${r.songIndex ?? ''}-${i}`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            addRecentSearch(searchQuery.trim());
                            if (r.type === 'song' && r.songIndex !== undefined) {
                              ctxPlayTrack(r.albumIndex, r.songIndex);
                            } else if (r.type === 'artist') {
                              setActiveArtist(r.label);
                            } else {
                              setSelectedAlbum(r.albumIndex);
                              setSidebarOpen(true);
                            }
                            setSearchQuery(''); setSearchFocused(false);
                            setShowStats(false); setShowPlaylists(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className={`shrink-0 h-5 w-5 rounded flex items-center justify-center text-[9px] font-bold uppercase ${
                            r.type === 'artist' ? 'bg-primary/15 text-primary' :
                            r.type === 'album' ? 'bg-amber-400/15 text-amber-400' :
                            'bg-emerald-400/15 text-emerald-400'
                          }`}>
                            {r.type === 'artist' ? 'A' : r.type === 'album' ? 'AL' : <Music className="h-3 w-3" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">{r.label}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{r.sub}</p>
                          </div>
                          {r.type === 'song' && (
                            <Play className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Click-away to close search */}
          {searchFocused && <div className="fixed inset-0 z-40" onClick={() => setSearchFocused(false)} />}

          <div className="flex items-center gap-1.5">
            {albums.length > 0 && (
              <Button
                variant={shuffleMode ? 'default' : 'ghost'}
                size="sm"
                onClick={shuffleAll}
                className="h-8 text-xs"
              >
                <Shuffle className="h-3.5 w-3.5 mr-1" />
                Shuffle
              </Button>
            )}
            {username && (
              <Button
                variant={showPlaylists ? 'default' : 'ghost'}
                size="sm"
                onClick={() => { setShowPlaylists(!showPlaylists); setShowStats(false); setActiveArtist(null); }}
                className="h-8 text-xs"
              >
                <ListMusic className="h-3.5 w-3.5 mr-1" />
                Playlists
              </Button>
            )}
            <Button
              variant={showStats ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setShowStats(!showStats); setShowPlaylists(false); setActiveArtist(null); if (!showStats) fetchStats(); }}
              className="h-8 text-xs"
            >
              {showStats ? <Music className="h-3.5 w-3.5 mr-1" /> : <BarChart3 className="h-3.5 w-3.5 mr-1" />}
              {showStats ? 'Library' : 'Stats'}
            </Button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex min-h-0">

          {/* ── Left: Album grid / Stats / Playlists (scrollable) ── */}
          <div ref={albumGridRef} className={`flex-1 min-w-0 overflow-y-auto ${hasPlayer ? 'pb-24' : 'pb-4'}`}>
            <AnimatePresence mode="wait">
              {showStats ? (
                <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-4">
                  {!stats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                      </div>
                      <Skeleton className="h-48 rounded-xl" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
                      </div>
                    </div>
                  ) : (
                    <StatsView stats={stats} />
                  )}
                </motion.div>
              ) : showPlaylists ? (
                <motion.div key="playlists" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-4">
                  {!activePlaylist ? (
                    <>
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">Your Playlists</h2>
                        <Button size="sm" variant="outline" onClick={() => { setPendingSong(null); setNewPlaylistOpen(true); }} className="h-8 text-xs">
                          <Plus className="h-3.5 w-3.5 mr-1" />New
                        </Button>
                      </div>
                      {playlists.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No playlists yet. Right-click a song to add it to a new playlist.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {playlists.map(pl => (
                            <div
                              key={pl.id}
                              className="rounded-xl border border-border/60 bg-card/40 p-4 cursor-pointer hover:bg-muted/30 transition-colors group"
                              onClick={() => fetchPlaylistDetail(pl.id)}
                            >
                              <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-sm truncate">{pl.name}</h3>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{pl.song_count} song{pl.song_count !== 1 ? 's' : ''}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => setActivePlaylist(null)} className="h-8">
                          <ChevronLeft className="h-4 w-4 mr-1" />Back
                        </Button>
                        <h2 className="text-lg font-semibold flex-1 truncate">{activePlaylist.name}</h2>
                        <Button size="sm" onClick={() => playPlaylistLocal(activePlaylist.songs)} className="h-8 text-xs">
                          <Play className="h-3.5 w-3.5 mr-1" />Play
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => playPlaylistLocal(activePlaylist.songs, true)} className="h-8 text-xs">
                          <Shuffle className="h-3.5 w-3.5 mr-1" />Shuffle
                        </Button>
                      </div>
                      {activePlaylist.songs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">This playlist is empty. Right-click songs to add them.</p>
                      ) : (
                        <div className="space-y-0.5">
                          {activePlaylist.songs.map((s, idx) => (
                            <div
                              key={`${s.artist}-${s.album}-${s.song}-${idx}`}
                              className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
                            >
                              <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{idx + 1}</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm truncate">{cleanSongName(s.song, s.artist, s.album)}</p>
                                <p className="text-xs text-muted-foreground truncate">{s.artist} — {s.album}</p>
                              </div>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => removeFromPlaylist(activePlaylist.id, s.artist, s.album, s.song)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              ) : activeArtist ? (
                <motion.div key={`artist-${activeArtist}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-5">
                  {(() => {
                    const artistAlbums = albums
                      .map((a, i) => ({ album: a, index: i }))
                      .filter(({ album }) => album.artist === activeArtist);
                    const totalSongs = artistAlbums.reduce((sum, { album }) => sum + album.songs.length, 0);

                    return (
                      <>
                        {/* Artist header */}
                        <div className="flex items-center gap-4">
                          <button onClick={() => setActiveArtist(null)} className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground">
                            <ChevronLeft className="h-5 w-5" />
                          </button>
                          {/* Composite cover: show first 4 album covers in a grid */}
                          <div className="w-20 h-20 rounded-xl overflow-hidden grid grid-cols-2 grid-rows-2 shadow-lg shrink-0">
                            {artistAlbums.slice(0, 4).map(({ album, index }) => (
                              album.coverImage ? (
                                <div key={index} className="bg-cover bg-center" style={{ backgroundImage: `url(${album.coverImage})` }} />
                              ) : (
                                <div key={index} className="bg-muted flex items-center justify-center">
                                  <Music className="h-3 w-3 text-muted-foreground" />
                                </div>
                              )
                            ))}
                            {artistAlbums.length < 4 && Array.from({ length: 4 - Math.min(artistAlbums.length, 4) }).map((_, i) => (
                              <div key={`empty-${i}`} className="bg-muted" />
                            ))}
                          </div>
                          <div>
                            <h2 className="text-xl font-bold tracking-tight">{activeArtist}</h2>
                            <p className="text-sm text-muted-foreground">{artistAlbums.length} album{artistAlbums.length !== 1 ? 's' : ''} &middot; {totalSongs} tracks</p>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => {
                                const allSongs = artistAlbums.flatMap(({ album, index }) =>
                                  album.songs.map((_, si) => ({ albumIndex: index, songIndex: si }))
                                );
                                const shuffled = allSongs.sort(() => Math.random() - 0.5);
                                if (shuffled.length > 0) {
                                  setQueue(shuffled);
                                  setQueueIndex(0);
                                  setShuffleMode(true);
                                  ctxPlayTrack(shuffled[0].albumIndex, shuffled[0].songIndex);
                                  setSidebarOpen(true);
                                }
                              }}
                            >
                              <Shuffle className="h-3.5 w-3.5 mr-1" /> Shuffle All
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              asChild
                            >
                              <Link href={`/projects/soulseek?search=${encodeURIComponent(activeArtist!)}`}>
                                <Share2 className="h-3.5 w-3.5 mr-1" /> Find on Soulseek
                              </Link>
                            </Button>
                          </div>
                        </div>

                        {/* "Expand library" suggestion */}
                        {artistAlbums.length <= 2 && (
                          <Link
                            href={`/projects/soulseek?search=${encodeURIComponent(activeArtist!)}`}
                            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                          >
                            <Share2 className="h-4 w-4 text-primary shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-foreground">Only {artistAlbums.length} album{artistAlbums.length !== 1 ? 's' : ''} in your library</p>
                              <p className="text-xs text-muted-foreground">Search Soulseek for more by {activeArtist}</p>
                            </div>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
                          </Link>
                        )}

                        {/* Albums grid */}
                        <div className="space-y-3">
                          {artistAlbums.map(({ album, index }) => {
                            const sorted = sortedTrackIndices(album.songs);
                            const isCurrentAlbum = currentTrack?.albumIndex === index;
                            return (
                              <div key={index} className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
                                {/* Album header row */}
                                <div className="flex items-center gap-3 p-3">
                                  <div
                                    className="w-12 h-12 rounded-lg bg-cover bg-center shadow-md shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
                                    style={album.coverImage ? { backgroundImage: `url(${album.coverImage})` } : undefined}
                                    onClick={() => { setSelectedAlbum(index); setSidebarOpen(true); }}
                                  >
                                    {!album.coverImage && (
                                      <div className="w-full h-full rounded-lg bg-muted flex items-center justify-center">
                                        <Music className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <h3
                                      className="text-sm font-bold truncate cursor-pointer hover:text-primary transition-colors"
                                      onClick={() => { setSelectedAlbum(index); setSidebarOpen(true); }}
                                    >
                                      {album.name}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">{album.songs.length} tracks</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs shrink-0"
                                    onClick={() => playAlbum(index)}
                                  >
                                    <Play className="h-3 w-3 mr-1" /> Play
                                  </Button>
                                </div>

                                {/* Track list — grid layout (stable, no reflow on re-render) */}
                                <div className="border-t border-border/30 px-1 py-1 grid grid-cols-2 lg:grid-cols-3">
                                  {sorted.map((si, num) => {
                                    const song = album.songs[si];
                                    const isCurrent = isCurrentAlbum && currentTrack?.songIndex === si;
                                    const cleaned = cleanSongDisplay(song, album.artist, album.name);
                                    return (
                                      <SongContextMenu key={si} artist={album.artist} album={album.name} song={song}>
                                        <div
                                          className={`group flex items-center gap-2 px-2.5 py-1 rounded cursor-pointer ${
                                            isCurrent ? 'bg-primary/15 text-primary' : 'hover:bg-muted/40'
                                          }`}
                                          onClick={() => playSong(index, si)}
                                        >
                                          <span className={`text-xs w-4 text-right tabular-nums shrink-0 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num + 1}</span>
                                          <span className="text-sm flex-1 truncate min-w-0">{cleaned}</span>
                                          <div className="w-4 h-4 flex items-center justify-center shrink-0">
                                            <div className={`items-center gap-0.5 ${isCurrent && isPlaying ? 'flex' : 'hidden'}`}>
                                              <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_infinite]" style={{ height: 12 }} />
                                              <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.15s_infinite]" style={{ height: 16 }} />
                                              <div className="w-0.5 bg-primary rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.3s_infinite]" style={{ height: 8 }} />
                                            </div>
                                            <Play className={`h-3 w-3 text-muted-foreground ${isCurrent && isPlaying ? 'hidden' : 'hidden group-hover:block'}`} />
                                          </div>
                                        </div>
                                      </SongContextMenu>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </motion.div>
              ) : loading ? (
                <div className="p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-xl" />
                  ))}
                </div>
              ) : (
                <motion.div key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {albums.map((album, index) => {
                      const isSelected = selectedAlbum === index;
                      const isPlaying_ = currentTrack?.albumIndex === index;
                      return (
                        <motion.div
                          key={index}
                          data-album-index={index}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer shadow-md group ${
                            isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
                          }`}
                          onClick={() => {
                            if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                            clickTimerRef.current = setTimeout(() => setSelectedAlbum(isSelected ? null : index), 250);
                          }}
                          onDoubleClick={() => {
                            if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                            playAlbum(index);
                          }}
                        >
                          {album.coverImage ? (
                            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${album.coverImage})` }} />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center">
                              <Music className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 p-3">
                            <h2 className="text-sm font-semibold text-white truncate leading-tight">{album.name}</h2>
                            <p className="text-xs text-white/70 truncate">{album.artist}</p>
                          </div>
                          {isPlaying_ && (
                            <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                              <div className="flex items-center gap-px">
                                <div className="w-0.5 h-2 bg-primary-foreground rounded-full animate-[bar-bounce_0.8s_ease-in-out_infinite]" />
                                <div className="w-0.5 h-3 bg-primary-foreground rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.15s_infinite]" />
                                <div className="w-0.5 h-1.5 bg-primary-foreground rounded-full animate-[bar-bounce_0.8s_ease-in-out_0.3s_infinite]" />
                              </div>
                            </div>
                          )}
                          {!isPlaying_ && album.source === 'soulseek' && album.addedAt && (Date.now() - new Date(album.addedAt).getTime() < 7 * 24 * 60 * 60 * 1000) && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-violet-500/80 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wider text-white">
                              New
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right: Song detail panel (when album selected) + Queue ── */}
          <AnimatePresence>
            {((sel && !activeArtist) || sidebarOpen) && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: sel && !activeArtist && sidebarOpen ? 640 : 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="shrink-0 border-l border-border/60 flex overflow-hidden"
              >
                {/* Song detail */}
                {sel && !activeArtist && (
                  <div className="w-80 shrink-0 flex flex-col border-r border-border/40 min-h-0">
                    {/* Album header */}
                    <div className="p-4 shrink-0">
                      <div className="flex items-start gap-3">
                        {sel.coverImage ? (
                          <div className="w-16 h-16 rounded-lg bg-cover bg-center shadow-lg shrink-0" style={{ backgroundImage: `url(${sel.coverImage})` }} />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Music className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 pt-1">
                          <h3 className="text-sm font-bold truncate leading-tight">{sel.name}</h3>
                          <p className="text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground transition-colors" onClick={() => { setActiveArtist(sel.artist); setShowStats(false); setShowPlaylists(false); }}>{sel.artist}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{sel.songs.length} tracks</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSelectedAlbum(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Song list — independently scrollable */}
                    <div className={`flex-1 overflow-y-auto px-1 ${hasPlayer ? 'pb-24' : 'pb-4'}`}>
                      {renderSongList(selectedAlbum!)}
                    </div>
                  </div>
                )}

                {/* Queue */}
                {sidebarOpen && (
                  <div className="w-80 shrink-0 flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-border/40">
                      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {shuffleMode ? 'Shuffle' : 'Queue'}
                      </h2>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{queueIndex + 1}/{queue.length}</span>
                        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-6 w-6">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Queue list — independently scrollable */}
                    <div className={`flex-1 overflow-y-auto ${hasPlayer ? 'pb-24' : 'pb-4'}`}>
                      {queue.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">
                          <p>No queue. Play a song or shuffle to get started.</p>
                        </div>
                      ) : (
                        <div className="p-1.5 space-y-0.5">
                          {(() => {
                            const windowSize = 30;
                            const start = Math.max(0, queueIndex - 3);
                            const end = Math.min(queue.length, start + windowSize);
                            const visible = queue.slice(start, end);
                            return (
                              <>
                                {start > 0 && (
                                  <p className="text-[10px] text-muted-foreground text-center py-1">{start} previous</p>
                                )}
                                {visible.map((item, i) => {
                                  const idx = start + i;
                                  const alb = albums[item.albumIndex];
                                  if (!alb) return null;
                                  const song = alb.songs[item.songIndex];
                                  const isCurrent = idx === queueIndex;
                                  const isPast = idx < queueIndex;
                                  return (
                                    <SongContextMenu key={`${idx}-${item.albumIndex}-${item.songIndex}`} artist={alb.artist} album={alb.name} song={song}>
                                      <div
                                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all ${
                                          isCurrent
                                            ? 'bg-primary/15 text-primary'
                                            : isPast
                                            ? 'opacity-35 hover:opacity-70 hover:bg-muted/40'
                                            : 'hover:bg-muted/40'
                                        }`}
                                        onClick={() => playFromQueue(idx)}
                                      >
                                        <span className="text-[10px] w-5 text-right tabular-nums text-muted-foreground">{idx + 1}</span>
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs truncate font-medium">{displaySongName(song, alb.artist, alb.name)}</p>
                                          <p className={`text-[10px] truncate ${isCurrent ? 'text-primary/60' : 'text-muted-foreground'}`}>
                                            {alb.artist}
                                          </p>
                                        </div>
                                        {isCurrent && isPlaying && (
                                          <div className="flex items-center gap-px shrink-0">
                                            <div className="w-0.5 h-2 bg-primary rounded-full animate-pulse" />
                                            <div className="w-0.5 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                                            <div className="w-0.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                                          </div>
                                        )}
                                      </div>
                                    </SongContextMenu>
                                  );
                                })}
                                {end < queue.length && (
                                  <p className="text-[10px] text-muted-foreground text-center py-1">{queue.length - end} more</p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Now Playing Bar ── */}
        <AnimatePresence>
          {hasPlayer && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-card/80 backdrop-blur-xl"
            >
              {/* Seek bar at top of player */}
              <div className="h-1 w-full cursor-pointer group relative" onClick={seek}>
                <div className="absolute inset-0 bg-muted/60" />
                <motion.div
                  className="absolute inset-y-0 left-0 bg-primary"
                  animate={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }}
                  transition={{ duration: 0.3 }}
                />
                <div className="absolute inset-0 bg-transparent group-hover:bg-primary/10 transition-colors" />
              </div>

              <div className="container mx-auto flex items-center gap-4 px-4 py-2.5">
                {/* Track info */}
                <div className="flex items-center gap-3 w-64 shrink-0">
                  {currentAlbum?.coverImage && currentSongName ? (
                    <SongContextMenu artist={currentAlbum.artist} album={currentAlbum.name} song={currentSongName}>
                      <div
                        className="w-11 h-11 rounded-lg bg-cover bg-center shadow-md cursor-pointer shrink-0 hover:ring-2 hover:ring-primary/40 transition-shadow"
                        style={{ backgroundImage: `url(${currentAlbum.coverImage})` }}
                        onClick={() => {
                          if (currentTrack) {
                            setSelectedAlbum(currentTrack.albumIndex);
                            setSidebarOpen(true);
                            setShowStats(false);
                            setShowPlaylists(false);
                            scrollToAlbum(currentTrack.albumIndex);
                          }
                        }}
                      />
                    </SongContextMenu>
                  ) : (
                    <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Music className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{currentSongName ? displaySongName(currentSongName, currentAlbum?.artist, currentAlbum?.name) : ''}</p>
                    <p className="text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground transition-colors" onClick={() => { if (currentAlbum) { setActiveArtist(currentAlbum.artist); setShowStats(false); setShowPlaylists(false); } }}>{currentAlbum?.artist}</p>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={playPrev} className="h-8 w-8">
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <motion.div whileTap={{ scale: 0.9 }}>
                    <Button size="icon" onClick={togglePlayPause} className="rounded-full h-9 w-9">
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                    </Button>
                  </motion.div>
                  <Button variant="ghost" size="icon" onClick={playNext} className="h-8 w-8">
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">{formatTime(progress)}</span>
                  <div className="flex-1 h-1 bg-muted/60 rounded-full cursor-pointer group" onClick={seek}>
                    <div
                      className="h-full bg-foreground/30 rounded-full relative"
                      style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums w-9">{formatTime(duration)}</span>
                </div>

                {/* Volume — scroll wheel changes volume */}
                <div
                  className="flex items-center gap-2 w-32 shrink-0"
                  onWheel={handleVolumeWheel}
                >
                  <Button variant="ghost" size="icon" onClick={toggleMute} className="h-7 w-7 shrink-0">
                    <VolumeIcon className="h-4 w-4" />
                  </Button>
                  <div className="flex-1 relative group">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={changeVolume}
                      className="w-full h-1 accent-primary cursor-pointer appearance-none bg-muted/60 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:cursor-pointer"
                      aria-label="Volume"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost" size="icon" onClick={shuffleAll}
                    className={`h-8 w-8 ${shuffleMode ? 'text-primary' : ''}`}
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className={`h-8 w-8 ${sidebarOpen ? 'text-primary' : ''}`}
                  >
                    <ListMusic className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Name prompt */}
      {!username && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl border border-border/60 bg-card p-6 w-80 shadow-2xl"
          >
            <div className="flex items-center gap-2 mb-4">
              <Disc3 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">BarFoo</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Enter your name to start listening.</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const name = nameInput.trim();
              if (name) {
                setUsername(name);
              }
            }}>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground mb-3 text-sm"
                autoFocus
              />
              <Button type="submit" className="w-full" disabled={!nameInput.trim()}>
                Start Listening
              </Button>
            </form>
          </motion.div>
        </div>
      )}

      {/* New Playlist Dialog */}
      <Dialog open={newPlaylistOpen} onOpenChange={(open) => { setNewPlaylistOpen(open); if (!open) { setNewPlaylistName(''); setPendingSong(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Playlist</DialogTitle>
          </DialogHeader>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const name = newPlaylistName.trim();
            if (!name) return;
            await createPlaylist(name);
            setNewPlaylistName('');
            setNewPlaylistOpen(false);
          }}>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Playlist name"
              className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-foreground mb-4 text-sm"
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={!newPlaylistName.trim()}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
