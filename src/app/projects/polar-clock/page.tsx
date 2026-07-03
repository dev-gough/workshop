'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Maximize, Minimize, Download } from 'lucide-react';
import { generateWallpaperHTML, generateWEProjectJson, generateLivelyProperties, downloadZip, type WallpaperSettings } from './wallpaper-export';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '@/components/ThemeProvider';
import { getCookie, setCookie, PALETTES, TIMEZONE_OPTIONS, type RingConfig, type CitySlot } from './_components/shared';
import { GOLBackground } from './_components/GOLBackground';
import { JuliaBackground, MandelbrotBackground } from './_components/Fractal';
import { KochBackground } from './_components/KochBackground';
import { StarfieldBackground } from './_components/StarfieldBackground';
import { ParticleFlowBackground } from './_components/ParticleFlowBackground';
import { MatrixRainBackground } from './_components/MatrixRainBackground';
import { VoronoiBackground } from './_components/VoronoiBackground';
import { RipplesBackground } from './_components/RipplesBackground';
import { LissajousBackground } from './_components/LissajousBackground';
import { SineWaveBackground } from './_components/SineWaveBackground';
import { ApollonianBackground } from './_components/ApollonianBackground';
import { SpectrumBackground, OrbBackground, AuroraBackground, RadialSpectrumBackground } from './_components/AudioBackgrounds';
import { PolarClockSVG } from './_components/PolarClockSVG';
import { SettingsSection } from './_components/SettingsSection';

