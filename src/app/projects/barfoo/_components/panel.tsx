'use client';

// The right-hand side of the bar: the sleeve you pulled off the shelf
// (album detail) and the stack of what's queued up next. On desktop
// they dock as columns; on smaller screens they slide over the wall.

import { type ReactNode } from 'react';
import { Music, Play, Radio, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/components/AudioProvider';
import { buildAlbumRadioQueue } from '@/lib/musicLibrary';
import { cleanSongDisplay, extractTrackNumber, sortedTrackIndices } from '@/lib/songUtils';
import { AlbumContextMenu, EqBars, SongContextMenu } from './shared';

function TrackRow({ albumIdx, songIdx, num }: { albumIdx: number; songIdx: number; num: number }) {
  const { albums, currentTrack, isPlaying, playSong } = useAudio();
  const alb = albums[albumIdx];
  const song = alb.songs[songIdx];
  const isCurrent = currentTrack?.albumIndex === albumIdx && currentTrack?.songIndex === songIdx;
  const slashIdx = song.indexOf('/');
  const display = cleanSongDisplay(slashIdx >= 0 ? song.substring(slashIdx + 1) : song, alb.artist, alb.name);
  return (
    <SongContextMenu artist={alb.artist} album={alb.name} song={song}>
      <div
        className={`group flex cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 transition-colors ${
          isCurrent ? 'bg-primary/12 text-primary' : 'hover:bg-muted/60'
        }`}
        onClick={() => playSong(albumIdx, songIdx)}
      >
        <span className={`bar-readout w-5 shrink-0 text-right text-[11px] ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{display}</span>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {isCurrent && isPlaying ? (
            <EqBars />
          ) : (
            <Play className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:block" />
          )}
        </span>
      </div>
    </SongContextMenu>
  );
}

function AlbumTrackList({ albumIdx }: { albumIdx: number }) {
  const { albums } = useAudio();
  const songs = albums[albumIdx].songs;
  const hasDiscs = songs.some(s => s.includes('/'));

  if (hasDiscs) {
    const groups: Record<string, { song: string; globalIdx: number }[]> = {};
    songs.forEach((song, idx) => {
      const slashIdx = song.indexOf('/');
      const disc = slashIdx >= 0 ? song.substring(0, slashIdx) : 'Songs';
      const name = slashIdx >= 0 ? song.substring(slashIdx + 1) : song;
      if (!groups[disc]) groups[disc] = [];
      groups[disc].push({ song: name, globalIdx: idx });
    });
    return (
      <>
        {Object.entries(groups).map(([disc, tracks]) => {
          const sorted = [...tracks].sort((a, b) => extractTrackNumber(a.song) - extractTrackNumber(b.song) || a.song.localeCompare(b.song));
          return (
            <div key={disc} className="mb-4 last:mb-0">
              <h4 className="bar-etch mb-1.5 px-3">{disc}</h4>
              {sorted.map(({ globalIdx }, idx) => (
                <TrackRow key={globalIdx} albumIdx={albumIdx} songIdx={globalIdx} num={idx + 1} />
              ))}
            </div>
          );
        })}
      </>
    );
  }

  const sorted = sortedTrackIndices(songs);
  return (
    <>
      {sorted.map((origIdx, displayIdx) => (
        <TrackRow key={origIdx} albumIdx={albumIdx} songIdx={origIdx} num={displayIdx + 1} />
      ))}
    </>
  );
}

export function AlbumDetail({ albumIndex, onClose, onOpenArtist, onOpenQueue }: {
  albumIndex: number;
  onClose: () => void;
  onOpenArtist: (artist: string) => void;
  onOpenQueue: () => void;
}) {
  const { albums, playAlbum, playPlaylist } = useAudio();
  const album = albums[albumIndex];
  if (!album) return null;
  const startRadio = () => {
    const songs = buildAlbumRadioQueue(albums, albumIndex).map(({ albumIndex: ai, songIndex }) => ({
      artist: albums[ai].artist,
      album: albums[ai].name,
      song: albums[ai].songs[songIndex],
    }));
    playPlaylist(songs);
    onClose();
    onOpenQueue();
  };
  return (
    // min-w-0 matters: without it, flex min-width:auto lets the header
    // row push the panel wider than its docked column.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 p-4">
        <div className="flex items-start gap-3">
          <AlbumContextMenu albumIndex={albumIndex} artist={album.artist} album={album.name}>
            <div className="bar-sleeve h-[88px] w-[88px] shrink-0 !transform-none">
              {album.coverUrl ? (
                <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${album.coverUrl})` }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Music className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>
          </AlbumContextMenu>
          <div className="min-w-0 flex-1">
            <h3 className="bar-serif truncate text-[15px] font-semibold leading-tight">{album.name}</h3>
            <button
              className="mt-0.5 block max-w-full truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onOpenArtist(album.artist)}
            >
              {album.artist}
            </button>
            <p className="bar-etch mt-1.5">{album.songs.length} tracks</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={() => playAlbum(albumIndex)}>
                <Play className="mr-1 h-3 w-3" />Play
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={startRadio}
                title="Mix this record with closely tagged records"
              >
                <Radio className="mr-1 h-3 w-3" />Radio
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close album">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <AlbumTrackList albumIdx={albumIndex} />
      </div>
    </div>
  );
}

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const { albums, queue, queueIndex, shuffleMode, isPlaying, playFromQueue } = useAudio();

  const windowSize = 30;
  const start = Math.max(0, queueIndex - 3);
  const end = Math.min(queue.length, start + windowSize);
  const visible = queue.slice(start, end);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="bar-etch">{shuffleMode ? 'Shuffle' : 'Queue'}</h2>
        <div className="flex items-center gap-1.5">
          <span className="bar-readout text-[10px] text-muted-foreground">{queue.length === 0 ? '0/0' : `${queueIndex + 1}/${queue.length}`}</span>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6" aria-label="Hide queue">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing queued. Put a record on, or hit shuffle.</p>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {start > 0 && <p className="py-1 text-center text-[10px] text-muted-foreground">{start} previous</p>}
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
                    className={`flex cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-1.5 transition-all ${
                      isCurrent ? 'bg-primary/12 text-primary'
                        : isPast ? 'opacity-35 hover:bg-muted/60 hover:opacity-70'
                        : 'hover:bg-muted/60'
                    }`}
                    onClick={() => playFromQueue(idx)}
                  >
                    <span className="bar-readout w-5 shrink-0 text-right text-[10px] text-muted-foreground">{idx + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{cleanSongDisplay(song, alb.artist, alb.name)}</span>
                      <span className={`block truncate text-[10px] ${isCurrent ? 'text-primary/60' : 'text-muted-foreground'}`}>{alb.artist}</span>
                    </span>
                    {isCurrent && isPlaying && <EqBars className="shrink-0" />}
                  </div>
                </SongContextMenu>
              );
            })}
            {end < queue.length && <p className="py-1 text-center text-[10px] text-muted-foreground">{queue.length - end} more</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Docked columns on lg+, a slide-over sheet below. `detailOpen` wins
    the sheet when both are open. */
export function SidePanel({ detailIndex, queueOpen, onCloseDetail, onCloseQueue, onOpenArtist, onOpenQueue }: {
  detailIndex: number | null;
  queueOpen: boolean;
  onCloseDetail: () => void;
  onCloseQueue: () => void;
  onOpenArtist: (artist: string) => void;
  onOpenQueue: () => void;
}) {
  const detailOpen = detailIndex !== null;
  const anyOpen = detailOpen || queueOpen;

  const detail: ReactNode = detailOpen && (
    <AlbumDetail
      albumIndex={detailIndex}
      onClose={onCloseDetail}
      onOpenArtist={onOpenArtist}
      onOpenQueue={onOpenQueue}
    />
  );
  const queuePanel: ReactNode = queueOpen && <QueuePanel onClose={onCloseQueue} />;

  return (
    <>
      {/* Desktop: docked columns. The dock claims its width INSTANTLY —
          the wall's sleeves carry `layout`, so they glide to their new
          shelves in the same commit while the columns slide in over the
          space. Animating the width instead would reflow the grid in
          discrete snaps mid-spring, with no commit for FLIP to catch. */}
      <AnimatePresence mode="popLayout">
        {anyOpen && (
          <motion.div
            key="dock"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="relative hidden shrink-0 overflow-hidden lg:flex"
          >
            {/* popLayout: a closing column is popped from the flow so its
                sibling and the wall glide at the same moment it slides
                away. Each column carries its own left border so the seam
                travels with it. */}
            <AnimatePresence initial={false} mode="popLayout">
              {detailOpen && (
                <motion.div
                  key="detail"
                  layout
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -24, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                  className="flex min-h-0 w-[308px] shrink-0 border-l border-border"
                >
                  {detail}
                </motion.div>
              )}
              {queueOpen && (
                <motion.div
                  key="queue"
                  layout
                  initial={{ x: 64, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 64, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                  className="flex min-h-0 w-[300px] shrink-0 border-l border-border"
                >
                  {queuePanel}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile / tablet: slide-over sheet */}
      <AnimatePresence>
        {anyOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="absolute inset-y-0 right-0 z-20 flex w-[min(88vw,340px)] flex-col border-l border-border bg-card shadow-[-12px_0_32px_hsl(20_50%_2%/0.5)] lg:hidden"
          >
            {detailOpen ? detail : queuePanel}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
