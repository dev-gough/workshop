'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, BarChart3, Music, Shuffle, ListMusic, X, Plus, Trash2, ListPlus, Disc3, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { motion, AnimatePresence } from 'motion/react';

interface Album {
  name: string;
  artist: string;
  coverImage?: string;
  songs: string[];
}

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
  topAlbums: { artist: string; album: string; play_count: number }[];
  topListeners: { username: string; play_count: number }[];
  recentPlays: { artist: string; album: string; song: string; username: string; played_at: string }[];
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000`;
}

export default function BarFooPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<number | null>(null);
  const [currentTrack, setCurrentTrack] = useState<{ albumIndex: number; songIndex: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = getCookie('barfoo_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [muted, setMuted] = useState(false);
  const [username, setUsername] = useState<string | null>(() => getCookie('barfoo_user'));
  const [nameInput, setNameInput] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [queue, setQueue] = useState<{ albumIndex: number; songIndex: number }[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [pendingSong, setPendingSong] = useState<{ artist: string; album: string; song: string } | null>(null);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ── Data fetching ──

  useEffect(() => {
    const fetchAlbums = async () => {
      try {
        const response = await fetch('/api/music');
        const data = await response.json();
        setAlbums(data);
      } catch (error) {
        console.error('Error fetching albums:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAlbums();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => playNext();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [currentTrack, albums]);

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

  const playPlaylist = (songs: PlaylistDetail['songs'], shuffle = false) => {
    const resolved = songs.map(s => {
      const albumIndex = albums.findIndex(a => a.artist === s.artist && a.name === s.album);
      const songIndex = albumIndex >= 0 ? albums[albumIndex].songs.indexOf(s.song) : -1;
      return { albumIndex, songIndex };
    }).filter(t => t.albumIndex >= 0 && t.songIndex >= 0);

    if (shuffle) {
      for (let i = resolved.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [resolved[i], resolved[j]] = [resolved[j], resolved[i]];
      }
    }

    setQueue(resolved);
    setQueueIndex(0);
    setShuffleMode(shuffle);
    setSidebarOpen(true);
    if (resolved.length > 0) playTrack(resolved[0].albumIndex, resolved[0].songIndex);
  };

  // ── Playback ──

  const playTrack = (albumIndex: number, songIndex: number) => {
    const album = albums[albumIndex];
    const song = album.songs[songIndex];
    const url = `/api/music/stream?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}&song=${encodeURIComponent(song)}`;

    setCurrentTrack({ albumIndex, songIndex });
    setSelectedAlbum(albumIndex);

    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      audio.play();
    }

    if (username) {
      fetch('/api/music/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: album.artist, album: album.name, song, username }),
      }).catch(() => {});
    }
  };

  const playSong = (albumIndex: number, songIndex: number) => {
    const album = albums[albumIndex];
    const newQueue = album.songs.map((_, i) => ({ albumIndex, songIndex: i }));
    setQueue(newQueue);
    setQueueIndex(songIndex);
    setShuffleMode(false);
    playTrack(albumIndex, songIndex);
  };

  const playFromQueue = (idx: number) => {
    if (idx < 0 || idx >= queue.length) return;
    setQueueIndex(idx);
    const track = queue[idx];
    playTrack(track.albumIndex, track.songIndex);
  };

  const shuffleAll = () => {
    const allTracks: { albumIndex: number; songIndex: number }[] = [];
    albums.forEach((album, ai) => {
      album.songs.forEach((_, si) => {
        allTracks.push({ albumIndex: ai, songIndex: si });
      });
    });
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }
    setQueue(allTracks);
    setQueueIndex(0);
    setShuffleMode(true);
    setSidebarOpen(true);
    if (allTracks.length > 0) {
      playTrack(allTracks[0].albumIndex, allTracks[0].songIndex);
    }
  };

  const playNext = () => {
    if (queue.length > 0 && queueIndex < queue.length - 1) {
      playFromQueue(queueIndex + 1);
    } else {
      setIsPlaying(false);
    }
  };

  const playPrev = () => {
    if (queue.length > 0 && queueIndex > 0) {
      playFromQueue(queueIndex - 1);
    }
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play(); else audio.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * duration;
  };

  const setVolumeValue = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    setMuted(clamped === 0);
    if (audioRef.current) audioRef.current.volume = clamped;
    setCookie('barfoo_volume', String(clamped));
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolumeValue(parseFloat(e.target.value));
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setVolumeValue((muted ? 0 : volume) + delta);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) {
      audio.volume = volume || 1;
      setMuted(false);
      if (volume === 0) setVolume(1);
    } else {
      audio.volume = 0;
      setMuted(true);
    }
  };

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentAlbum = currentTrack ? albums[currentTrack.albumIndex] : null;
  const currentSongName = currentTrack ? albums[currentTrack.albumIndex]?.songs[currentTrack.songIndex] : null;
  const displaySongName = (s: string) => s.includes('/') ? s.split('/').pop()! : s;
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
      return (
        <SongContextMenu artist={alb.artist} album={alb.name} song={songs[globalIdx]}>
          <div
            className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${
              isCurrent
                ? 'bg-primary/15 text-primary'
                : 'hover:bg-muted/60'
            }`}
            onClick={() => playSong(albumIdx, globalIdx)}
          >
            <span className={`text-xs w-5 text-right tabular-nums ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num}</span>
            <span className="text-sm flex-1 truncate">{song}</span>
            {isCurrent && isPlaying ? (
              <div className="flex items-center gap-0.5">
                <div className="w-0.5 h-3 bg-primary rounded-full animate-pulse" />
                <div className="w-0.5 h-4 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                <div className="w-0.5 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
              </div>
            ) : (
              <Play className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
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
      return Object.entries(groups).map(([disc, tracks]) => (
        <div key={disc} className="mb-4 last:mb-0">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5 px-3">{disc}</h4>
          {tracks.map(({ song, globalIdx }, idx) => (
            <SongRow key={globalIdx} song={song} globalIdx={globalIdx} num={idx + 1} />
          ))}
        </div>
      ));
    }

    return songs.map((song, idx) => (
      <SongRow key={idx} song={song} globalIdx={idx} num={idx + 1} />
    ));
  };

  // ── Layout ──

  const hasPlayer = currentTrack !== null;

  return (
    <>
      <audio ref={audioRef} preload="auto" />

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
                onClick={() => { setShowPlaylists(!showPlaylists); setShowStats(false); }}
                className="h-8 text-xs"
              >
                <ListMusic className="h-3.5 w-3.5 mr-1" />
                Playlists
              </Button>
            )}
            <Button
              variant={showStats ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setShowStats(!showStats); setShowPlaylists(false); if (!showStats) fetchStats(); }}
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
          <div className={`flex-1 min-w-0 overflow-y-auto ${hasPlayer ? 'pb-24' : 'pb-4'}`}>
            <AnimatePresence mode="wait">
              {showStats ? (
                <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-5">
                  {!stats ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Top Songs */}
                      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
                        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Songs</h3>
                        <div className="space-y-1">
                          {stats.topSongs.map((s, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                              <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                              <span className="text-sm truncate flex-1">{s.song}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-28">{s.artist}</span>
                              <span className="text-xs font-mono text-muted-foreground tabular-nums">{s.play_count}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Top Albums */}
                      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
                        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Albums</h3>
                        <div className="space-y-1">
                          {stats.topAlbums.map((a, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                              <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                              <span className="text-sm truncate flex-1">{a.album}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-28">{a.artist}</span>
                              <span className="text-xs font-mono text-muted-foreground tabular-nums">{a.play_count}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Top Listeners */}
                      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
                        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Top Listeners</h3>
                        <div className="space-y-1">
                          {stats.topListeners.map((l, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                              <span className="text-xs w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                              <span className="text-sm flex-1">{l.username}</span>
                              <span className="text-xs font-mono text-muted-foreground tabular-nums">{l.play_count}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Recent Plays */}
                      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
                        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">Recent Plays</h3>
                        <div className="space-y-1">
                          {stats.recentPlays.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                              <span className="text-sm truncate flex-1">{p.song}</span>
                              <span className="text-xs text-muted-foreground">{p.username}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {new Date(p.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
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
                        <Button size="sm" onClick={() => playPlaylist(activePlaylist.songs)} className="h-8 text-xs">
                          <Play className="h-3.5 w-3.5 mr-1" />Play
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => playPlaylist(activePlaylist.songs, true)} className="h-8 text-xs">
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
                                <p className="text-sm truncate">{s.song.includes('/') ? s.song.split('/').pop() : s.song}</p>
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
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer shadow-md group ${
                            isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
                          }`}
                          onClick={() => setSelectedAlbum(isSelected ? null : index)}
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
                                <div className="w-0.5 h-2 bg-primary-foreground rounded-full animate-pulse" />
                                <div className="w-0.5 h-3 bg-primary-foreground rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                                <div className="w-0.5 h-1.5 bg-primary-foreground rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                              </div>
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
            {(sel || sidebarOpen) && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: sel && sidebarOpen ? 640 : 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="shrink-0 border-l border-border/60 flex overflow-hidden"
              >
                {/* Song detail */}
                {sel && (
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
                          <p className="text-xs text-muted-foreground truncate">{sel.artist}</p>
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
                                          <p className="text-xs truncate font-medium">{displaySongName(song)}</p>
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
                        className="w-11 h-11 rounded-lg bg-cover bg-center shadow-md cursor-pointer shrink-0"
                        style={{ backgroundImage: `url(${currentAlbum.coverImage})` }}
                      />
                    </SongContextMenu>
                  ) : (
                    <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Music className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{currentSongName ? displaySongName(currentSongName) : ''}</p>
                    <p className="text-xs text-muted-foreground truncate">{currentAlbum?.artist}</p>
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
                setCookie('barfoo_user', name);
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
