'use client';

import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/components/AudioProvider';
import { cleanSongDisplay } from '@/lib/songUtils';
import {
  ResonanceBackground,
} from '../../polar-clock/_components/Fractal';
import {
  RibbonBackground,
  TerrainBackground,
  TunnelBackground,
} from '../../polar-clock/_components/AudioBackgrounds';
import {
  ChladniDust,
  LacquerBloom,
  NeedleGarden,
  SleeveEcho,
} from './visualizers/sol-visualizers';
import {
  DEFAULT_VISUALIZER,
  VISUALIZERS,
  isVisualizerId,
  visualizerById,
  type VisualizerId,
} from './visualizers/catalog';

const STORAGE_KEY = 'barfoo_visualizer';
const IDLE_MS = 4200;

function VisualizerSurface({ id, width, height }: { id: VisualizerId; width: number; height: number }) {
  const props = { width, height };
  switch (id) {
    case 'lacquer': return <LacquerBloom {...props} />;
    case 'garden': return <NeedleGarden {...props} />;
    case 'chladni': return <ChladniDust {...props} />;
    case 'sleeve': return <SleeveEcho {...props} />;
    case 'terrain': return <TerrainBackground {...props} />;
    case 'tunnel': return <TunnelBackground {...props} />;
    case 'ribbon': return <RibbonBackground {...props} />;
    case 'resonance': return <ResonanceBackground {...props} />;
  }
}

export function VisualizerStage({
  open,
  onClose,
  stageRef,
}: {
  open: boolean;
  onClose: () => void;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    currentAlbum,
    currentSongName,
    isPlaying,
    progress,
    duration,
    muted,
    playPrev,
    playNext,
    togglePlayPause,
    seekTo,
    toggleMute,
    formatTime,
  } = useAudio();
  const [selected, setSelected] = useState<VisualizerId>(() => {
    if (typeof window === 'undefined') return DEFAULT_VISUALIZER;
    const saved = localStorage.getItem(STORAGE_KEY);
    return isVisualizerId(saved) ? saved : DEFAULT_VISUALIZER;
  });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, selected); } catch { /* unavailable */ }
  }, [selected]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageRef]);

  useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === stageRef.current;
      setFullscreen(active);
      if (open && !document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, [onClose, open, stageRef]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stageRef.current?.requestFullscreen();
  }, [stageRef]);

  const closeStage = useCallback(async () => {
    if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
    else onClose();
  }, [onClose, stageRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        void closeStage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeStage, open, toggleFullscreen]);

  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [open]);

  const title = currentSongName
    ? cleanSongDisplay(currentSongName, currentAlbum?.artist, currentAlbum?.name)
    : 'No track loaded';
  const definition = visualizerById(selected);
  const chromeVisible = !idle;
  const surface = useMemo(
    () => <VisualizerSurface id={selected} width={size.width} height={size.height} />,
    [selected, size.height, size.width],
  );

  return (
    <div
      ref={stageRef}
      className={`bar-theme ${open ? 'fixed inset-0 z-[80] overflow-hidden' : 'hidden'}`}
      role="dialog"
      aria-modal={open || undefined}
      aria-label="BarFoo visualizer lounge"
    >
      {open && (
        <>
          <div className="absolute inset-0 bg-[#050305]">{surface}</div>
          <div className="bar-viz-vignette pointer-events-none absolute inset-0" />

          <AnimatePresence>
            {!isPlaying && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              >
                <div className="bar-viz-glass px-4 py-3 text-center">
                  <p className="bar-etch">The room is listening</p>
                  <p className="mt-1 text-xs text-muted-foreground">Press play to wake the analyser.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            animate={{ opacity: chromeVisible ? 1 : 0, y: chromeVisible ? 0 : -8 }}
            transition={{ duration: 0.35 }}
            className={`absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-5 ${
              chromeVisible ? '' : 'pointer-events-none'
            }`}
          >
            <div className="bar-viz-glass min-w-0 max-w-[70vw] px-3 py-2.5">
              <p className="bar-etch">RM 02 · Visualizer lounge</p>
              <p className="bar-serif mt-1 truncate text-lg font-semibold">{definition.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {title}{currentAlbum ? ` · ${currentAlbum.artist}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="bar-etch hidden sm:block">F · fullscreen</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void toggleFullscreen()}
                className="bar-viz-glass h-10 w-10 rounded-full"
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void closeStage()}
                className="bar-viz-glass h-10 w-10 rounded-full"
                aria-label="Close visualizer lounge"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>

          <motion.div
            animate={{ opacity: chromeVisible ? 1 : 0, y: chromeVisible ? 0 : 12 }}
            transition={{ duration: 0.35 }}
            className={`absolute inset-x-0 bottom-0 z-20 p-3 sm:p-5 ${chromeVisible ? '' : 'pointer-events-none'}`}
          >
            <div className="bar-viz-glass mx-auto max-w-6xl overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={playPrev} className="h-8 w-8" aria-label="Previous track">
                    <SkipBack className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" onClick={togglePlayPause} className="h-9 w-9 rounded-full" aria-label={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={playNext} className="h-8 w-8" aria-label="Next track">
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <span className="bar-readout hidden w-10 text-right text-[10px] text-muted-foreground sm:block">
                  {formatTime(progress)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(progress, duration || 0)}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  className="bar-fader min-w-0 flex-1"
                  aria-label="Seek"
                />
                <span className="bar-readout hidden w-10 text-[10px] text-muted-foreground sm:block">
                  {formatTime(duration)}
                </span>
                <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8" aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </Button>
              </div>

              <div className="bar-viz-picker flex gap-2 overflow-x-auto p-2.5" role="listbox" aria-label="Visualizer backgrounds">
                {VISUALIZERS.map((visualizer) => {
                  const own = visualizer.origin === 'barfoo';
                  const active = visualizer.id === selected;
                  const style = { '--viz-accent': visualizer.accent } as CSSProperties;
                  return (
                    <button
                      key={visualizer.id}
                      role="option"
                      aria-selected={active}
                      data-origin={visualizer.origin}
                      data-active={active}
                      style={style}
                      className="bar-viz-card group relative min-h-[62px] w-40 shrink-0 overflow-hidden px-3 py-2 text-left"
                      onClick={() => setSelected(visualizer.id)}
                    >
                      <span className="flex items-center gap-1.5">
                        {own && <Sparkles className="h-3 w-3 shrink-0 text-[var(--viz-accent)]" />}
                        <span className="truncate text-xs font-semibold">{visualizer.label}</span>
                      </span>
                      <span className="bar-etch mt-1 block text-[8px]">
                        {own ? 'BARFOO · ORIGINAL' : 'POLAR CLOCK'}
                      </span>
                      <span className="bar-viz-card-info pointer-events-none absolute inset-0 flex translate-y-2 flex-col justify-end px-3 py-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                        <strong className="text-[10px]" style={{ color: visualizer.accent }}>{visualizer.author}</strong>
                        <span className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-muted-foreground">{visualizer.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
