'use client';

// The house setlists. Data ops (fetch/create/delete/add/remove) live in
// the page; this renders the shelf of playlists and one opened list.

import { useState } from 'react';
import { ChevronLeft, Music2, Play, Plus, Shuffle, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { cleanSongDisplay } from '@/lib/songUtils';
import type { GeneratedPlaylist, Playlist, PlaylistDetail } from './shared';

export function PlaylistsView({ playlists, generated, active, onOpen, onBack, onDelete, onPlay, onRemoveSong, onNew }: {
  playlists: Playlist[];
  generated: GeneratedPlaylist[];
  active: PlaylistDetail | null;
  onOpen: (id: number) => void;
  onBack: () => void;
  onDelete: (id: number) => void;
  onPlay: (songs: PlaylistDetail['songs'], shuffle?: boolean) => void;
  onRemoveSong: (playlistId: number, artist: string, album: string, song: string) => void;
  onNew: () => void;
}) {
  const [activeGenerated, setActiveGenerated] = useState<GeneratedPlaylist | null>(null);
  const opened = activeGenerated ?? active;

  return (
    <motion.div key="playlists" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 p-4 sm:p-5">
      {!opened ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="bar-serif text-lg font-semibold">Playlists</h2>
            <Button size="sm" variant="outline" onClick={onNew} className="h-8 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />New playlist
            </Button>
          </div>

          <section>
            <p className="bar-etch mb-2">Automatic · from embedded genre tags</p>
            {generated.length === 0 ? (
              <p className="text-sm text-muted-foreground">No genre tags found yet. Run the music scan to read them from your files.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {generated.map(playlist => (
                  <button
                    key={playlist.name}
                    className="bar-panel group p-4 text-left transition-colors hover:bg-muted/20"
                    onClick={() => setActiveGenerated(playlist)}
                  >
                    <span className="flex items-center gap-2">
                      <Music2 className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate text-sm font-semibold">{playlist.name}</span>
                    </span>
                    <span className="bar-etch mt-1 block">
                      {playlist.songs.length} song{playlist.songs.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="bar-etch mb-2">Your playlists</p>
            {playlists.length === 0 ? (
              <p className="text-sm text-muted-foreground">No playlists yet. Right-click any song to start one.</p>
            ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {playlists.map(pl => (
                <div
                  key={pl.id}
                  className="bar-panel group cursor-pointer p-4 transition-colors hover:bg-muted/20"
                  onClick={() => onOpen(pl.id)}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="truncate text-sm font-semibold">{pl.name}</h3>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); onDelete(pl.id); }}
                      aria-label={`Delete ${pl.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="bar-etch mt-1">{pl.song_count} song{pl.song_count !== 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (activeGenerated) setActiveGenerated(null);
                else onBack();
              }}
              className="h-8"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />Back
            </Button>
            <span className="min-w-0 flex-1">
              {activeGenerated && <span className="bar-etch block">Automatic · Genre</span>}
              <h2 className="bar-serif truncate text-lg font-semibold">{opened.name}</h2>
            </span>
            <Button size="sm" onClick={() => onPlay(opened.songs)} className="h-8 text-xs">
              <Play className="mr-1 h-3.5 w-3.5" />Play
            </Button>
            <Button size="sm" variant="outline" onClick={() => onPlay(opened.songs, true)} className="h-8 text-xs">
              <Shuffle className="mr-1 h-3.5 w-3.5" />Shuffle
            </Button>
          </div>
          {opened.songs.length === 0 ? (
            <p className="text-sm text-muted-foreground">This playlist is empty. Right-click songs to add them.</p>
          ) : (
            <div className="space-y-0.5">
              {opened.songs.map((s, idx) => (
                <div
                  key={`${s.artist}-${s.album}-${s.song}-${idx}`}
                  className="group flex items-center gap-3 rounded-[4px] px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <span className="bar-readout w-5 shrink-0 text-right text-[11px] text-muted-foreground">{idx + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{cleanSongDisplay(s.song, s.artist, s.album)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.artist} — {s.album}</span>
                  </span>
                  {!activeGenerated && active && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={() => onRemoveSong(active.id, s.artist, s.album, s.song)}
                      aria-label="Remove from playlist"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
