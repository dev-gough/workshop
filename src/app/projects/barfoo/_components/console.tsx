'use client';

// The amplifier console — the bar's now-playing footer. Cover art spins
// on the platter, the VU meter runs off the real Web Audio analyser,
// and the transport sits between them. This is the room's one loud
// element; everything above it stays quiet.

import { useEffect, useRef } from 'react';
import { ListMusic, Music, Pause, Play, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/components/AudioProvider';
import { cleanSongDisplay } from '@/lib/songUtils';
import { SongContextMenu } from './shared';

const VU_COLS = 14;
const VU_SEGS = 9;

/** Segmented LED level meter fed by the analyser. Idles dark when the
    amp is quiet; respects reduced-motion by staying static. */
function VuMeter() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { isPlaying, getFrequencyData } = useAudio();
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(canvas);
    const lamp = styles.getPropertyValue('--bar-lamp').trim() || '#eeaa33';
    const red = styles.getPropertyValue('--bar-red').trim() || '#d9534f';
    const off = 'hsl(26 12% 14%)';

    const cssW = 84, cssH = 30;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    const colW = cssW / VU_COLS;
    const segH = cssH / VU_SEGS;
    const levels = new Array(VU_COLS).fill(0);
    const peaks = new Array(VU_COLS).fill(0);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      for (let c = 0; c < VU_COLS; c++) {
        const lit = Math.round(levels[c] * VU_SEGS);
        const peakSeg = Math.round(peaks[c] * VU_SEGS);
        for (let s = 0; s < VU_SEGS; s++) {
          const isLit = s < lit;
          const isPeak = s === peakSeg - 1 && peakSeg > lit;
          const hot = s >= VU_SEGS - 2; // the red zone
          ctx.fillStyle = isLit || isPeak ? (hot ? red : lamp) : off;
          ctx.globalAlpha = isPeak && !isLit ? 0.85 : isLit ? 1 : 0.55;
          const y = cssH - (s + 1) * segH;
          ctx.fillRect(c * colW + 0.5, y + 0.5, colW - 1.5, segH - 1.5);
        }
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    const tick = () => {
      const data = isPlayingRef.current ? getFrequencyData() : null;
      if (data) {
        // Log-spaced buckets so the columns follow how the music sounds,
        // not how FFT bins are numbered (most energy lives down low).
        const usable = Math.floor(data.length * 0.72);
        for (let c = 0; c < VU_COLS; c++) {
          const lo = Math.floor(Math.pow(usable, c / VU_COLS));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(usable, (c + 1) / VU_COLS)));
          let sum = 0;
          for (let i = lo; i < hi; i++) sum += data[i];
          const v = sum / (hi - lo) / 255;
          levels[c] = Math.max(v, levels[c] * 0.82);            // fast up, eased fall
          peaks[c] = Math.max(v, peaks[c] - 0.012);             // peak-hold, slow drop
        }
      } else {
        for (let c = 0; c < VU_COLS; c++) {
          levels[c] *= 0.88;
          peaks[c] = Math.max(0, peaks[c] - 0.02);
        }
      }
      draw();
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [getFrequencyData]);

  return <canvas ref={canvasRef} style={{ width: 84, height: 30 }} aria-hidden />;
}

