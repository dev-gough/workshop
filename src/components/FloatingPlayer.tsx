'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Music, ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAudio } from './AudioProvider';
import { cleanSongDisplay } from '@/lib/songUtils';

const POSITION_KEY = 'floating-player-position';

function getSavedPosition(): { x: number; y: number } | null {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export default function FloatingPlayer() {
  const pathname = usePathname();
  const {
    currentTrack, currentAlbum, currentSongName,
    isPlaying, progress, duration,
    volume, muted,
    playNext, playPrev, togglePlayPause, toggleMute,
    formatTime,
  } = useAudio();

  const [dismissed, setDismissed] = useState(false);
  const prevPathname = useRef(pathname);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  // Load saved position on mount
  useEffect(() => {
    const saved = getSavedPosition();
    if (saved) {
      // Clamp to current viewport so it's never offscreen
      const x = Math.min(Math.max(saved.x, -window.innerWidth + 100), window.innerWidth - 100);
      const y = Math.min(Math.max(saved.y, -window.innerHeight + 100), window.innerHeight - 100);
      setPosition({ x, y });
    } else {
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  // Reset dismissed state when leaving barfoo (so the player reappears on other pages)
  useEffect(() => {
    if (prevPathname.current === '/projects/barfoo' && pathname !== '/projects/barfoo') {
      setDismissed(false);
    }
    prevPathname.current = pathname;
  }, [pathname]);

  // Hide on barfoo page (full player is there), when nothing is playing, or when dismissed
  if (pathname === '/projects/barfoo' || !currentTrack || dismissed || position === null) return null;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const displayName = currentSongName ? cleanSongDisplay(currentSongName, currentAlbum?.artist, currentAlbum?.name) : '';
  const progressPct = duration ? (progress / duration) * 100 : 0;

  return (
    <>
      {/* Full-viewport drag constraints */}
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />
      <AnimatePresence>
        <motion.div
          drag
          dragConstraints={constraintsRef}
          dragElastic={0.05}
          dragMomentum={false}
          onDragStart={() => { isDragging.current = true; }}
          onDragEnd={(_, info) => {
            // Save new position (offset from default bottom-right)
            const newPos = { x: position.x + info.offset.x, y: position.y + info.offset.y };
            setPosition(newPos);
            localStorage.setItem(POSITION_KEY, JSON.stringify(newPos));
            // Delay resetting so click handlers can check isDragging
            requestAnimationFrame(() => { isDragging.current = false; });
          }}
          initial={{ y: 100, opacity: 0, x: position.x }}
          animate={{ y: position.y, opacity: 1, x: position.x }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{ cursor: 'grab' }}
          whileDrag={{ cursor: 'grabbing', scale: 1.02 }}
          className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden select-none"
        >
        {/* Progress bar */}
        <div className="h-0.5 w-full bg-muted/40">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="p-3">
          {/* Top row: track info + close */}
          <div className="flex items-center gap-2.5 mb-2.5">
            {currentAlbum?.coverImage ? (
              <div
                className="w-10 h-10 rounded-lg bg-cover bg-center shadow-md shrink-0"
                style={{ backgroundImage: `url(${currentAlbum.coverImage})` }}
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Music className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{displayName}</p>
              <p className="text-[11px] text-muted-foreground truncate">{currentAlbum?.artist}</p>
            </div>
            <button onPointerUp={() => { if (isDragging.current) return; if (isPlaying) togglePlayPause(); setDismissed(true); }} className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button onPointerUp={() => { if (!isDragging.current) playPrev(); }} className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
                <SkipBack className="h-3.5 w-3.5" />
              </button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onPointerUp={() => { if (!isDragging.current) togglePlayPause(); }}
                className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
              </motion.button>
              <button onPointerUp={() => { if (!isDragging.current) playNext(); }} className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>

            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatTime(progress)} / {formatTime(duration)}
            </span>

            <div className="flex items-center gap-1">
              <button onPointerUp={() => { if (!isDragging.current) toggleMute(); }} className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
                <VolumeIcon className="h-3.5 w-3.5" />
              </button>
              <Link
                href="/projects/barfoo"
                className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                title="Open BarFoo"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
