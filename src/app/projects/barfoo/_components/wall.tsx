'use client';

// The record wall — every sleeve in the library, shelved edge to edge.
// The size fader in the toolbar drives `sizePx`; the grid re-shelves
// itself via auto-fill. Captions sit under the art (the sleeves stay
// clean) and step out of the way below ~112px, where the wall becomes
// pure cover art.

import { useRef } from 'react';
import { Music } from 'lucide-react';
import { motion } from 'motion/react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAudio } from '@/components/AudioProvider';
import { AlbumContextMenu, EqBars } from './shared';

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function AlbumWall({ sizePx, selected, onSelect, loading }: {
  sizePx: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  loading: boolean;
}) {
  const { albums, currentTrack, isPlaying, playAlbum } = useAudio();
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captions = sizePx >= 112;
  const gridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${sizePx}px, 1fr))`,
    gap: sizePx < 120 ? '0.5rem' : '0.75rem',
  };

  if (loading) {
    return (
      <div className="grid p-4 sm:p-5" style={gridStyle}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="aspect-square rounded-[3px]" />
            {captions && <Skeleton className="mt-1.5 h-3 w-3/4 rounded-sm" />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid p-4 sm:p-5" style={gridStyle}>
      {albums.map((album, index) => {
        const isSelected = selected === index;
        const isCurrent = currentTrack?.albumIndex === index;
        const isNew = album.source === 'soulseek' && album.addedAt &&
          Date.now() - new Date(album.addedAt).getTime() < NEW_WINDOW_MS;
        return (
          <AlbumContextMenu key={index} albumIndex={index} artist={album.artist} album={album.name}>
          <motion.button
            type="button"
            // FLIP: any reflow — the size fader, the side panel claiming
            // width, captions appearing — glides instead of snapping.
            layout
            transition={{ layout: { type: 'spring', stiffness: 420, damping: 38 } }}
            data-album-index={index}
            whileTap={{ scale: 0.97 }}
            className="group block text-left focus-visible:outline-none"
            title={captions ? undefined : `${album.name} — ${album.artist}`}
            onClick={() => {
              if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
              // 200ms: long enough to catch a double-click, short enough
              // that the open doesn't read as lag before the glide.
              clickTimerRef.current = setTimeout(() => onSelect(isSelected ? null : index), 200);
            }}
            onDoubleClick={() => {
              if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
              playAlbum(index);
            }}
          >
            <div
              className="bar-sleeve relative aspect-square group-focus-visible:ring-2 group-focus-visible:ring-ring"
              data-selected={isSelected}
            >
              {album.coverUrl ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${album.coverUrl})` }} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-card p-2">
                  <Music className="h-6 w-6 text-muted-foreground" />
                  {!captions && (
                    <span className="max-w-full truncate text-[10px] text-muted-foreground">{album.name}</span>
                  )}
                </div>
              )}
              {isCurrent && (
                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[3px] bg-background/85 backdrop-blur-sm">
                  {isPlaying ? <EqBars /> : <span className="bar-lamp-dot text-primary" />}
                </span>
              )}
              {!isCurrent && isNew && (
                <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-background/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary backdrop-blur-sm">
                  New
                </span>
              )}
            </div>
            {captions && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="mt-1.5 min-w-0 px-0.5"
              >
                <p className={`truncate text-xs font-medium leading-tight ${isCurrent ? 'text-primary' : ''}`}>{album.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{album.artist}</p>
              </motion.div>
            )}
          </motion.button>
          </AlbumContextMenu>
        );
      })}
    </div>
  );
}