export function NowPlayingConsole({ queueOpen, onToggleQueue, onShuffle, onOpenAlbum, onOpenArtist }: {
  queueOpen: boolean;
  onToggleQueue: () => void;
  /** Shuffle the whole library (page wrapper also opens the queue). */
  onShuffle: () => void;
  onOpenAlbum: (albumIndex: number) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const {
    currentTrack, currentAlbum, currentSongName, isPlaying,
    progress, duration, volume, muted, shuffleMode,
    playNext, playPrev, togglePlayPause,
    seek, changeVolume, handleVolumeWheel, toggleMute, formatTime,
  } = useAudio();

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const title = currentSongName ? cleanSongDisplay(currentSongName, currentAlbum?.artist, currentAlbum?.name) : '';

  const record = (
    <div
      className="relative h-12 w-12 shrink-0 cursor-pointer"
      onClick={() => currentTrack && onOpenAlbum(currentTrack.albumIndex)}
      title={currentAlbum ? `${currentAlbum.name} — open album` : undefined}
    >
      <div
        className="bar-record h-12 w-12 bg-cover bg-center shadow-[0_0_0_3px_#141010,0_0_0_4px_var(--bar-line),0_4px_10px_hsl(20_50%_2%/0.6)]"
        data-spinning={isPlaying}
        style={currentAlbum?.coverUrl ? { backgroundImage: `url(${currentAlbum.coverUrl})` } : undefined}
      >
        {!currentAlbum?.coverUrl && (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-muted">
            <Music className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </div>
      {/* spindle */}
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#141010] shadow-[inset_0_0_0_1px_var(--bar-line)]" />
    </div>
  );

  return (
    <motion.div
      initial={{ y: 84, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 84, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="relative z-30 shrink-0 border-t border-border bg-card/95 backdrop-blur-xl"
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
        {/* The platter + what's on it */}
        <div className="flex min-w-0 flex-1 items-center gap-3 md:w-64 md:flex-none">
          {currentAlbum && currentSongName ? (
            <SongContextMenu artist={currentAlbum.artist} album={currentAlbum.name} song={currentSongName}>
              {record}
            </SongContextMenu>
          ) : record}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <button
              className="block max-w-full truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => currentAlbum && onOpenArtist(currentAlbum.artist)}
            >
              {currentAlbum?.artist}
            </button>
          </div>
        </div>

        {/* Transport — scroll here to nudge volume */}
        <div className="flex shrink-0 items-center gap-1.5" onWheel={handleVolumeWheel}>
          <Button variant="ghost" size="icon" onClick={playPrev} className="h-8 w-8" aria-label="Previous track">
            <SkipBack className="h-4 w-4" />
          </Button>
          <motion.div whileTap={{ scale: 0.92 }}>
            <Button size="icon" onClick={togglePlayPause} className="h-9 w-9 rounded-full" aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </Button>
          </motion.div>
          <Button variant="ghost" size="icon" onClick={playNext} className="h-8 w-8" aria-label="Next track">
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Tape counter + seek */}
        <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
          <span className="bar-readout w-10 shrink-0 text-right text-[11px] text-muted-foreground">{formatTime(progress)}</span>
          <div className="group h-4 flex-1 cursor-pointer" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={Math.floor(progress)}>
            <div className="relative top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted">
              <div
                className="relative h-full rounded-full bg-primary shadow-[0_0_6px_color-mix(in_srgb,var(--bar-lamp)_50%,transparent)]"
                style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }}
              >
                <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </div>
          </div>
          <span className="bar-readout w-10 shrink-0 text-[11px] text-muted-foreground">{formatTime(duration)}</span>
        </div>

        {/* VU meter — the amp's face */}
        <div className="hidden shrink-0 lg:block" title="Level meter">
          <VuMeter />
        </div>

        {/* Volume */}
        <div className="hidden w-28 shrink-0 items-center gap-1.5 md:flex" onWheel={handleVolumeWheel}>
          <Button variant="ghost" size="icon" onClick={toggleMute} className="h-7 w-7 shrink-0" aria-label={muted ? 'Unmute' : 'Mute'}>
            <VolumeIcon className="h-4 w-4" />
          </Button>
          <input
            type="range" min={0} max={1} step={0.01}
            value={muted ? 0 : volume}
            onChange={changeVolume}
            className="bar-fader w-full"
            aria-label="Volume"
          />
        </div>

        {/* Shuffle + queue */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost" size="icon" onClick={onShuffle}
            className={`h-8 w-8 ${shuffleMode ? 'text-primary' : ''}`}
            aria-label="Shuffle everything"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" onClick={onToggleQueue}
            className={`h-8 w-8 ${queueOpen ? 'text-primary' : ''}`}
            aria-label={queueOpen ? 'Hide queue' : 'Show queue'}
          >
            <ListMusic className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mobile seek strip — the desktop counter row is hidden there */}
      <div className="h-1 w-full cursor-pointer sm:hidden" onClick={seek}>
        <div className="h-full bg-muted">
          <div className="h-full bg-primary" style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }} />
        </div>
      </div>
    </motion.div>
  );
}