// ── Main Page ───────────────────────────────────────────────────
export default function PolarClockPage() {
  const { theme } = useTheme();
  const [time, setTime] = useState(new Date());
  const [smooth, setSmooth] = useState(true);
  const [palette, setPalette] = useState(() => getCookie('polarclock_palette') ?? 'default');
  const [background, setBackground] = useState<'none' | 'gol' | 'julia' | 'mandelbrot' | 'koch' | 'starfield' | 'particles' | 'matrix' | 'voronoi' | 'ripples' | 'lissajous' | 'sinewaves' | 'apollonian' | 'spectrum' | 'orb' | 'aurora' | 'radial'>(() => { const v = getCookie('polarclock_bg'); return v === 'fractal' ? 'julia' : (v as any) ?? 'none'; });
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>(() => (getCookie('polarclock_align') as any) ?? 'center');
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
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 's') setShowSettings(prev => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  // Viewport size for background and clock sizing
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Tick
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), smooth ? 50 : 1000);
    return () => clearInterval(interval);
  }, [smooth]);

  // Persist settings
  useEffect(() => { setCookie('polarclock_slots', JSON.stringify(slots)); }, [slots]);
  useEffect(() => { setCookie('polarclock_palette', palette); }, [palette]);
  useEffect(() => { setCookie('polarclock_bg', background); }, [background]);
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

  // Clock size: fill viewport minus header(64) + hotkey bar(48) + year bar(60) + padding
  const headerH = isFullscreen ? 0 : 64;
  const hotbarH = showSlots ? 48 : 0;
  const yearBarH = showYearBar ? 60 : 0;
  const pad = 16;
  const availH = viewSize.h - headerH - hotbarH - yearBarH - pad;
  const clockSize = Math.max(200, Math.min(availH, viewSize.w - 40));

  const ringLabels: { key: keyof RingConfig; label: string }[] = [
    { key: 'seconds', label: 'Seconds' }, { key: 'minutes', label: 'Minutes' },
    { key: 'hours', label: 'Hours' }, { key: 'days', label: 'Days' },
    { key: 'months', label: 'Months' }, { key: 'dayOfYear', label: 'Day of Year' },
    { key: 'weekOfYear', label: 'Week of Year' },
  ];

  return (
    <>
      {/* Full-viewport container */}
      <div ref={containerRef} className="relative overflow-hidden bg-background" style={{ height: isFullscreen ? '100vh' : `calc(100vh - ${headerH}px)` }}>

        {/* Background layer */}
        <div className="absolute inset-0 z-0" style={{ opacity: bgOpacity }}>
          {background === 'gol' && viewSize.w > 0 && (
            <GOLBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'julia' && viewSize.w > 0 && (
            <JuliaBackground width={viewSize.w} height={viewSize.h - headerH} manual={juliaManual} cRe={juliaCRe} cIm={juliaCIm} dragging={juliaDragging} />
          )}
          {background === 'mandelbrot' && viewSize.w > 0 && (
            <MandelbrotBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'koch' && viewSize.w > 0 && (
            <KochBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'starfield' && viewSize.w > 0 && (
            <StarfieldBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'particles' && viewSize.w > 0 && (
            <ParticleFlowBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'matrix' && viewSize.w > 0 && (
            <MatrixRainBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'voronoi' && viewSize.w > 0 && (
            <VoronoiBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'ripples' && viewSize.w > 0 && (
            <RipplesBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'lissajous' && viewSize.w > 0 && (
            <LissajousBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'sinewaves' && viewSize.w > 0 && (
            <SineWaveBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'apollonian' && viewSize.w > 0 && (
            <ApollonianBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'spectrum' && viewSize.w > 0 && (
            <SpectrumBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'orb' && viewSize.w > 0 && (
            <OrbBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'aurora' && viewSize.w > 0 && (
            <AuroraBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'radial' && viewSize.w > 0 && (
            <RadialSpectrumBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
        </div>

        {/* Clock — centered */}
        {showClock &&
        <div className={`absolute inset-0 z-10 flex items-center ${
          alignment === 'left' ? 'justify-start pl-8' : alignment === 'right' ? 'justify-end pr-8' : 'justify-center'
        }`} style={{ bottom: hotbarH + yearBarH }}>
          {clockSize > 0 && (
            <PolarClockSVG
              timezone={currentTz}
              label={currentLabel}
              time={time}
              palette={palette}
              smooth={smooth}
              rings={rings}
              size={clockSize}
              showCity={showCity}
              showDate={showDate}
            />
          )}
        </div>}

        {/* Top right controls */}
        <div className="absolute top-4 right-4 z-30 flex gap-2">
          <button
            onClick={toggleFullscreen}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer bg-card/80 backdrop-blur border text-foreground hover:bg-muted"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              showSettings ? 'bg-primary text-primary-foreground' : 'bg-card/80 backdrop-blur border text-foreground hover:bg-muted'
            }`}
          >
            <Settings className={`h-5 w-5 transition-transform ${showSettings ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {/* Settings panel — slides from right */}
        <AnimatePresence>
          {showSettings && (
            <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-20"
              onClick={() => setShowSettings(false)}
            />
            <motion.div
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute top-16 right-4 z-30 w-72 bg-card/95 backdrop-blur-lg border rounded-xl shadow-2xl p-4 space-y-5 max-h-[70vh] overflow-y-auto"
            >
              {/* Background */}
              <SettingsSection title="Background">
                <div className="flex flex-wrap gap-1.5">
                  {([['none', 'None'], ['gol', 'Game of Life'], ['julia', 'Julia Set'], ['mandelbrot', 'Mandelbrot'], ['koch', 'Koch Curve'], ['starfield', 'Starfield'], ['particles', 'Flow Field'], ['matrix', 'Matrix Rain'], ['voronoi', 'Voronoi'], ['ripples', 'Ripples'], ['lissajous', 'Lissajous'], ['sinewaves', 'Sine Waves'], ['apollonian', 'Apollonian'], ['spectrum', '♫ Spectrum'], ['orb', '♫ Orb'], ['aurora', '♫ Aurora'], ['radial', '♫ Radial']] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setBackground(key)}
                      className={`px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                        background === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {background !== 'none' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-muted-foreground">Opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgOpacity}
                      onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(bgOpacity * 100)}%</span>
                  </div>
                )}
                {background === 'julia' && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setJuliaManual(!juliaManual)}
                        className={`px-2 py-1 rounded text-[10px] cursor-pointer ${juliaManual ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      >{juliaManual ? 'Manual C' : 'Animated'}</button>
                      {juliaManual && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          c = {juliaCRe.toFixed(3)} + {juliaCIm.toFixed(3)}i
                        </span>
                      )}
                    </div>
                    {juliaManual && (
                      <div
                        ref={(el) => { if (el) (el as any).__plotEl = el; }}
                        className="relative w-full aspect-square bg-muted/50 rounded-lg border cursor-crosshair overflow-hidden"
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
                        {/* Grid lines */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/40" />
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-border/40" />
                        {/* Axis labels */}
                        <span className="absolute bottom-0.5 right-1 text-[8px] text-muted-foreground/50">Re</span>
                        <span className="absolute top-0.5 left-1 text-[8px] text-muted-foreground/50">Im</span>
                        <span className="absolute bottom-0.5 left-1 text-[8px] text-muted-foreground/30">-2</span>
                        <span className="absolute bottom-0.5 right-1 text-[8px] text-muted-foreground/30">2</span>
                        <span className="absolute top-0.5 right-1 text-[8px] text-muted-foreground/30">-2</span>
                        {/* Crosshair dot */}
                        <div
                          className="absolute w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                          style={{
                            left: `${((juliaCRe + 2) / 4) * 100}%`,
                            top: `${((juliaCIm + 2) / 4) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </SettingsSection>

              {/* Palette */}
              <SettingsSection title="Palette">
                <div className="space-y-1">
                  {Object.entries(PALETTES).map(([key, p]) => (
                    <button
                      key={key}
                      onClick={() => setPalette(key)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                        palette === key ? 'bg-primary/15 border border-primary/30' : 'hover:bg-muted'
                      }`}
                    >
                      <div className="flex -space-x-1">
                        {p.colors.slice(0, 5).map((c, i) => (
                          <div key={i} className="w-3 h-3 rounded-full border border-background" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </SettingsSection>

              {/* Rings */}
              <SettingsSection title="Rings">
                <div className="flex flex-wrap gap-1.5">
                  {ringLabels.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => toggleRing(key)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                        rings[key] ? 'bg-primary/15 border border-primary/30 font-medium' : 'bg-muted opacity-50 hover:opacity-80'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </SettingsSection>

              {/* Animation */}
              <SettingsSection title="Animation">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSmooth(true)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${smooth ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Smooth</button>
                  <button
                    onClick={() => setSmooth(false)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${!smooth ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Discrete</button>
                </div>
              </SettingsSection>

              {/* Alignment */}
              <SettingsSection title="Position">
                <div className="flex gap-1.5">
                  {([['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setAlignment(key)}
                      className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${alignment === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                    >{lbl}</button>
                  ))}
                </div>
              </SettingsSection>

              {/* Show/Hide UI */}
              <SettingsSection title="Interface">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setShowYearBar(!showYearBar)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showYearBar ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Year Bar</button>
                  <button
                    onClick={() => setShowSlots(!showSlots)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showSlots ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >City Slots</button>
                  <button
                    onClick={() => setShowClock(!showClock)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showClock ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Clock</button>
                  <button
                    onClick={() => setShowCity(!showCity)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showCity ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >City Name</button>
                  <button
                    onClick={() => setShowDate(!showDate)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showDate ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Date</button>
                </div>
              </SettingsSection>

              <SettingsSection title="Export as Wallpaper" defaultOpen={false}>
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">Export with your current settings as a standalone animated wallpaper.</p>
                  <button
                    onClick={() => {
                      const ws: WallpaperSettings = {
                        palette, background, bgOpacity, smooth, alignment,
                        rings, showCity, showDate,
                        timezone: slots[activeSlot]?.timezone ?? 'America/New_York',
                        cityLabel: slots[activeSlot]?.label ?? 'New York',
                      };
                      const html = generateWallpaperHTML(ws);
                      const proj = generateWEProjectJson();
                      downloadZip('polar-clock-wallpaper-engine.zip', [
                        { name: 'index.html', content: html },
                        { name: 'project.json', content: proj },
                      ]);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Wallpaper Engine
                  </button>
                  <button
                    onClick={() => {
                      const ws: WallpaperSettings = {
                        palette, background, bgOpacity, smooth, alignment,
                        rings, showCity, showDate,
                        timezone: slots[activeSlot]?.timezone ?? 'America/New_York',
                        cityLabel: slots[activeSlot]?.label ?? 'New York',
                      };
                      const html = generateWallpaperHTML(ws);
                      const props = generateLivelyProperties();
                      downloadZip('polar-clock-lively.zip', [
                        { name: 'index.html', content: html },
                        { name: 'LivelyProperties.json', content: props },
                      ]);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Lively Wallpaper
                  </button>
                </div>
              </SettingsSection>
            </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* City Hotkeys — bottom of clock area */}
        {showSlots && <div className="absolute left-0 right-0 z-20 flex items-center px-4" style={{ bottom: yearBarH }}>
          <div className="flex items-center gap-2">
            {slots.map((slot, i) => (
              <div key={i} className="relative">
                <button
                  onClick={() => {
                    if (slot) {
                      setActiveSlot(i);
                      setEditingSlot(null);
                    } else {
                      setEditingSlot(editingSlot === i ? null : i);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (i > 0) setEditingSlot(editingSlot === i ? null : i);
                  }}
                  className={`w-9 h-9 rounded-lg text-sm font-mono font-bold transition-all cursor-pointer ${
                    activeSlot === i && slot
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                      : slot
                      ? 'bg-card/80 backdrop-blur border text-foreground hover:bg-muted'
                      : 'bg-card/40 backdrop-blur border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-card/60'
                  }`}
                  title={slot ? `${slot.label} (right-click to change)` : 'Click to assign'}
                >
                  {i + 1}
                </button>
                {/* Slot label */}
                {slot && activeSlot === i && (
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap font-medium">
                    {slot.label}
                  </span>
                )}

                {/* Slot picker dropdown */}
                <AnimatePresence>
                  {editingSlot === i && (
                    <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.1 }}
                      className="fixed inset-0 z-30"
                      onClick={() => setEditingSlot(null)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-12 left-0 z-40 w-48 max-h-60 overflow-y-auto bg-card/95 backdrop-blur-lg border rounded-lg shadow-xl p-1.5"
                    >
                      {slot && i > 0 && (
                        <button
                          onClick={() => clearSlot(i)}
                          className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-destructive/15 text-destructive cursor-pointer mb-1"
                        >
                          Clear slot
                        </button>
                      )}
                      {TIMEZONE_OPTIONS.map(tz => (
                        <button
                          key={tz.value}
                          onClick={() => assignSlot(i, tz)}
                          className={`w-full text-left px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                            slot?.timezone === tz.value ? 'bg-primary/15 font-medium' : 'hover:bg-muted'
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
          </div>
        </div>}

        {/* Year Progress — pinned to very bottom */}
        {showYearBar && <div className="absolute left-0 right-0 bottom-0 z-20 px-4 py-2">
          <div className="flex items-center gap-4 bg-card/70 backdrop-blur-md border rounded-full px-5 py-2 shadow-lg">
            <span className="text-xs font-semibold text-muted-foreground">{time.getFullYear()}</span>
            <div className="flex-1 relative h-2 bg-muted/50 rounded-full overflow-hidden">
              {[25, 50, 75].map(q => (
                <div key={q} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${q}%` }} />
              ))}
              {(() => {
                const year = time.getFullYear();
                const start = new Date(year, 0, 1);
                const end = new Date(year + 1, 0, 1);
                const pct = ((time.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
                return (
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${PALETTES[palette].colors[0]}, ${PALETTES[palette].colors[1]}, ${PALETTES[palette].colors[2]})`,
                      width: `${pct}%`,
                    }}
                  />
                );
              })()}
            </div>
            {(() => {
              const year = time.getFullYear();
              const start = new Date(year, 0, 1);
              const end = new Date(year + 1, 0, 1);
              const elapsed = time.getTime() - start.getTime();
              const total = end.getTime() - start.getTime();
              const pct = (elapsed / total) * 100;
              const dayOfYear = Math.floor(elapsed / 86400000) + 1;
              const daysInYear = Math.floor(total / 86400000);
              return (
                <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
                  <strong className="text-foreground">{pct.toFixed(1)}%</strong>
                  <span>Day {dayOfYear}</span>
                  <span>{daysInYear - dayOfYear} left</span>
                </div>
              );
            })()}
          </div>
        </div>}
      </div>
    </>
  );
}
