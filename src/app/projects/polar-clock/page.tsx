'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Maximize, Minimize, Download, X, Volume2, BatteryLow } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useHeaderConfig } from '@/components/header-config';
import { useAudio } from '@/components/AudioProvider';
import {
  generateWallpaperHTML, generateWEProjectJson, generateLivelyProperties,
  downloadZip, type WallpaperSettings,
} from './wallpaper-export';
import {
  getCookie, setCookie, PALETTES, TIMEZONE_OPTIONS,
  BACKGROUND_GROUPS, AUDIO_BACKGROUNDS, EXPORTABLE_BACKGROUNDS, backgroundLabel,
  type RingConfig, type CitySlot, type BackgroundKey,
} from './_components/shared';
import { BackgroundStage } from './_components/BackgroundStage';
import { PolarClockSVG } from './_components/PolarClockSVG';
import { SettingsSection } from './_components/SettingsSection';
import {
  clockTickMs, shouldRunProjector, type PowerMode,
} from './_components/power';

/** Header is h-14 + a 1px border. 57, not 56 — see /workshop-ui §4. */
const HEADER_H = 57;
/** The chrome steps aside after this long without input. */
const IDLE_MS = 4500;

const KNOWN_BG = new Set<string>(['none', ...BACKGROUND_GROUPS.flatMap(g => g.items.map(i => i.key))]);

