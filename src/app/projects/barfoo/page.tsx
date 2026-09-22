'use client';

// BarFoo Records (RM 02) — the listening bar. A dim room walled with
// records: the wall (library grid), the counter (toolbar + search), the
// sleeve you pulled down and the queue (side panel), and the amplifier
// console along the bottom. All playback state lives in AudioProvider
// and survives leaving the room; this file is the room itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Disc, ListMusic, Shuffle } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAudio } from '@/components/AudioProvider';
import { useHeaderConfig } from '@/components/header-config';
import { ArtistView } from './_components/artist';
import { NowPlayingConsole } from './_components/console';
import { AlbumWall } from './_components/wall';
import { SidePanel } from './_components/panel';
import { PlaylistsView } from './_components/playlists';
import { SearchBox } from './_components/search';
import { StatsView } from './_components/stats';
import { VisualizerStage } from './_components/visualizer-stage';
import {
  PlaylistActionsProvider,
  type GeneratedPlaylist,
  type PendingAdd,
  type Playlist,
  type PlaylistDetail,
  type Stats,
} from './_components/shared';
import { buildGenrePlaylists } from '@/lib/musicLibrary';
import { sortedTrackIndices } from '@/lib/songUtils';

type View = 'library' | 'playlists' | 'stats';

const SIZE_MIN = 96, SIZE_MAX = 224, SIZE_DEFAULT = 156;

