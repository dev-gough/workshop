'use client';

// Shared plumbing for the listening bar: the playlist-actions context
// (so any song row can offer "Add to playlist" without prop-drilling),
// the song context menu itself, and the little EQ lamp that marks
// whatever's currently playing.

import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';
import { ListPlus, Plus, Share2 } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';

export interface Playlist {
  id: number;
  name: string;
  song_count: number;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  songs: { artist: string; album: string; song: string; position: number }[];
}

export interface Stats {
  topSongs: { artist: string; album: string; song: string; play_count: number }[];
  topAlbums: { artist: string; album: string; play_count: number; coverUrl?: string | null }[];
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

interface PlaylistActions {
  playlists: Playlist[];
  addToPlaylist: (playlistId: number, artist: string, album: string, song: string) => void;
  /** Open the "new playlist" dialog, optionally pre-loading a song to add. */
  requestNewPlaylist: (song: { artist: string; album: string; song: string } | null) => void;
}

const PlaylistActionsContext = createContext<PlaylistActions>({
  playlists: [],
  addToPlaylist: () => {},
  requestNewPlaylist: () => {},
});

export function PlaylistActionsProvider({ value, children }: { value: PlaylistActions; children: ReactNode }) {
  return <PlaylistActionsContext.Provider value={value}>{children}</PlaylistActionsContext.Provider>;
}

export function SongContextMenu({ artist, album, song, children }: {
  artist: string; album: string; song: string; children: ReactNode;
}) {
  const { playlists, addToPlaylist, requestNewPlaylist } = useContext(PlaylistActionsContext);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* Menus portal to <body>, outside the page's theme scope — carry it. */}
      <ContextMenuContent className="bar-pop">
        <ContextMenuSub>
          <ContextMenuSubTrigger><ListPlus className="h-4 w-4 mr-2" />Add to playlist</ContextMenuSubTrigger>
          <ContextMenuSubContent className="bar-pop">
            {playlists.map(pl => (
              <ContextMenuItem key={pl.id} onClick={() => addToPlaylist(pl.id, artist, album, song)}>
                {pl.name}
              </ContextMenuItem>
            ))}
            {playlists.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onClick={() => requestNewPlaylist({ artist, album, song })}>
              <Plus className="h-4 w-4 mr-2" />New playlist…
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/projects/soulseek?search=${encodeURIComponent(artist)}`}>
            <Share2 className="h-4 w-4 mr-2" />Find artist on Soulseek
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Three bouncing level bars — the "this one's playing" lamp. */
export function EqBars({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-0.5 ${className}`} aria-hidden>
      <span className="w-0.5 rounded-full bg-primary animate-[bar-bounce_0.8s_ease-in-out_infinite]" style={{ height: 11 }} />
      <span className="w-0.5 rounded-full bg-primary animate-[bar-bounce_0.8s_ease-in-out_0.15s_infinite]" style={{ height: 15 }} />
      <span className="w-0.5 rounded-full bg-primary animate-[bar-bounce_0.8s_ease-in-out_0.3s_infinite]" style={{ height: 8 }} />
    </span>
  );
}
