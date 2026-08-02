'use client';

// The bar's takeaway player — BarFoo's amplifier console in miniature,
// carried into the hallway. It wears the bar's own scope (`bar-pop`)
// whatever room it floats over: deliberately dark-always, like the room
// it came from.

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Music, X } from 'lucide-react';
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
  const router = useRouter();
  const {
    currentTrack, currentAlbum, currentSongName,
    isPlaying, progress, duration,
    volume, muted,
    playNext, playPrev, togglePlayPause, toggleMute,
    seekTo, setVolumeValue,
    formatTime,
  } = useAudio();

  const [dismissed, setDismissed] = useState(false);
  const prevPathname = useRef(pathname);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volumeDirection, setVolumeDirection] = useState<'up' | 'down'>('up');
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  useEffect(() => {
    const saved = getSavedPosition();
    if (saved) {
      const x = Math.min(Math.max(saved.x, -window.innerWidth + 100), window.innerWidth - 100);
      const y = Math.min(Math.max(saved.y, -window.innerHeight + 100), window.innerHeight - 100);
      setPosition({ x, y });
    } else {
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  useEffect(() => {
    if (prevPathname.current === '/projects/barfoo' && pathname !== '/projects/barfoo') {
      setDismissed(false);
    }
    prevPathname.current = pathname;
  }, [pathname]);

  // Volume hover: small grace timer so the cursor can travel between
  // the button and the popup without immediately closing.
  const volumeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelVolumeClose = () => {
    if (volumeCloseTimer.current) {
      clearTimeout(volumeCloseTimer.current);
      volumeCloseTimer.current = null;
    }
  };
  const scheduleVolumeClose = () => {
    cancelVolumeClose();
    volumeCloseTimer.current = setTimeout(() => setVolumeOpen(false), 180);
  };
  useEffect(() => () => cancelVolumeClose(), []);

  useEffect(() => { setVolumeOpen(false); }, [pathname]);

  if (pathname === '/projects/barfoo' || !currentTrack || dismissed || position === null) return null;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const displayName = currentSongName ? cleanSongDisplay(currentSongName, currentAlbum?.artist, currentAlbum?.name) : '';
  const sliderValue = seeking ? seekValue : progress;
  const seekPct = duration ? (sliderValue / duration) * 100 : 0;
  const volPct = (muted ? 0 : volume) * 100;

  const navigate = (params: Record<string, string>) => {
    if (isDragging.current) return;
    const qs = new URLSearchParams(params).toString();
    router.push(`/projects/barfoo?${qs}`);
  };

  const openVolumePopup = () => {
    if (isDragging.current) return;
    cancelVolumeClose();
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Top of viewport → open downward; otherwise upward
      setVolumeDirection(rect.top < window.innerHeight / 2 ? 'down' : 'up');
    }
    setVolumeOpen(true);
  };

  const commitSeek = () => {
    if (!seeking) return;
    seekTo(seekValue);
    setSeeking(false);
  };

  return (
    <>
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />
      <AnimatePresence>
        <motion.div
          ref={containerRef}
          drag
          dragConstraints={constraintsRef}
          dragElastic={0.05}
          dragMomentum={false}
          onDragStart={() => { isDragging.current = true; }}
          onDragEnd={(_, info) => {
            const newPos = { x: position.x + info.offset.x, y: position.y + info.offset.y };
            setPosition(newPos);
            localStorage.setItem(POSITION_KEY, JSON.stringify(newPos));
            requestAnimationFrame(() => { isDragging.current = false; });
          }}
          initial={{ y: 100, opacity: 0, x: position.x }}
          animate={{ y: position.y, opacity: 1, x: position.x }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{ cursor: 'grab' }}
          whileDrag={{ cursor: 'grabbing', scale: 1.02 }}
          className="bar-pop bar-panel fixed bottom-4 right-4 z-50 w-80 backdrop-blur-xl overflow-visible select-none"
        >
          <div className="p-3">
            {/* Top row: track info + close */}
            <div className="flex items-center gap-2.5 mb-2.5">
              {/* The record on the platter — spins while it plays */}
              <button
                type="button"
                onPointerUp={() => currentAlbum && navigate({ artist: currentAlbum.artist, album: currentAlbum.name })}
                className="relative h-10 w-10 shrink-0 cursor-pointer"
                title="Open album in BarFoo"
                aria-label="Open album"
              >
                <span
                  className="bar-record block h-10 w-10 bg-cover bg-center shadow-[0_0_0_2px_#141010,0_0_0_3px_var(--bar-line),0_3px_8px_hsl(20_50%_2%/0.6)]"
                  data-spinning={isPlaying}
                  style={currentAlbum?.coverUrl ? { backgroundImage: `url(${currentAlbum.coverUrl})` } : undefined}
                >
                  {!currentAlbum?.coverUrl && (
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-muted">
                      <Music className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                </span>
                {/* spindle */}
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#141010] shadow-[inset_0_0_0_1px_var(--bar-line)]" />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onPointerUp={() => currentAlbum && navigate({ artist: currentAlbum.artist, album: currentAlbum.name })}
                  className="block w-full text-left text-sm font-medium truncate hover:text-primary transition-colors"
                  title="Open album in BarFoo"
                >
                  {displayName}
                </button>
                <button
                  type="button"
                  onPointerUp={() => currentAlbum && navigate({ artist: currentAlbum.artist })}
                  className="block w-full text-left text-[11px] text-muted-foreground truncate hover:text-foreground transition-colors"
                  title="Open artist in BarFoo"
                >
                  {currentAlbum?.artist}
                </button>
              </div>
              <button
                onPointerUp={() => { if (isDragging.current) return; if (isPlaying) togglePlayPause(); setDismissed(true); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Combined controls + seek row */}
            <div
              className="flex items-center gap-1.5"
              onPointerDown={e => e.stopPropagation()}
            >
              <button
                onPointerUp={() => { if (!isDragging.current) playPrev(); }}
                className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Previous"
              >
                <SkipBack className="h-3 w-3" fill="currentColor" />
              </button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onPointerUp={() => { if (!isDragging.current) togglePlayPause(); }}
                className="h-7 w-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 shadow-sm"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="h-3 w-3" fill="currentColor" /> : <Play className="h-3 w-3 ml-0.5" fill="currentColor" />}
              </motion.button>
              <button
                onPointerUp={() => { if (!isDragging.current) playNext(); }}
                className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Next"
              >
                <SkipForward className="h-3 w-3" fill="currentColor" />
              </button>

              <span className="bar-readout text-[10px] text-muted-foreground/80 shrink-0 ml-1 select-none">{formatTime(sliderValue)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.001)}
                step={0.1}
                value={sliderValue}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setSeekValue(v);
                  if (!seeking) seekTo(v);
                }}
                onPointerDown={() => { setSeeking(true); setSeekValue(progress); }}
                onPointerUp={commitSeek}
                onPointerCancel={commitSeek}
                onBlur={commitSeek}
                className="flex-1 min-w-0 fp-slider"
                style={{ ['--fp-pct']: `${seekPct}%` } as CSSProperties}
                aria-label="Seek"
              />
              <span className="bar-readout text-[10px] text-muted-foreground/80 shrink-0 select-none">{formatTime(duration)}</span>

              <div
                className="relative flex items-center shrink-0"
                onMouseEnter={openVolumePopup}
                onMouseLeave={scheduleVolumeClose}
              >
                <button
                  onContextMenu={e => { e.preventDefault(); toggleMute(); }}
                  className="p-1 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                  title="Volume (right-click to mute)"
                  aria-label="Volume"
                >
                  <VolumeIcon className="h-3.5 w-3.5" />
                </button>
                <AnimatePresence>
                  {volumeOpen && (
                    <motion.div
                      key="volpop"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.12 }}
                      onMouseEnter={cancelVolumeClose}
                      onMouseLeave={scheduleVolumeClose}
                      onPointerDown={e => e.stopPropagation()}
                      onWheel={e => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.05 : 0.05; setVolumeValue((muted ? 0 : volume) + delta); }}
                      className={`absolute right-0 z-10 ${
                        volumeDirection === 'down' ? 'top-full pt-2' : 'bottom-full pb-2'
                      }`}
                      style={{ paddingLeft: 14, paddingRight: 14 }}
                    >
                      <div
                        className="bar-panel flex flex-col items-center gap-2 backdrop-blur-xl px-2 py-3"
                        style={{ width: 36 }}
                      >
                        <span className="bar-readout text-[10px] text-muted-foreground">{Math.round(volPct)}</span>
                        <div className="flex items-center justify-center" style={{ height: 80, width: 14 }}>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={muted ? 0 : volume}
                            onChange={e => setVolumeValue(parseFloat(e.target.value))}
                            className="fp-vslider"
                            style={{ ['--fp-pct']: `${volPct}%` } as CSSProperties}
                            aria-label="Volume level"
                          />
                        </div>
                        <button
                          onPointerUp={e => { e.stopPropagation(); toggleMute(); }}
                          className="p-1 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                          title={muted ? 'Unmute' : 'Mute'}
                          aria-label={muted ? 'Unmute' : 'Mute'}
                        >
                          <VolumeIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