export default function BarFooPage() {
  useHeaderConfig({ scopeClass: 'bar-theme' });

  const {
    albums, albumsLoading, currentTrack, shuffleMode,
    username, setUsername,
    playPlaylist: ctxPlayPlaylist, shuffleAll: ctxShuffleAll, shuffleAlbums: ctxShuffleAlbums,
    togglePlayPause,
  } = useAudio();

  // ── Local UI state ──
  const [view, setView] = useState<View>('library');
  const [selectedAlbum, setSelectedAlbum] = useState<number | null>(null);
  const [activeArtist, setActiveArtist] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<HTMLDivElement>(null);

  // ── The size fader — how tightly the wall is shelved ──
  const [sizePx, setSizePx] = useState(SIZE_DEFAULT);
  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('barfoo_wall_size') || '', 10);
      if (v >= SIZE_MIN && v <= SIZE_MAX) setSizePx(v);
    } catch { /* fresh visit */ }
  }, []);
  const changeSize = (v: number) => {
    setSizePx(v);
    try { localStorage.setItem('barfoo_wall_size', String(v)); } catch { /* full */ }
  };

  const scrollToAlbum = useCallback((index: number) => {
    const el = wallRef.current?.querySelector(`[data-album-index="${index}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // ── Navigation helpers ──
  const openAlbum = useCallback((index: number) => {
    setView('library');
    setActiveArtist(null);
    setSelectedAlbum(index);
    requestAnimationFrame(() => scrollToAlbum(index));
  }, [scrollToAlbum]);

  const openArtist = useCallback((artist: string) => {
    setView('library');
    setActiveArtist(artist);
  }, []);

  // Follow the playing track with the open sleeve — but only if a sleeve
  // is already open; don't spring the panel on someone just listening.
  useEffect(() => {
    if (currentTrack) setSelectedAlbum(prev => (prev !== null ? currentTrack.albumIndex : prev));
  }, [currentTrack]);

  // Deep-link via ?artist=...&album=... (used by FloatingPlayer).
  // Read from window.location to avoid Next 15's Suspense requirement
  // around useSearchParams in statically rendered pages.
  const consumedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (consumedDeepLinkRef.current || !albums.length || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const artist = params.get('artist');
    const album = params.get('album');
    if (!artist && !album) return;
    consumedDeepLinkRef.current = true;
    if (artist && album) {
      const idx = albums.findIndex(a => a.artist === artist && a.name === album);
      if (idx >= 0) openAlbum(idx);
    } else if (artist) {
      openArtist(artist);
    }
    // Clean the URL so the deep link isn't re-applied on refresh / back-nav
    window.history.replaceState(null, '', window.location.pathname);
  }, [albums, openAlbum, openArtist]);

  // Space toggles play/pause unless typing in a field (search, dialogs, etc.).
  // Capture phase runs before a focused button can treat Space as a click.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (!currentTrack) return;
      e.preventDefault();
      togglePlayPause();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [currentTrack, togglePlayPause]);

  // ── Shuffle / playlist playback (both bring the queue out) ──
  const shuffleEverything = () => { setQueueOpen(true); ctxShuffleAll(); };
  const shuffleAlbums = () => { setQueueOpen(true); ctxShuffleAlbums(); };
  const playPlaylist = (songs: PlaylistDetail['songs'], shuffle = false) => {
    setQueueOpen(true);
    ctxPlayPlaylist(songs, shuffle);
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
  useEffect(() => { if (view === 'stats') fetchStats(); }, [view, fetchStats]);

  const fetchPlaylists = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/music/playlists?username=${encodeURIComponent(username)}`);
      setPlaylists(await res.json());
    } catch (e) { console.error('Error fetching playlists:', e); }
  }, [username]);
  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  const fetchPlaylistDetail = async (id: number) => {
    if (!username) return;
    const res = await fetch(`/api/music/playlists/${id}?username=${encodeURIComponent(username)}`);
    setActivePlaylist(await res.json());
  };

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

  // Whole-album add: sequential POSTs so the server assigns positions in
  // track order (the endpoint dedupes repeats itself).
  const addAlbumToPlaylist = async (playlistId: number, artist: string, album: string) => {
    if (!username) return;
    const alb = albums.find(a => a.artist === artist && a.name === album);
    if (!alb) return;
    for (const si of sortedTrackIndices(alb.songs)) {
      await fetch(`/api/music/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, artist, album, song: alb.songs[si] }),
      });
    }
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
    if (pendingAdd) {
      if (pendingAdd.song) await addToPlaylist(pl.id, pendingAdd.artist, pendingAdd.album, pendingAdd.song);
      else await addAlbumToPlaylist(pl.id, pendingAdd.artist, pendingAdd.album);
      setPendingAdd(null);
    }
  };

  const deletePlaylist = async (id: number) => {
    if (!username) return;
    await fetch(`/api/music/playlists/${id}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
    fetchPlaylists();
    if (activePlaylist?.id === id) setActivePlaylist(null);
  };

  const requestNewPlaylist = (pending: PendingAdd | null) => {
    setPendingAdd(pending);
    setNewPlaylistOpen(true);
  };

  const openVisualizers = useCallback(() => {
    // Keep the fullscreen request inside the button's user gesture. flushSync
    // mounts the already-declared stage before that activation expires.
    flushSync(() => setVisualizerOpen(true));
    visualizerRef.current?.requestFullscreen().catch(() => {
      // Fullscreen can be denied by browser policy; the fixed stage still works.
    });
  }, []);
  const closeVisualizers = useCallback(() => setVisualizerOpen(false), []);

  const hasPlayer = currentTrack !== null;
  const tabs: { key: View; label: string }[] = [
    { key: 'library', label: 'Library' },
    ...(username ? [{ key: 'playlists' as View, label: 'Playlists' }] : []),
    { key: 'stats', label: 'Stats' },
  ];
  const genrePlaylists = useMemo<GeneratedPlaylist[]>(() =>
    buildGenrePlaylists(albums).map(({ genre, tracks }) => ({
      name: genre,
      songs: tracks.map(({ albumIndex, songIndex }, position) => ({
        artist: albums[albumIndex].artist,
        album: albums[albumIndex].name,
        song: albums[albumIndex].songs[songIndex],
        position,
      })),
    })),
  [albums]);

  return (
    <PlaylistActionsProvider value={{ playlists, addToPlaylist, addAlbumToPlaylist, requestNewPlaylist }}>
      {/* reducedMotion="user": the wall's FLIP glides and panel slides
          all switch off for prefers-reduced-motion. */}
      <MotionConfig reducedMotion="user">
      <div className="bar-theme flex flex-col" style={{ height: 'calc(100vh - 57px)' }}>

        {/* ── The counter: masthead, search, view tabs, size fader ── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 sm:flex-nowrap sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={`bar-lamp-dot ${hasPlayer ? 'text-primary' : 'text-muted-foreground/40'}`} />
            <h1 className="bar-serif shrink-0 text-lg font-semibold tracking-tight">
              {/* The narrowest phones get the short signage */}
              BarFoo<span className="hidden text-primary min-[440px]:inline">&nbsp;Records</span>
            </h1>
            {username && (
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                listening as <strong className="text-foreground">{username}</strong>
              </span>
            )}
          </div>

          <SearchBox onOpenAlbum={openAlbum} onOpenArtist={openArtist} />

          <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
            {/* View tabs */}
            <div role="tablist" className="flex items-center gap-0.5 rounded-[5px] border border-border bg-card/70 p-0.5">
              {tabs.map(t => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={view === t.key}
                  data-on={view === t.key}
                  className="bar-tab px-2.5 py-1 text-xs font-medium"
                  onClick={() => { setView(t.key); setActiveArtist(null); setActivePlaylist(null); }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {albums.length > 0 && (
              <div className="flex items-center">
                <Button
                  variant="ghost" size="sm" onClick={shuffleEverything}
                  className={`h-8 w-8 p-0 text-xs sm:w-auto sm:px-3 ${shuffleMode ? 'text-primary' : ''}`}
                  aria-label="Shuffle all songs"
                >
                  <Shuffle className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Songs</span>
                </Button>
                <Button
                  variant="ghost" size="sm" onClick={shuffleAlbums}
                  className="h-8 w-8 p-0 text-xs sm:w-auto sm:px-3"
                  aria-label="Shuffle albums"
                  title="Randomize albums, keeping each record in track order"
                >
                  <ListMusic className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Albums</span>
                </Button>
              </div>
            )}

            {/* The size fader — shelve the wall tighter or looser */}
            {view === 'library' && !activeArtist && (
              <div className="hidden items-center gap-1.5 border-l border-border pl-3 md:flex" title="Album size">
                <Disc className="h-3 w-3 text-muted-foreground" />
                <input
                  type="range"
                  min={SIZE_MIN} max={SIZE_MAX} step={4}
                  value={sizePx}
                  onChange={e => changeSize(parseInt(e.target.value, 10))}
                  className="bar-fader w-24"
                  aria-label="Album size"
                />
                <Disc className="h-[18px] w-[18px] text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* ── The room: wall + side panel ── */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div ref={wallRef} className="min-w-0 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {view === 'stats' ? (
                <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 sm:p-5">
                  {!stats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-md" />)}
                      </div>
                      <Skeleton className="h-48 rounded-md" />
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 rounded-md" />)}
                      </div>
                    </div>
                  ) : (
                    <StatsView stats={stats} />
                  )}
                </motion.div>
              ) : view === 'playlists' ? (
                <PlaylistsView
                  key="playlists"
                  playlists={playlists}
                  generated={genrePlaylists}
                  active={activePlaylist}
                  onOpen={fetchPlaylistDetail}
                  onBack={() => setActivePlaylist(null)}
                  onDelete={deletePlaylist}
                  onPlay={playPlaylist}
                  onRemoveSong={removeFromPlaylist}
                  onNew={() => requestNewPlaylist(null)}
                />
              ) : activeArtist ? (
                <ArtistView
                  key={`artist-${activeArtist}`}
                  artist={activeArtist}
                  onBack={() => setActiveArtist(null)}
                  onOpenAlbum={openAlbum}
                  onShuffled={() => setQueueOpen(true)}
                />
              ) : (
                <motion.div key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <AlbumWall
                    sizePx={sizePx}
                    selected={selectedAlbum}
                    onSelect={setSelectedAlbum}
                    loading={albumsLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <SidePanel
            detailIndex={view === 'library' && !activeArtist ? selectedAlbum : null}
            queueOpen={queueOpen}
            onCloseDetail={() => setSelectedAlbum(null)}
            onCloseQueue={() => setQueueOpen(false)}
            onOpenArtist={openArtist}
          />
        </div>

        {/* ── The amplifier console ── */}
        <AnimatePresence>
          {hasPlayer && (
            <NowPlayingConsole
              queueOpen={queueOpen}
              onToggleQueue={() => setQueueOpen(o => !o)}
              onShuffle={shuffleEverything}
              onVisualize={openVisualizers}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
            />
          )}
        </AnimatePresence>

        <VisualizerStage
          open={visualizerOpen}
          onClose={closeVisualizers}
          stageRef={visualizerRef}
        />

        {/* ── Who's listening? (plays and playlists are per listener) ── */}
        {!username && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bar-panel w-80 p-6"
            >
              <div className="mb-1 flex items-center gap-2.5">
                <span className="bar-lamp-dot text-primary" />
                <h2 className="bar-serif text-lg font-semibold">BarFoo <span className="text-primary">Records</span></h2>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Who&apos;s listening? Plays and playlists are kept per listener.
              </p>
              <form onSubmit={(e) => {
                e.preventDefault();
                const name = nameInput.trim();
                if (name) setUsername(name);
              }}>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your name"
                  className="mb-3 w-full rounded-[4px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  autoFocus
                />
                <Button type="submit" className="w-full" disabled={!nameInput.trim()}>
                  Start listening
                </Button>
              </form>
            </motion.div>
          </div>
        )}

        {/* ── New playlist ── */}
        <Dialog open={newPlaylistOpen} onOpenChange={(open) => { setNewPlaylistOpen(open); if (!open) { setNewPlaylistName(''); setPendingAdd(null); } }}>
          <DialogContent className="bar-pop sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="bar-serif">New playlist</DialogTitle>
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
                className="mb-4 w-full rounded-[4px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                autoFocus
              />
              <DialogFooter>
                <Button type="submit" disabled={!newPlaylistName.trim()}>Create playlist</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      </MotionConfig>
    </PlaylistActionsProvider>
  );
}