const RING_LABELS: { key: keyof RingConfig; label: string }[] = [
  { key: 'seconds', label: 'Seconds' }, { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' }, { key: 'days', label: 'Days' },
  { key: 'months', label: 'Months' }, { key: 'dayOfYear', label: 'Day of Year' },
  { key: 'weekOfYear', label: 'Week of Year' },
];

/** A control on the desk: recessed when off, lit when on. */
function Chip({ on, onClick, children, className = '' }: {
  on: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`pc-chip cursor-pointer px-2.5 py-1.5 text-xs ${on ? 'pc-chip-on' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function PolarClockPage() {
  useHeaderConfig({ scopeClass: 'pc-theme pc-header' });
  const { isPlaying, currentSongName } = useAudio();

  const [time, setTime] = useState(new Date());
  const [smooth, setSmooth] = useState(true);
  const [powerMode, setPowerMode] = useState<PowerMode>(
    () => getCookie('polarclock_power') === 'economy' ? 'economy' : 'full',
  );
  const [documentVisible, setDocumentVisible] = useState(true);
  const [palette, setPalette] = useState(() => getCookie('polarclock_palette') ?? 'default');
  const [background, setBackground] = useState<BackgroundKey>(() => {
    const v = getCookie('polarclock_bg');
    if (v === 'fractal') return 'julia';               // pre-split name
    return v && KNOWN_BG.has(v) ? (v as BackgroundKey) : 'none';
  });
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>(() => (getCookie('polarclock_align') as 'left' | 'center' | 'right') ?? 'center');
  const [showYearBar, setShowYearBar] = useState(() => getCookie('polarclock_yearbar') !== 'false');
  const [showSlots, setShowSlots] = useState(() => getCookie('polarclock_slots_vis') !== 'false');
  const [showCity, setShowCity] = useState(() => getCookie('polarclock_city') !== 'false');
  const [showDate, setShowDate] = useState(() => getCookie('polarclock_date') !== 'false');
  const [showClock, setShowClock] = useState(() => getCookie('polarclock_clock') !== 'false');
  const [juliaManual, setJuliaManual] = useState(() => getCookie('polarclock_julia_manual') === 'true');
  const [juliaCRe, setJuliaCRe] = useState(() => { const v = getCookie('polarclock_julia_re'); return v ? parseFloat(v) : -0.7; });
  const [juliaCIm, setJuliaCIm] = useState(() => { const v = getCookie('polarclock_julia_im'); return v ? parseFloat(v) : 0.27015; });
  const [juliaDragging, setJuliaDragging] = useState(false);
  const [bgOpacity, setBgOpacity] = useState(() => {
    const saved = getCookie('polarclock_bgopacity');
    return saved ? parseFloat(saved) : 1;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [rings, setRings] = useState<RingConfig>(() => {
    const saved = getCookie('polarclock_rings');
    if (saved) try { return JSON.parse(saved); } catch {}
    return { seconds: true, minutes: true, hours: true, days: true, months: true, dayOfYear: false, weekOfYear: false };
  });

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localLabel = localTz.split('/').pop()?.replace(/_/g, ' ') ?? 'Local';

  const [slots, setSlots] = useState<(CitySlot | null)[]>(() => {
    const saved = getCookie('polarclock_slots');
    if (saved) try { return JSON.parse(saved); } catch {}
    return [{ label: localLabel, timezone: localTz }, null, null, null, null];
  });
  const [activeSlot, setActiveSlot] = useState(0);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 's') setShowSettings(prev => !prev);
      if (e.key === 'Escape') { setShowSettings(false); setEditingSlot(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  // The dome is meant to be looked at. After a spell without input the
  // instrument plate steps aside and leaves the dial alone with the
  // projection; any movement brings it straight back.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach(e => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(t);
      events.forEach(e => window.removeEventListener(e, wake));
    };
  }, []);
  const chromeOpen = showSettings || editingSlot !== null;
  const chromeVisible = !idle || chromeOpen;

  // Viewport size for background and clock sizing
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Hidden tabs sleep completely. Economy mode keeps an accurate clock while
  // waking React just once per second.
  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      setDocumentVisible(visible);
      if (visible) setTime(new Date());
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const delay = clockTickMs(powerMode, smooth, documentVisible);
    if (delay === null) return;
    const interval = setInterval(() => setTime(new Date()), delay);
    return () => clearInterval(interval);
  }, [documentVisible, powerMode, smooth]);

  // Persist settings
  useEffect(() => { setCookie('polarclock_slots', JSON.stringify(slots)); }, [slots]);
  useEffect(() => { setCookie('polarclock_palette', palette); }, [palette]);
  useEffect(() => { setCookie('polarclock_bg', background); }, [background]);
  useEffect(() => { setCookie('polarclock_power', powerMode); }, [powerMode]);
  useEffect(() => { setCookie('polarclock_align', alignment); }, [alignment]);
  useEffect(() => { setCookie('polarclock_yearbar', String(showYearBar)); }, [showYearBar]);
  useEffect(() => { setCookie('polarclock_slots_vis', String(showSlots)); }, [showSlots]);
  useEffect(() => { setCookie('polarclock_city', String(showCity)); }, [showCity]);
  useEffect(() => { setCookie('polarclock_date', String(showDate)); }, [showDate]);
  useEffect(() => { setCookie('polarclock_clock', String(showClock)); }, [showClock]);
  useEffect(() => { setCookie('polarclock_julia_manual', String(juliaManual)); }, [juliaManual]);
  useEffect(() => { setCookie('polarclock_julia_re', String(juliaCRe)); }, [juliaCRe]);
  useEffect(() => { setCookie('polarclock_julia_im', String(juliaCIm)); }, [juliaCIm]);
  useEffect(() => { setCookie('polarclock_bgopacity', String(bgOpacity)); }, [bgOpacity]);
  useEffect(() => { setCookie('polarclock_rings', JSON.stringify(rings)); }, [rings]);

  const toggleRing = (key: keyof RingConfig) => setRings(prev => ({ ...prev, [key]: !prev[key] }));

  const assignSlot = (slotIdx: number, tz: typeof TIMEZONE_OPTIONS[number]) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIdx] = { label: tz.label, timezone: tz.value };
      return next;
    });
    setActiveSlot(slotIdx);
    setEditingSlot(null);
  };

  const clearSlot = (slotIdx: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
    if (activeSlot === slotIdx) setActiveSlot(0);
    setEditingSlot(null);
  };

  const currentSlot = slots[activeSlot];
  const currentTz = currentSlot?.timezone ?? localTz;
  const currentLabel = currentSlot?.label ?? localLabel;

  // Layout: the dial fills whatever the header and the rail leave behind.
  const headerH = isFullscreen ? 0 : HEADER_H;
  const domeH = viewSize.h - headerH;
  const showRail = showSlots || showYearBar;
  // Narrow screens can't fit five slot keys and the year transit side by
  // side, so the rail stacks — and the dial has to know it got taller.
  const railStacks = showSlots && showYearBar && viewSize.w > 0 && viewSize.w < 640;
  const railH = showRail ? (railStacks ? 116 : 68) : 0;
  // Capped: past ~720px the dial stops reading as an instrument and starts
  // reading as wallpaper with a hole in it.
  const clockSize = Math.max(220, Math.min(domeH - railH - 72, viewSize.w - 64, 720));

  const audioBg = AUDIO_BACKGROUNDS.has(background);
  const waitingForAudio = audioBg && !isPlaying;

  const year = time.getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const yearElapsed = time.getTime() - yearStart;
  const yearPct = (yearElapsed / (yearEnd - yearStart)) * 100;
  const dayOfYear = Math.floor(yearElapsed / 86400000) + 1;
  const daysInYear = Math.floor((yearEnd - yearStart) / 86400000);

  const wallpaperSettings = (): WallpaperSettings => ({
    palette, background, bgOpacity, smooth, alignment,
    rings, showCity, showDate,
    timezone: slots[activeSlot]?.timezone ?? 'America/New_York',
    cityLabel: slots[activeSlot]?.label ?? 'New York',
  });

  const ready = viewSize.w > 0;
  const projectorRunning = ready && shouldRunProjector(background, powerMode, documentVisible);

  return (
    <div
      ref={containerRef}
      className="pc-theme relative overflow-hidden"
      style={{ height: isFullscreen ? '100vh' : `calc(100vh - ${HEADER_H}px)` }}
    >
      {/* ── The projector ── */}
      <div className="absolute inset-0 z-0" style={{ opacity: bgOpacity }}>
        {projectorRunning && (
          <BackgroundStage
            background={background}
            width={viewSize.w}
            height={domeH}
            juliaManual={juliaManual}
            juliaCRe={juliaCRe}
            juliaCIm={juliaCIm}
            juliaDragging={juliaDragging}
          />
        )}
      </div>

      {/* The dome falls off toward the rim, so the dial reads over anything. */}
      <div className="pc-vignette pointer-events-none absolute inset-0 z-[1]" />

      {/* ── The dial ── */}
      {showClock && (
        <div
          className={`absolute inset-0 z-10 flex items-center ${
            alignment === 'left' ? 'justify-start pl-8' : alignment === 'right' ? 'justify-end pr-8' : 'justify-center'
          }`}
          style={{ bottom: railH }}
        >
          {clockSize > 0 && (
            <PolarClockSVG
              timezone={currentTz}
              label={currentLabel}
              time={time}
              palette={palette}
              smooth={smooth && powerMode === 'full'}
              rings={rings}
              size={clockSize}
              showCity={showCity}
              showDate={showDate}
            />
          )}
        </div>
      )}

      {/* ── Instrument plate — everything that isn't the dial ── */}
      <motion.div
        animate={{ opacity: chromeVisible ? 1 : 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`absolute inset-0 z-20 ${chromeVisible ? '' : 'pointer-events-none'}`}
      >
        {/* Nameplate */}
        <div className="pc-glass pointer-events-auto absolute left-4 top-4 px-3 py-2">
          <p className="pc-etch">RM 05 · Observatory</p>
          <p className="mt-1 text-[11px] text-foreground">
            {powerMode === 'economy' && background !== 'none'
              ? `${backgroundLabel(background)} · parked`
              : background === 'none' ? 'Dome dark' : backgroundLabel(background)}
          </p>
          {powerMode === 'economy' && (
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--pc-verd)]">
              <BatteryLow className="h-3 w-3" />
              Economy power
            </p>
          )}
          {audioBg && (
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Volume2 className="h-3 w-3 shrink-0" style={{ color: waitingForAudio ? undefined : 'var(--pc-verd)' }} />
              <span className="max-w-[168px] truncate">
                {waitingForAudio ? 'waiting for a track' : currentSongName ?? 'playing'}
              </span>
            </p>
          )}
        </div>

        {/* ── The rail: observation log on the left, the year's transit on the right ── */}
        {showRail && (
          <div className="pointer-events-auto absolute inset-x-3 bottom-3">
            <div className="pc-glass flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
              {showSlots && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {slots.map((slot, i) => (
                    <div key={i} className="relative">
                      <button
                        onClick={() => {
                          if (slot) { setActiveSlot(i); setEditingSlot(null); }
                          else setEditingSlot(editingSlot === i ? null : i);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (i > 0) setEditingSlot(editingSlot === i ? null : i);
                        }}
                        className={`pc-readout h-9 w-9 cursor-pointer rounded-md border text-xs font-semibold transition-all ${
                          activeSlot === i && slot
                            ? 'border-transparent text-[#04120f] shadow-[0_0_14px_color-mix(in_srgb,var(--pc-verd)_38%,transparent)]'
                            : slot
                            ? 'border-border text-foreground hover:border-[color-mix(in_srgb,var(--pc-verd)_45%,var(--pc-line))]'
                            : 'border-dashed border-border text-muted-foreground hover:text-foreground'
                        }`}
                        style={activeSlot === i && slot
                          ? { background: 'linear-gradient(180deg, color-mix(in srgb, var(--pc-verd) 92%, #fff), var(--pc-verd))' }
                          : { background: 'hsl(222 30% 12% / 0.6)'}
                        }
                        title={slot ? `${slot.label} — right-click to change` : 'Click to assign a city'}
                      >
                        {i + 1}
                      </button>
                      <AnimatePresence>
                        {editingSlot === i && (
                          <>
                            <motion.div
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              transition={{ duration: 0.1 }}
                              className="fixed inset-0 z-30"
                              onClick={() => setEditingSlot(null)}
                            />
                            <motion.div
                              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                              className="pc-glass absolute bottom-12 left-0 z-40 max-h-64 w-52 overflow-y-auto p-1.5"
                            >
                              {slot && i > 0 && (
                                <button
                                  onClick={() => clearSlot(i)}
                                  className="mb-1 w-full cursor-pointer rounded px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/15"
                                >
                                  Clear slot
                                </button>
                              )}
                              {TIMEZONE_OPTIONS.map(tz => (
                                <button
                                  key={tz.value}
                                  onClick={() => assignSlot(i, tz)}
                                  className={`w-full cursor-pointer rounded px-2.5 py-1.5 text-left text-xs transition-colors ${
                                    slot?.timezone === tz.value
                                      ? 'bg-primary/15 font-medium text-foreground'
                                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  }`}
                                >
                                  {tz.label}
                                </button>
                              ))}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                  <span className="pc-etch ml-2 max-w-[140px] truncate text-[9px]">{currentLabel}</span>
                </div>
              )}

              {showSlots && showYearBar && <span className="hidden h-8 w-px shrink-0 bg-border sm:block" />}

              {showYearBar && (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="pc-readout shrink-0 text-xs text-muted-foreground">{year}</span>
                  <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-[hsl(224_40%_4%)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${yearPct}%`,
                        background: `linear-gradient(90deg, ${PALETTES[palette].colors[0]}, ${PALETTES[palette].colors[1]}, ${PALETTES[palette].colors[2]})`,
                      }}
                    />
                    {/* A graduation at the head of each month. */}
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage: 'repeating-linear-gradient(90deg, rgba(207,224,255,0.28) 0 1px, transparent 1px calc(100%/12))',
                      }}
                    />
                  </div>
                  <div className="pc-readout flex shrink-0 items-center gap-3 whitespace-nowrap text-[11px] text-muted-foreground">
                    <strong className="font-semibold text-foreground">{yearPct.toFixed(1)}%</strong>
                    <span className="hidden sm:inline">day {dayOfYear}</span>
                    <span className="hidden md:inline">{daysInYear - dayOfYear} left</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Instruments. Deliberately a sibling of the plate rather than a child
          of it: they need to sit ABOVE the desk's backdrop so they stay
          usable while it's open, and they slide aside to clear the drawer
          instead of hiding underneath it. */}
      <motion.div
        animate={{ opacity: chromeVisible ? 1 : 0, x: showSettings ? -344 : 0 }}
        transition={{ opacity: { duration: 0.5, ease: 'easeOut' }, x: { type: 'spring', damping: 28, stiffness: 300 } }}
        className={`absolute right-4 top-4 z-40 flex items-center gap-2 ${chromeVisible ? '' : 'pointer-events-none'}`}
      >
        <span className="pc-etch mr-1 hidden sm:inline">F · fullscreen &nbsp; S · desk</span>
        <button
          onClick={toggleFullscreen}
          className="pc-glass flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:text-[var(--pc-verd)]"
          title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`pc-glass flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition-colors ${
            showSettings ? 'text-[var(--pc-verd)]' : 'text-foreground hover:text-[var(--pc-verd)]'
          }`}
          title="Control desk (S)"
        >
          <Settings className={`h-4 w-4 transition-transform duration-300 ${showSettings ? 'rotate-90' : ''}`} />
        </button>
      </motion.div>

      {/* ── The control desk ── */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-30"
              onClick={() => setShowSettings(false)}
            />
            <motion.div
              initial={{ x: 360, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 360, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="pc-glass absolute bottom-3 right-3 top-3 z-40 flex w-[min(340px,calc(100vw-24px))] flex-col"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="pc-etch">Control desk</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">RM 05 · Polar Clock</p>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Close control desk"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
                {/* ── Projector ── */}
                <SettingsSection title="Projector">
                  <Chip on={background === 'none'} onClick={() => setBackground('none')} className="mb-3">
                    Dome dark
                  </Chip>

                  <div className="space-y-3">
                    {BACKGROUND_GROUPS.map(group => (
                      <div key={group.group}>
                        <p className="pc-etch text-[9px]">{group.group}</p>
                        <p className="mb-1.5 mt-0.5 text-[10px] italic text-muted-foreground">{group.hint}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.items.map(item => (
                            <Chip
                              key={item.key}
                              on={background === item.key}
                              onClick={() => setBackground(item.key)}
                              className="px-2 py-1 text-[11px]"
                            >
                              {item.label}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {waitingForAudio && (
                    <p className="mt-3 border-l-2 border-[var(--pc-lamp)] pl-2 text-[10px] leading-relaxed text-muted-foreground">
                      Nothing is playing, so this slide has nothing to react to — it keeps
                      its own motion but stays flat. Start a track in BarFoo and it comes alive.
                    </p>
                  )}

                  {background !== 'none' && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="pc-etch shrink-0 text-[9px]">Opacity</span>
                      <input
                        type="range" min={0} max={1} step={0.05} value={bgOpacity}
                        onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                        className="h-1.5 flex-1 cursor-pointer accent-[var(--pc-verd)]"
                      />
                      <span className="pc-readout w-9 text-right text-[11px] text-muted-foreground">
                        {Math.round(bgOpacity * 100)}%
                      </span>
                    </div>
                  )}

                  {background === 'julia' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Chip on={juliaManual} onClick={() => setJuliaManual(!juliaManual)} className="px-2 py-1 text-[10px]">
                          {juliaManual ? 'Manual c' : 'Animated c'}
                        </Chip>
                        {juliaManual && (
                          <span className="pc-readout text-[10px] text-muted-foreground">
                            c = {juliaCRe.toFixed(3)} {juliaCIm < 0 ? '−' : '+'} {Math.abs(juliaCIm).toFixed(3)}i
                          </span>
                        )}
                      </div>
                      {juliaManual && (
                        <div
                          className="relative aspect-square w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-[hsl(224_40%_4%)]"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setJuliaDragging(true);
                            const plotEl = e.currentTarget;
                            const update = (ev: MouseEvent | React.MouseEvent) => {
                              const rect = plotEl.getBoundingClientRect();
                              const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                              const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                              setJuliaCRe(x * 4 - 2);
                              setJuliaCIm(y * 4 - 2);
                            };
                            update(e);
                            const onMove = (ev: MouseEvent) => { ev.preventDefault(); update(ev); };
                            const onUp = () => {
                              setJuliaDragging(false);
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        >
                          <div className="absolute bottom-0 left-1/2 top-0 w-px bg-border" />
                          <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                          <span className="pc-readout absolute bottom-0.5 right-1 text-[8px] text-muted-foreground/60">Re</span>
                          <span className="pc-readout absolute left-1 top-0.5 text-[8px] text-muted-foreground/60">Im</span>
                          <div
                            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                            style={{
                              left: `${((juliaCRe + 2) / 4) * 100}%`,
                              top: `${((juliaCIm + 2) / 4) * 100}%`,
                              background: 'var(--pc-verd)',
                              borderColor: '#04120f',
                              boxShadow: '0 0 12px color-mix(in srgb, var(--pc-verd) 60%, transparent)',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </SettingsSection>

                {/* ── Palette ── */}
                <SettingsSection title="Palette">
                  <div className="space-y-1">
                    {Object.entries(PALETTES).map(([key, p]) => (
                      <button
                        key={key}
                        onClick={() => setPalette(key)}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                          palette === key
                            ? 'bg-primary/12 text-foreground ring-1 ring-[color-mix(in_srgb,var(--pc-verd)_38%,transparent)]'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <div className="flex -space-x-1">
                          {p.colors.slice(0, 5).map((c, i) => (
                            <div key={i} className="h-3 w-3 rounded-full border border-[#05070e]" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </SettingsSection>

                {/* ── Rings ── */}
                <SettingsSection title="Rings">
                  <div className="flex flex-wrap gap-1.5">
                    {RING_LABELS.map(({ key, label }) => (
                      <Chip key={key} on={rings[key]} onClick={() => toggleRing(key)} className="px-2 py-1 text-[11px]">
                        {label}
                      </Chip>
                    ))}
                  </div>
                </SettingsSection>

                {/* ── Motion ── */}
                <SettingsSection title="Motion">
                  <div className="flex gap-1.5">
                    <Chip on={smooth} onClick={() => setSmooth(true)}>Sweep</Chip>
                    <Chip on={!smooth} onClick={() => setSmooth(false)}>Tick</Chip>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <Chip on={powerMode === 'full'} onClick={() => setPowerMode('full')}>Full power</Chip>
                    <Chip on={powerMode === 'economy'} onClick={() => setPowerMode('economy')}>Economy</Chip>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    Economy parks the projector and updates the dial once a second.
                    Hidden tabs sleep automatically.
                  </p>
                </SettingsSection>

                {/* ── Dial ── */}
                <SettingsSection title="Dial">
                  <div className="flex gap-1.5">
                    {([['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const).map(([key, lbl]) => (
                      <Chip key={key} on={alignment === key} onClick={() => setAlignment(key)}>{lbl}</Chip>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip on={showClock} onClick={() => setShowClock(!showClock)} className="px-2 py-1 text-[11px]">Dial</Chip>
                    <Chip on={showCity} onClick={() => setShowCity(!showCity)} className="px-2 py-1 text-[11px]">City</Chip>
                    <Chip on={showDate} onClick={() => setShowDate(!showDate)} className="px-2 py-1 text-[11px]">Date</Chip>
                    <Chip on={showSlots} onClick={() => setShowSlots(!showSlots)} className="px-2 py-1 text-[11px]">City slots</Chip>
                    <Chip on={showYearBar} onClick={() => setShowYearBar(!showYearBar)} className="px-2 py-1 text-[11px]">Year transit</Chip>
                  </div>
                </SettingsSection>

                {/* ── Export ── */}
                <SettingsSection title="Export as wallpaper" defaultOpen={false}>
                  <div className="space-y-2">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      Bundles your current settings into a standalone animated wallpaper.
                    </p>
                    {!EXPORTABLE_BACKGROUNDS.has(background) && (
                      <p className="border-l-2 border-[var(--pc-lamp)] pl-2 text-[10px] leading-relaxed text-muted-foreground">
                        <strong className="text-foreground">{backgroundLabel(background)}</strong> can&apos;t come
                        along — a wallpaper has no page audio to listen to. The export will
                        ship with the dome dark; pick a Fractal or Ambient slide to keep a backdrop.
                      </p>
                    )}
                    <button
                      onClick={() => {
                        const ws = wallpaperSettings();
                        downloadZip('polar-clock-wallpaper-engine.zip', [
                          { name: 'index.html', content: generateWallpaperHTML(ws) },
                          { name: 'project.json', content: generateWEProjectJson() },
                        ]);
                      }}
                      className="pc-chip pc-chip-on flex w-full cursor-pointer items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium"
                    >
                      <Download className="h-3 w-3" />
                      Wallpaper Engine
                    </button>
                    <button
                      onClick={() => {
                        const ws = wallpaperSettings();
                        downloadZip('polar-clock-lively.zip', [
                          { name: 'index.html', content: generateWallpaperHTML(ws) },
                          { name: 'LivelyProperties.json', content: generateLivelyProperties() },
                        ]);
                      }}
                      className="pc-chip flex w-full cursor-pointer items-center justify-center gap-1.5 px-2.5 py-2 text-xs"
                    >
                      <Download className="h-3 w-3" />
                      Lively Wallpaper
                    </button>
                  </div>
                </SettingsSection>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
