'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types (trimmed to what the rooms actually render) ──

export interface ServerStats {
  hostname: string;
  cpuCount: number;
  cpuTemp: number | null;
  loadAverage: { '1m': number; '5m': number; '15m': number };
  memory: { total: number; used: number; percentUsed: number };
  disks: { total: number; used: number; percentUsed: number; mountPoint: string }[];
  uptimeSeconds: number;
}

export interface ServiceInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
}

export interface MusicStats {
  summary: { total_plays: number; unique_artists: number; unique_albums: number; unique_songs: number };
  topAlbums: { artist: string; album: string; play_count: number; coverUrl: string | null }[];
  recentPlays: { artist: string; album: string; song: string; played_at: string }[];
}

export interface AlbumRow {
  id: number;
  artist: string;
  name: string;
  coverUrl: string | null;
}

export interface ChallengeData {
  totalPoints: { level: string; current: number; max: number; percentile: number } | null;
}

export interface GameData {
  champion: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  points_gained: number;
  tier_ups: number;
  game_creation: number;
}

export interface PtAccount {
  id: number;
  name: string;
  seedCents: number;
  cashCents: number;
  holdingsCents: number;
  totalValueCents: number;
  totalPnlCents: number;
  positionCount: number;
}

export interface FetchRow {
  id: number;
  mode: 'tv' | 'movie';
  original_name: string | null;
  cleaned_title: string | null;
  final_path: string | null;
  status: string;
  ingested_at: string | null;
  submitted_at: string;
}

export interface SwActivity {
  kind: 'expense' | 'payment';
  id: number;
  created_at: string;
  group_name: string;
  description?: string;
  total_cents?: string;
  payer_name?: string;
  amount_cents?: string;
  from_name?: string;
  to_name?: string;
}

export interface BfRun {
  id: number;
  target: string;
  status: string;
  generations: number;
  best_fitness: number | null;
  completed_at: string;
}

export interface SlskStats {
  downloads: {
    summary: { total: string; completed: string; total_bytes: string; unique_sources: string };
    topSources: { username: string; count: string; total_bytes: string }[];
  };
}

export interface HomeData {
  server: ServerStats | null;
  services: ServiceInfo[];
  music: MusicStats | null;
  albums: AlbumRow[];
  challenges: ChallengeData | null;
  games: GameData[];
  accounts: PtAccount[];
  fetches: FetchRow[];
  splitwiser: SwActivity[];
  brainfuck: BfRun[];
  soulseek: SlskStats | null;
}

// ── Small shared helpers ──

export function timeAgo(ts: number | string): string {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : (ts > 1e12 ? ts : ts * 1000);
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** "04 - Escape.flac" → "Escape" */
export function cleanSongName(file: string): string {
  return file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d+[\s.\-–]+/, '').replace(/\[.*?\]\s*$/, '').trim();
}

// ── Hook ──

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useHomeData(): HomeData {
  const [server, setServer] = useState<ServerStats | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [music, setMusic] = useState<MusicStats | null>(null);
  const [albums, setAlbums] = useState<AlbumRow[]>([]);
  const [challenges, setChallenges] = useState<ChallengeData | null>(null);
  const [games, setGames] = useState<GameData[]>([]);
  const [accounts, setAccounts] = useState<PtAccount[]>([]);
  const [fetches, setFetches] = useState<FetchRow[]>([]);
  const [splitwiser, setSplitwiser] = useState<SwActivity[]>([]);
  const [brainfuck, setBrainfuck] = useState<BfRun[]>([]);
  const [soulseek, setSoulseek] = useState<SlskStats | null>(null);

  const fetchServer = useCallback(async () => {
    const [stats, svcs] = await Promise.all([
      getJson<ServerStats>('/api/server'),
      getJson<{ services: ServiceInfo[] }>('/api/server/services'),
    ]);
    if (stats?.hostname) setServer(stats);
    if (svcs?.services) setServices(svcs.services);
  }, []);

  // Live-ish: server vitals refresh; everything else is a snapshot on load.
  useEffect(() => {
    fetchServer();
    const interval = setInterval(fetchServer, 30000);
    return () => clearInterval(interval);
  }, [fetchServer]);

  useEffect(() => {
    (async () => {
      const [m, a, c, g, acct, jf, sw, bf, slsk] = await Promise.all([
        getJson<MusicStats>('/api/music/stats'),
        getJson<AlbumRow[]>('/api/music'),
        getJson<ChallengeData>('/api/challenges'),
        getJson<GameData[]>('/api/challenges/games'),
        getJson<{ accounts: PtAccount[] }>('/api/paper-trading/accounts'),
        getJson<{ history: FetchRow[] }>('/api/jellyfin/history?limit=5'),
        getJson<{ activity: SwActivity[] }>('/api/splitwiser/activity?limit=5'),
        getJson<{ activity: BfRun[] }>('/api/brainfuck/activity?limit=5'),
        getJson<SlskStats>('/api/soulseek/stats'),
      ]);
      if (m?.summary) setMusic(m);
      if (Array.isArray(a)) setAlbums(a);
      if (c?.totalPoints) setChallenges(c);
      if (Array.isArray(g)) setGames(g);
      if (acct?.accounts) setAccounts(acct.accounts);
      if (jf?.history) setFetches(jf.history);
      if (sw?.activity) setSplitwiser(sw.activity);
      if (bf?.activity) setBrainfuck(bf.activity);
      if (slsk?.downloads) setSoulseek(slsk);
    })();
  }, []);

  return { server, services, music, albums, challenges, games, accounts, fetches, splitwiser, brainfuck, soulseek };
}
