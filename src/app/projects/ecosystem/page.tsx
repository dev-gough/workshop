'use client';

// RM 12, The Vivarium — a predator-prey world in a lit tank, with the whole
// model brought out onto the cabinet face.
//
// The room owns one animation loop: it advances the simulation at the dialled
// rate and then repaints every instrument by hand. React state changes only a
// few times a second, for the text readouts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import {
  Ecosystem,
  TRAITS,
  TRAIT_LABEL,
  defaultParams,
  needsRestock,
  type Agent,
  type EcoParams,
  type Stats,
  type TraitKey,
} from './_lib/engine';
import Tank, { DEFAULT_OVERLAYS, type ColorBy, type Overlays, type TankHandle } from './_components/tank';
import Rack from './_components/rack';
import Trials, { type Trial } from './_components/trials';
import { Census, Inspector } from './_components/readouts';
import {
  CoreSample,
  CostSurface,
  Distributions,
  PhasePortrait,
  Recorder,
  Turnover,
  type DrawHandle,
} from './_components/instruments';

type Bench = 'core' | 'phase' | 'cost' | 'turnover';

const BENCHES: { id: Bench; label: string; blurb: string }[] = [
  { id: 'core', label: 'Core sample', blurb: 'Ink is density, the line is the mean.' },
  { id: 'phase', label: 'Phase portrait', blurb: 'A closed loop is a stable cycle.' },
  { id: 'cost', label: 'Cost surface', blurb: 'Cost per tick, with the population on it.' },
  { id: 'turnover', label: 'Turnover', blurb: 'Births against deaths, by cause.' },
];

const OVERLAY_CHIPS: { key: keyof Omit<Overlays, 'colorBy'>; label: string; hint: string }[] = [
  { key: 'plants', label: 'Plants', hint: 'Show the plants grazers feed on.' },
  { key: 'vision', label: 'Vision', hint: 'Draw each agent’s sensing radius — the only thing it knows about the world.' },
  { key: 'intent', label: 'Intent', hint: 'Draw the steering vector each agent chose this tick: fleeing, hunting or grazing.' },
  { key: 'energy', label: 'Energy', hint: 'Ring each agent with its progress toward its breeding threshold.' },
  { key: 'trails', label: 'Trails', hint: 'Let the tank hold a few frames of motion instead of wiping clean.' },
  { key: 'grid', label: 'Hash grid', hint: 'Show the spatial hash the engine actually searches for neighbours.' },
];

const COLOR_BY: { key: ColorBy; label: string }[] = [
  { key: 'species', label: 'Species' },
  ...TRAITS.map(k => ({ key: k as ColorBy, label: TRAIT_LABEL[k] })),
  { key: 'energy', label: 'Energy' },
  { key: 'generation', label: 'Gen' },
];

