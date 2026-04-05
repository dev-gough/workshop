'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { sortedTrackIndices } from '@/lib/songUtils';

// ── Types ──

export interface Album {
  name: string;
  artist: string;
  coverImage?: string;
  songs: string[];
}

export interface TrackRef {
  albumIndex: number;
  songIndex: number;
}

interface AudioContextType {
  // Data
  albums: Album[];
  albumsLoading: boolean;
  // Playback state
  currentTrack: TrackRef | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  queue: TrackRef[];
  queueIndex: number;
  shuffleMode: boolean;
  // User
  username: string | null;
  setUsername: (name: string | null) => void;
  // Playback controls
  playTrack: (albumIndex: number, songIndex: number) => void;
  playSong: (albumIndex: number, songIndex: number) => void;
  playAlbum: (albumIndex: number) => void;
  playPlaylist: (songs: { artist: string; album: string; song: string }[], shuffle?: boolean) => void;
  playFromQueue: (idx: number) => void;
  playNext: () => void;
  playPrev: () => void;
  togglePlayPause: () => void;
  shuffleAll: () => void;
  // Audio controls
  seek: (e: React.MouseEvent<HTMLDivElement>) => void;
  setVolumeValue: (v: number) => void;
  changeVolume: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleVolumeWheel: (e: React.WheelEvent) => void;
  toggleMute: () => void;
  // Queue UI
  setQueue: (q: TrackRef[]) => void;
  setQueueIndex: (i: number) => void;
  setShuffleMode: (s: boolean) => void;
  // Helpers
  formatTime: (s: number) => string;
  currentAlbum: Album | null;
  currentSongName: string | null;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000`;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) throw new Error('useAudio must be used within AudioProvider');
  return context;
};

export default function AudioProvider({ children }: { children: ReactNode }) {
  // ── State ──
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<TrackRef | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = getCookie('barfoo_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [muted, setMuted] = useState(false);
  const [username, setUsernameState] = useState<string | null>(() => getCookie('barfoo_user'));
  const [queue, setQueue] = useState<TrackRef[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffleMode, setShuffleMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // ── Fetch albums ──
  useEffect(() => {
    fetch('/api/music')
      .then(r => r.json())
      .then(setAlbums)
      .catch(e => console.error('Error fetching albums:', e))
      .finally(() => setAlbumsLoading(false));
  }, []);

  // ── Audio event listeners ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => playNextRef.current();
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
  }, []);

  // ── Username ──
  const setUsername = useCallback((name: string | null) => {
    setUsernameState(name);
    if (name) setCookie('barfoo_user', name);
  }, []);

  // ── Playback functions ──
  // Use refs for functions called from audio event handlers to avoid stale closures
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);

  const playTrack = useCallback((albumIndex: number, songIndex: number) => {
    const album = albums[albumIndex];
    if (!album) return;
    const song = album.songs[songIndex];
    const url = `/api/music/stream?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}&song=${encodeURIComponent(song)}`;

    setCurrentTrack({ albumIndex, songIndex });

    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      audio.play();
    }

    const user = getCookie('barfoo_user');
    if (user) {
      fetch('/api/music/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: album.artist, album: album.name, song, username: user }),
      }).catch(() => {});
    }
  }, [albums]);

  const playFromQueue = useCallback((idx: number) => {
    const q = queueRef.current;
    if (idx < 0 || idx >= q.length) return;
    setQueueIndex(idx);
    const track = q[idx];
    playTrack(track.albumIndex, track.songIndex);
  }, [playTrack]);

  const playNext = useCallback(() => {
    const q = queueRef.current;
    const qi = queueIndexRef.current;
    if (q.length > 0 && qi < q.length - 1) {
      playFromQueue(qi + 1);
    } else {
      setIsPlaying(false);
    }
  }, [playFromQueue]);

  const playNextRef = useRef(playNext);
  useEffect(() => { playNextRef.current = playNext; }, [playNext]);

  const playPrev = useCallback(() => {
    const qi = queueIndexRef.current;
    if (queueRef.current.length > 0 && qi > 0) {
      playFromQueue(qi - 1);
    }
  }, [playFromQueue]);

  const playSong = useCallback((albumIndex: number, songIndex: number) => {
    const album = albums[albumIndex];
    if (!album) return;
    const newQueue = album.songs.map((_, i) => ({ albumIndex, songIndex: i }));
    setQueue(newQueue);
    setQueueIndex(songIndex);
    setShuffleMode(false);
    playTrack(albumIndex, songIndex);
  }, [albums, playTrack]);

  const playAlbum = useCallback((albumIndex: number) => {
    const sorted = sortedTrackIndices(albums[albumIndex].songs);
    playSong(albumIndex, sorted[0]);
  }, [albums, playSong]);

  const playPlaylist = useCallback((songs: { artist: string; album: string; song: string }[], shuffle = false) => {
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
    if (resolved.length > 0) playTrack(resolved[0].albumIndex, resolved[0].songIndex);
  }, [albums, playTrack]);

  const shuffleAll = useCallback(() => {
    const allTracks: TrackRef[] = [];
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
    if (allTracks.length > 0) playTrack(allTracks[0].albumIndex, allTracks[0].songIndex);
  }, [albums, playTrack]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play(); else audio.pause();
  }, []);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  }, []);

  const setVolumeValue = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    setMuted(clamped === 0);
    if (audioRef.current) audioRef.current.volume = clamped;
    setCookie('barfoo_volume', String(clamped));
  }, []);

  const changeVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolumeValue(parseFloat(e.target.value));
  }, [setVolumeValue]);

  const handleVolumeWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setVolumeValue((mutedRef.current ? 0 : volumeRef.current) + delta);
  }, [setVolumeValue]);

  const toggleMute = useCallback(() => {
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
  }, [muted, volume]);

  const formatTime = useCallback((s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const currentAlbum = currentTrack ? albums[currentTrack.albumIndex] ?? null : null;
  const currentSongName = currentTrack ? albums[currentTrack.albumIndex]?.songs[currentTrack.songIndex] ?? null : null;

  return (
    <AudioContext.Provider value={{
      albums, albumsLoading,
      currentTrack, isPlaying, progress, duration, volume, muted,
      queue, queueIndex, shuffleMode,
      username, setUsername,
      playTrack, playSong, playAlbum, playPlaylist, playFromQueue,
      playNext, playPrev, togglePlayPause, shuffleAll,
      seek, setVolumeValue, changeVolume, handleVolumeWheel, toggleMute,
      setQueue, setQueueIndex, setShuffleMode,
      formatTime, currentAlbum, currentSongName,
    }}>
      <audio ref={audioRef} preload="auto" />
      {children}
    </AudioContext.Provider>
  );
}