export default function EcosystemPage() {
  useHeaderConfig({ scopeClass: 'eco-theme' });

  const [params, setParams] = useState<EcoParams>(defaultParams);
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState(60);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);
  const [bench, setBench] = useState<Bench>('core');
  const [coreTrait, setCoreTrait] = useState<TraitKey>('speed');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [restockPending, setRestockPending] = useState(false);
  const [trial, setTrial] = useState<string | null>('baseline');

  const engineRef = useRef<Ecosystem | null>(null);
  if (!engineRef.current) engineRef.current = new Ecosystem(defaultParams());
  // The parameters the running world was actually built from. Comparing the
  // rack against these is what makes "restock" light up — and go dark again if
  // you dial the change back.
  const builtRef = useRef<EcoParams>(defaultParams());

  const tankRef = useRef<TankHandle>(null);
  const recorderRef = useRef<DrawHandle>(null);
  const benchRef = useRef<DrawHandle>(null);
  const distRef = useRef<DrawHandle>(null);
  const rafRef = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const [snapshot, setSnapshot] = useState<{ stats: Stats; agent: Agent | null }>(() => ({
    stats: (engineRef.current as Ecosystem).stats(),
    agent: null,
  }));

  const paint = useCallback(() => {
    tankRef.current?.draw();
    recorderRef.current?.draw();
    benchRef.current?.draw();
    distRef.current?.draw();
  }, []);

  const refreshReadouts = useCallback(() => {
    const eco = engineRef.current;
    if (!eco) return;
    setSnapshot({
      stats: eco.stats(),
      agent: selectedId === null ? null : eco.find(selectedId),
    });
  }, [selectedId]);

  // ── The loop. Ticks are accumulated against real time so the dialled rate
  // means the same thing regardless of frame rate, and capped so a slow frame
  // can't spiral.
  useEffect(() => {
    if (!running) {
      paint();
      refreshReadouts();
      return;
    }
    let last = performance.now();
    let carry = 0;
    let frame = 0;

    const loop = (now: number) => {
      const eco = engineRef.current;
      if (!eco) return;
      carry += now - last;
      last = now;
      const interval = 1000 / rateRef.current;
      const steps = Math.min(Math.floor(carry / interval), 40);
      if (steps > 0) {
        for (let i = 0; i < steps; i++) eco.step();
        carry -= steps * interval;
      }
      paint();
      // Text readouts settle at about 8 Hz; numbers that flicker can't be read.
      if (++frame % 8 === 0) refreshReadouts();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, paint, refreshReadouts]);

  useEffect(() => {
    if (!running) {
      paint();
      refreshReadouts();
    }
  }, [bench, coreTrait, overlays, selectedId, running, paint, refreshReadouts]);

  // Live parameters flow straight through to the running world. World size and
  // seed are held back — changing those mid-run would invalidate the history
  // that is already on the instruments.
  const applyParams = useCallback((next: EcoParams) => {
    setParams(next);
    setRestockPending(needsRestock(builtRef.current, next));
    setTrial(null);
    const eco = engineRef.current;
    if (eco) {
      eco.params = {
        ...next,
        seed: eco.params.seed,
        world: { ...next.world, w: eco.params.world.w, h: eco.params.world.h },
      };
    }
  }, []);

  const restock = useCallback((withParams?: EcoParams) => {
    const p = withParams ?? params;
    builtRef.current = structuredClone(p);
    engineRef.current = new Ecosystem(structuredClone(p));
    setSelectedId(null);
    setRestockPending(false);
    setSnapshot({ stats: engineRef.current.stats(), agent: null });
    paint();
  }, [params, paint]);

  const runTrial = useCallback((t: Trial) => {
    const next = t.build();
    setParams(next);
    setTrial(t.id);
    restock(next);
    setRunning(true);
  }, [restock]);

  const stepOnce = useCallback(() => {
    engineRef.current?.step();
    paint();
    refreshReadouts();
  }, [paint, refreshReadouts]);

  const toggleOverlay = useCallback((key: keyof Omit<Overlays, 'colorBy'>) => {
    setOverlays(o => ({ ...o, [key]: !o[key] }));
  }, []);

  const selectedCost = useMemo(() => {
    const eco = engineRef.current;
    return eco && snapshot.agent ? eco.cost(snapshot.agent.genome) : 0;
  }, [snapshot.agent]);

  const benchBlurb = BENCHES.find(b => b.id === bench)?.blurb ?? '';

  // The plate heads the rack on desktop. Stacked on a phone the rack falls to
  // the bottom — nobody scrolls sixty dials to reach the room — so the plate
  // rides above the tank instead.
  const plate = (
    <div className="border-b border-border px-3 pb-2.5 pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
        RM 12 · The Vivarium
      </p>
      <h1 className="ws-serif mt-0.5 text-xl font-semibold leading-tight">Ecosystem</h1>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        Grazers eat plants, hunters eat grazers, and every body pays for itself each tick. Nothing
        here is scripted — turn a dial and watch what the world makes of it.
      </p>
    </div>
  );

  return (
    <PageTransition>
      <div className="eco-theme eco-room flex flex-col lg:flex-row">
        {/* ── The rack: every rule of the world, as a dial ── */}
        <aside className="order-3 flex w-full shrink-0 flex-col border-t border-border lg:order-1 lg:w-[288px] lg:border-r lg:border-t-0 lg:overflow-y-auto">
          <div className="hidden lg:block">{plate}</div>
          <div className="pt-3">
            <Trials active={trial} onRun={runTrial} />
            <Rack params={params} onChange={applyParams} />
          </div>
        </aside>

        {/* ── The tank and the bench ── */}
        <main className="order-1 flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3 lg:order-2 lg:min-h-0">
          <div className="-mx-3 -mt-3 mb-1 lg:hidden">{plate}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRunning(r => !r)}
                className="eco-chip flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                data-on={running}
              >
                {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {running ? 'Running' : 'Held'}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={stepOnce}
                    className="eco-chip flex h-7 w-7 items-center justify-center"
                    aria-label="Advance one tick"
                  >
                    <SkipForward className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Advance a single tick</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => restock()}
                    data-on={restockPending}
                    className="eco-chip flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restock
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {restockPending
                    ? 'A dial marked ↺ has changed. Restock to build a fresh world with it.'
                    : 'Rebuild the world from the current dials and seed.'}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex min-w-[130px] items-center gap-2">
              <span className="eco-etch shrink-0 text-[9px]">Rate</span>
              <Slider
                className="eco-dial w-20"
                value={[rate]}
                onValueChange={v => setRate(v[0])}
                min={1}
                max={400}
                step={1}
                aria-label="Ticks per second"
              />
              <span className="eco-readout shrink-0 text-[10px] text-muted-foreground">{rate} t/s</span>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-1">
              {OVERLAY_CHIPS.map(c => (
                <Tooltip key={c.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleOverlay(c.key)}
                      data-on={overlays[c.key]}
                      className="eco-chip h-[22px] px-1.5 text-[9px] font-medium"
                    >
                      {c.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-60">{c.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="eco-etch mr-0.5 cursor-help text-[9px]">Colour by</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Paint every agent by one number instead of by species. Shape still tells you which
                is which: grazers are discs, hunters are arrowheads.
              </TooltipContent>
            </Tooltip>
            {COLOR_BY.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setOverlays(o => ({ ...o, colorBy: c.key }))}
                data-on={overlays.colorBy === c.key}
                className="eco-chip h-[20px] px-1.5 text-[9px] font-medium"
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="min-h-[220px] flex-1">
            <Tank ref={tankRef} engine={engineRef} overlays={overlays} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          {/* The recorder: three pens, three channels, each on its own scale. */}
          <div className="eco-case h-[98px] shrink-0 overflow-hidden">
            <Recorder ref={recorderRef} engine={engineRef} />
          </div>

          {/* The bench: one deep instrument at a time. */}
          <div className="eco-case flex h-[210px] shrink-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              {BENCHES.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBench(b.id)}
                  data-on={bench === b.id}
                  className="eco-chip h-[20px] px-1.5 text-[9px] font-medium"
                >
                  {b.label}
                </button>
              ))}
              {bench === 'core' && (
                <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
                  {TRAITS.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setCoreTrait(k)}
                      data-on={coreTrait === k}
                      className="eco-chip h-[20px] px-1.5 text-[9px] font-medium"
                    >
                      {TRAIT_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
              <p className="ml-auto hidden whitespace-nowrap text-[9px] text-muted-foreground xl:block">
                {benchBlurb}
              </p>
            </div>
            <div className="min-h-0 flex-1 p-2">
              {bench === 'core' && <CoreSample ref={benchRef} engine={engineRef} trait={coreTrait} />}
              {bench === 'phase' && <PhasePortrait ref={benchRef} engine={engineRef} />}
              {bench === 'cost' && <CostSurface ref={benchRef} engine={engineRef} />}
              {bench === 'turnover' && <Turnover ref={benchRef} engine={engineRef} />}
            </div>
          </div>
        </main>

        {/* ── The readouts ── */}
        <aside className="order-2 flex w-full shrink-0 flex-col gap-2 border-t border-border p-3 lg:order-3 lg:w-[300px] lg:border-l lg:overflow-y-auto">
          <Census stats={snapshot.stats} />
          <Inspector
            agent={snapshot.agent}
            stats={snapshot.stats}
            params={params}
            cost={selectedCost}
            onClear={() => setSelectedId(null)}
          />
          <div className="eco-case flex min-h-[210px] flex-1 flex-col overflow-hidden">
            <div className="flex items-baseline gap-2 border-b border-border px-2.5 py-1.5">
              <span className="eco-etch">Selection, right now</span>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <Distributions ref={distRef} engine={engineRef} />
            </div>
            <p className="border-t border-border px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
              Bars are the living population; the line is its mean. The{' '}
              <span className="text-primary">caret</span> is the mean of everything just born — ahead
              of the line means the trait is climbing.
            </p>
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}
