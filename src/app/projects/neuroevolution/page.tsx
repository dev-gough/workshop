'use client';

// RM 13, Driving School — a grid of neural-network cars learning a floodlit
// circuit, with the whole mechanism brought out onto the pit wall.
//
// The room owns one animation loop: it advances the session at the dialled
// rate and then repaints every instrument by hand. React state changes only a
// few times a second, for the text readouts.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, ClipboardCopy, Eraser, FastForward, Maximize2, Minimize2, Pause, PenLine, Play,
  RotateCcw, Route, Share2, SkipForward, Upload, X,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Session,
  defaultParams,
  needsRegrid,
  type DriveParams,
  type Point,
  type Retirement,
} from './_lib/engine';
import { decodeReplay, encodeReplay, replayCard, type ReplayCard } from './_lib/replay';
import Circuit, {
  DEFAULT_OVERLAYS,
  type CamMode,
  type ColorBy,
  type Overlays,
  type CircuitHandle,
} from './_components/circuit';
import Brain from './_components/brain';
import Tower, { type TowerRow } from './_components/tower';
import Rack from './_components/rack';
import Setups, { type Setup } from './_components/setups';
import RateControl from './_components/rate';
import { Attrition, Diversity, Progress, Telemetry, Weights, type DrawHandle } from './_components/instruments';

type Bench = 'progress' | 'attrition' | 'diversity' | 'weights';

const BENCHES: { id: Bench; label: string; blurb: string }[] = [
  { id: 'progress', label: 'Progress', blurb: 'Best and mean distance per heat. Purple dots are records.' },
  { id: 'attrition', label: 'Attrition', blurb: 'Who was still running, tick by tick. Learning pushes the cliff right.' },
  { id: 'diversity', label: 'Diversity', blurb: 'Genetic room left in the grid. Converged is a line near zero.' },
  { id: 'weights', label: 'Genome', blurb: 'The champion’s weights, laid flat. Orange excites, indigo inhibits.' },
];

const OVERLAY_CHIPS: { key: keyof Omit<Overlays, 'colorBy'>; label: string; hint: string }[] = [
  { key: 'rays', label: 'Rays', hint: 'The leader’s rangefinder fan — the only thing any car ever knows about the circuit.' },
  { key: 'trail', label: 'Trail', hint: 'The leader’s recent line, warmed by how fast it was travelling.' },
  { key: 'line', label: 'Line', hint: 'Centerline and direction chevrons — the geometry progress is measured along.' },
  { key: 'ghosts', label: 'Ghosts', hint: 'Leave crashed cars where they fell instead of clearing the wreckage.' },
  { key: 'grid', label: 'Hash', hint: 'The spatial hash the engine actually raycasts against — truth, not decoration.' },
];

const COLOR_BY: { key: ColorBy; label: string; hint: string }[] = [
  { key: 'field', label: 'Field', hint: 'Everyone in team steel; only the leader wears orange.' },
  { key: 'progress', label: 'Progress', hint: 'Paint each car by how far around it has driven this heat.' },
  { key: 'speed', label: 'Speed', hint: 'Paint each car by how fast it is going right now.' },
];

interface SelSnap {
  id: number;
  pos: number;
  metres: number;
  laps: number;
  alive: boolean;
  out: Retirement;
}

interface Snap {
  gen: number;
  tick: number;
  budget: number;
  alive: number;
  pop: number;
  bestEver: number;
  bestEverGen: number;
  recordLive: boolean;
  carried: boolean;
  custom: boolean;
  rows: TowerRow[];
  selected: SelSnap | null;
}

export default function DrivingSchoolPage() {
  useHeaderConfig({ scopeClass: 'drs-theme' });

  const [params, setParams] = useState<DriveParams>(defaultParams);
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState(120);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);
  const [camMode, setCamMode] = useState<CamMode>('circuit');
  const [bench, setBench] = useState<Bench>('progress');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [regridPending, setRegridPending] = useState(false);
  const [setup, setSetup] = useState<string | null>('baseline');
  const [focus, setFocus] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayText, setReplayText] = useState('');
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  if (!sessionRef.current) sessionRef.current = new Session(defaultParams());
  // The parameters the running session was actually built from. Comparing the
  // rack against these is what makes "regrid" light up — and go dark again if
  // you dial the change back.
  const builtRef = useRef<DriveParams>(defaultParams());

  const roomRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<CircuitHandle>(null);
  const telemetryRef = useRef<DrawHandle>(null);
  const benchRef = useRef<DrawHandle>(null);
  const brainRef = useRef<DrawHandle>(null);
  const rafRef = useRef(0);
  const replayLoadedRef = useRef(false);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const makeSnap = useCallback((): Snap => {
    const s = sessionRef.current as Session;
    const standings = s.standings();
    const leader = standings[0];
    const leaderM = leader ? s.metres(leader.progress) : 0;
    const rows: TowerRow[] = standings.map(c => ({
      id: c.id,
      metres: s.metres(c.progress),
      laps: s.laps(c),
      gap: leaderM - s.metres(c.progress),
      alive: c.alive,
      out: c.out,
    }));
    const champ = s.champion();
    let selected: SelSnap | null = null;
    if (selectedId !== null) {
      const idx = standings.findIndex(c => c.id === selectedId);
      if (idx >= 0) {
        const c = standings[idx];
        selected = {
          id: c.id, pos: idx + 1, metres: s.metres(c.progress),
          laps: s.laps(c), alive: c.alive, out: c.out,
        };
      }
    }
    return {
      gen: s.gen,
      tick: s.tick,
      budget: s.params.session.tickBudget,
      alive: s.aliveCount(),
      pop: s.cars.length,
      bestEver: s.bestEver,
      bestEverGen: s.bestEverGen,
      recordLive: champ ? s.bestEver > 0 && s.metres(champ.progress) > s.bestEver : false,
      carried: s.carriedGrid,
      custom: s.customTrack,
      rows,
      selected,
    };
  }, [selectedId]);

  const [snap, setSnap] = useState<Snap>(() => makeSnap());
  const draftWidth = params.circuit.width;

  const paint = useCallback(() => {
    circuitRef.current?.draw();
    telemetryRef.current?.draw();
    benchRef.current?.draw();
    brainRef.current?.draw();
  }, []);

  const refreshReadouts = useCallback(() => {
    setSnap(makeSnap());
  }, [makeSnap]);

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
      const s = sessionRef.current;
      if (!s) return;
      carry += now - last;
      last = now;
      const interval = 1000 / rateRef.current;
      const steps = Math.min(Math.floor(carry / interval), 40);
      if (steps > 0) {
        for (let i = 0; i < steps; i++) s.step();
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
  }, [bench, overlays, camMode, selectedId, focus, running, paint, refreshReadouts]);

  // Live parameters flow straight through to the running session. The staged
  // ones — seed, circuit shape, sensor count, brain size — are held back;
  // changing those mid-heat would tear the genomes out from under the cars.
  const applyParams = useCallback((next: DriveParams) => {
    setParams(next);
    setRegridPending(needsRegrid(builtRef.current, next));
    setSetup(null);
    const s = sessionRef.current;
    if (s) {
      s.params = {
        ...structuredClone(next),
        seed: s.params.seed,
        circuit: { ...s.params.circuit },
        sensors: { ...next.sensors, count: s.params.sensors.count },
        brain: { ...s.params.brain },
      };
    }
  }, []);

  const regrid = useCallback((withParams?: DriveParams) => {
    const p = withParams ?? params;
    builtRef.current = structuredClone(p);
    sessionRef.current = new Session(structuredClone(p));
    setSelectedId(null);
    setRegridPending(false);
    setSnap(makeSnap());
    paint();
  }, [params, makeSnap, paint]);

  const runSetup = useCallback((s: Setup) => {
    const next = s.build();
    setParams(next);
    setSetup(s.id);
    regrid(next);
    setRunning(true);
  }, [regrid]);

  const newCircuit = useCallback(() => {
    sessionRef.current?.newCircuit();
    paint();
    refreshReadouts();
  }, [paint, refreshReadouts]);

  // The drafting table: the session pauses under the glass while you paint.
  const toggleDraw = useCallback(() => {
    if (drawMode) {
      setDrawMode(false);
      setDraftMsg(null);
      circuitRef.current?.scrapDraft();
    } else {
      setDrawMode(true);
      setDraftMsg(null);
      setRunning(false);
      setSelectedId(null);
      setCamMode('circuit');
    }
  }, [drawMode]);

  const handleDraftComplete = useCallback((pts: Point[]): boolean => {
    const s = sessionRef.current;
    if (!s) return false;
    const err = s.customCircuit(pts, draftWidth);
    if (err) {
      setDraftMsg(err);
      return false;
    }
    setDrawMode(false);
    setDraftMsg(null);
    setSelectedId(null);
    setRunning(true);
    refreshReadouts();
    paint();
    return true;
  }, [draftWidth, refreshReadouts, paint]);

  const stepOnce = useCallback(() => {
    sessionRef.current?.step();
    paint();
    refreshReadouts();
  }, [paint, refreshReadouts]);

  const skipHeat = useCallback(() => {
    sessionRef.current?.skipHeat();
    paint();
    refreshReadouts();
  }, [paint, refreshReadouts]);

  const applyReplay = useCallback((card: ReplayCard) => {
    const next = new Session(card.params);
    if (card.customCircuit) {
      next.replayCircuit(card.customCircuit.centerline, card.customCircuit.width);
    }
    sessionRef.current = next;
    builtRef.current = structuredClone(card.params);
    setParams(structuredClone(card.params));
    setSetup(null);
    setSelectedId(null);
    setDrawMode(false);
    setDraftMsg(null);
    setRegridPending(false);
    setRunning(true);
    setSnap(makeSnap());
    paint();
  }, [makeSnap, paint]);

  const makeReplayUrl = useCallback(() => {
    const session = sessionRef.current;
    if (!session || typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('replay', encodeReplay(replayCard(session)));
    return url.toString();
  }, []);

  const openReplay = useCallback(() => {
    setReplayOpen(open => {
      const next = !open;
      if (next) {
        setReplayText(makeReplayUrl());
        setReplayMsg(null);
      }
      return next;
    });
  }, [makeReplayUrl]);

  const copyReplay = useCallback(async () => {
    const url = makeReplayUrl();
    setReplayText(url);
    try {
      await navigator.clipboard.writeText(url);
      setReplayMsg('Replay link copied — this season will restart from tick zero.');
    } catch {
      setReplayMsg('Copy was blocked; select the replay link above.');
    }
  }, [makeReplayUrl]);

  const loadReplay = useCallback(() => {
    const card = decodeReplay(replayText);
    if (!card) {
      setReplayMsg('That replay card is damaged or from an unknown version.');
      return;
    }
    applyReplay(card);
    setReplayMsg(card.customCircuit
      ? 'Hand-drawn circuit and seeded grid loaded at tick zero.'
      : 'Circuit, dials, and seeded grid loaded at tick zero.');
  }, [applyReplay, replayText]);

  // Shared links are self-opening replay cards. Strict decoding makes an
  // unrelated or malformed query harmless.
  useEffect(() => {
    if (replayLoadedRef.current) return;
    replayLoadedRef.current = true;
    const code = new URL(window.location.href).searchParams.get('replay');
    if (!code) return;
    const card = decodeReplay(code);
    setReplayOpen(true);
    setReplayText(window.location.href);
    if (!card) {
      setReplayMsg('This replay link is damaged or from an unknown version.');
      return;
    }
    applyReplay(card);
    setReplayMsg(card.customCircuit
      ? 'Hand-drawn replay loaded at tick zero.'
      : 'Seeded replay loaded at tick zero.');
  }, [applyReplay]);

  // Focus mode quiets the room down to the circuit. It also asks for real
  // fullscreen so the header goes too; if the browser refuses, the in-page
  // version still stands on its own.
  const toggleFocus = useCallback(() => {
    const next = !focus;
    setFocus(next);
    const room = roomRef.current;
    if (!room) return;
    if (next) room.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [focus]);

  // Leaving fullscreen by any route — Esc, the browser's own chrome — leaves
  // focus mode with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFocus(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const toggleOverlay = useCallback((key: keyof Omit<Overlays, 'colorBy'>) => {
    setOverlays(o => ({ ...o, [key]: !o[key] }));
  }, []);

  const benchBlurb = BENCHES.find(b => b.id === bench)?.blurb ?? '';
  const watched = snap.selected;

  // The plate heads the rack on desktop; stacked on a phone it rides above
  // the circuit instead.
  const plate = (
    <div className="border-b border-border">
      <div className="drs-checker" />
      <div className="px-3 pb-2.5 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
          RM 13 · Driving School
        </p>
        <h1 className="drs-display mt-1 text-[15px] font-normal uppercase leading-tight">
          Neuroevolution
        </h1>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Every car is a tiny neural network driving blind on a fan of
          rangefinders. Nobody teaches them the circuit — the timing sheet
          decides who breeds. Turn a dial and watch the field learn.
        </p>
      </div>
    </div>
  );

  const statBoard = (
    <div className="grid grid-cols-3 gap-2">
      <div className="drs-case px-2 py-1.5">
        <p className="drs-etch text-[8px]">Heat</p>
        <p className="drs-display mt-0.5 text-[15px] leading-none" style={{ color: 'var(--drs-flag)' }}>
          {String(snap.gen).padStart(3, '0')}
        </p>
        <p className="drs-readout mt-1 truncate text-[8px] text-muted-foreground">
          {snap.carried
            ? 'grid carried over'
            : snap.custom
              ? `hand-drawn · t ${snap.tick.toLocaleString()}`
              : `tick ${snap.tick.toLocaleString()}`}
        </p>
      </div>
      <div className="drs-case px-2 py-1.5">
        <p className="drs-etch text-[8px]">Best ever</p>
        <p
          className="drs-readout mt-0.5 text-[15px] leading-none"
          style={{ color: snap.recordLive ? 'var(--drs-purple)' : 'var(--drs-ink)' }}
        >
          {Math.round(snap.bestEver)}<span className="text-[9px] text-muted-foreground"> m</span>
        </p>
        <p className="drs-readout mt-1 truncate text-[8px] text-muted-foreground">
          {snap.bestEver > 0 ? `set in heat ${String(snap.bestEverGen).padStart(3, '0')}` : 'no distance yet'}
        </p>
      </div>
      <div className="drs-case px-2 py-1.5">
        <p className="drs-etch text-[8px]">On track</p>
        <p className="drs-readout mt-0.5 text-[15px] leading-none">
          {snap.alive}<span className="text-[9px] text-muted-foreground">/{snap.pop}</span>
        </p>
        <p className="drs-readout mt-1 truncate text-[8px] text-muted-foreground">
          flag in {Math.max(0, snap.budget - snap.tick).toLocaleString()} t
        </p>
      </div>
    </div>
  );

  // Focus mode keeps the same tree and only restyles the containers — moving a
  // canvas to a new parent would remount it and reset its observers.
  const cx = (normal: string, focused: string) => (focus ? focused : normal);

  return (
    <PageTransition>
      <div ref={roomRef} className="drs-theme drs-room flex flex-col lg:flex-row">
        {/* ── The set-up sheet: every rule of the session, as a dial ── */}
        <aside
          className={cx(
            'order-3 flex w-full shrink-0 flex-col border-t border-border lg:order-1 lg:w-[288px] lg:border-r lg:border-t-0 lg:overflow-y-auto',
            'hidden',
          )}
        >
          <div className="hidden lg:block">{plate}</div>
          <div className="pt-3">
            <Setups active={setup} onRun={runSetup} />
            <Rack params={params} onChange={applyParams} />
          </div>
        </aside>

        {/* ── The circuit and the bench ── */}
        <main
          className={cx(
            'order-1 flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3 lg:order-2 lg:min-h-0',
            'relative order-1 min-w-0 flex-1 overflow-hidden',
          )}
        >
          <div className={cx('-mx-3 -mt-3 mb-1 lg:hidden', 'hidden')}>{plate}</div>

          {/* Controls plate */}
          <div
            className={cx(
              'flex flex-wrap items-center gap-x-3 gap-y-2',
              'drs-float absolute left-3 top-3 z-20 flex w-[300px] flex-col items-stretch gap-2 px-2.5 py-2',
            )}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRunning(r => !r)}
                className="drs-chip flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                data-on={running}
              >
                {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {running ? 'Running' : 'Red flag'}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={stepOnce}
                    className="drs-chip flex h-7 w-7 items-center justify-center"
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
                    onClick={skipHeat}
                    className="drs-chip flex h-7 w-7 items-center justify-center"
                    aria-label="Skip to the end of this heat"
                  >
                    <FastForward className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-60">
                  Run the rest of this heat flat-out and breed the next one
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openReplay}
                    data-on={replayOpen}
                    className="drs-chip flex h-7 items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <Share2 className="h-3 w-3" />
                    Replay
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  Share this circuit, every dial, and both seeds as a season that restarts at tick zero.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => regrid()}
                    data-on={regridPending}
                    className="drs-chip flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Regrid
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {regridPending
                    ? 'A dial marked ↺ has changed. Regrid to rebuild the session with it.'
                    : 'Rebuild the session from the current dials and seed — fresh circuit, fresh brains.'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={newCircuit}
                    className="drs-chip flex h-7 w-7 items-center justify-center"
                    aria-label="Draw a fresh circuit"
                  >
                    <Route className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  Draw a fresh circuit and race the same grid on it — the transfer test.
                  Brains that learned corners survive; brains that memorised this track don&apos;t.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleDraw}
                    data-on={drawMode}
                    className="drs-chip flex h-7 w-7 items-center justify-center"
                    aria-label={drawMode ? 'Put the pen down' : 'Draw a circuit by hand'}
                  >
                    <PenLine className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {drawMode
                    ? 'Put the pen down and go back to racing'
                    : 'Draw a circuit by hand. Click to drop the start line, drag to paint the ribbon, cross the start again to close the loop — then the current grid races your track.'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleFocus}
                    data-on={focus}
                    className="drs-chip ml-auto flex h-7 w-7 items-center justify-center"
                    aria-label={focus ? 'Leave fullscreen' : 'Fill the screen with the circuit'}
                  >
                    {focus ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-60">
                  {focus
                    ? 'Bring the set-up sheet and the tower back (Esc)'
                    : 'Fill the screen with the circuit — the pit wall steps back, timing and telemetry float on the feed'}
                </TooltipContent>
              </Tooltip>
            </div>

            <RateControl rate={rate} onChange={setRate} compact={focus} />

            {replayOpen && (
              <div className="flex w-full flex-col gap-1.5 border-t border-border pt-1.5">
                <label
                  htmlFor="drs-replay-card"
                  className="text-[9px] font-semibold uppercase tracking-[0.18em] text-primary"
                >
                  Season replay card
                </label>
                <textarea
                  id="drs-replay-card"
                  value={replayText}
                  onChange={e => { setReplayText(e.target.value); setReplayMsg(null); }}
                  onFocus={e => e.currentTarget.select()}
                  rows={2}
                  spellCheck={false}
                  className="drs-readout min-h-12 w-full resize-none border border-border bg-background/70 px-2 py-1 text-[8px] leading-relaxed text-foreground outline-none focus:border-primary"
                  aria-label="Replay link or replay code"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={copyReplay}
                    className="drs-chip flex h-6 items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <ClipboardCopy className="h-3 w-3" /> Copy link
                  </button>
                  <button
                    type="button"
                    onClick={loadReplay}
                    className="drs-chip flex h-6 items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <Upload className="h-3 w-3" /> Load
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplayOpen(false)}
                    className="drs-chip ml-auto flex h-6 w-6 items-center justify-center"
                    aria-label="Close replay card"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {replayMsg && (
                  <p className="text-[9px] leading-relaxed text-muted-foreground" role="status">
                    {replayMsg}
                  </p>
                )}
              </div>
            )}

            {/* The drafting table's own controls ride with the pen. */}
            {drawMode && (
              <div className={cx('flex w-full flex-wrap items-center gap-x-3 gap-y-1.5', 'flex flex-col items-stretch gap-1.5 border-t border-border pt-1.5')}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => circuitRef.current?.closeDraft()}
                    className="drs-chip flex h-6 items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <Check className="h-3 w-3" /> Close loop
                  </button>
                  <button
                    type="button"
                    onClick={() => { circuitRef.current?.scrapDraft(); setDraftMsg(null); }}
                    className="drs-chip flex h-6 items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <Eraser className="h-3 w-3" /> Scrap
                  </button>
                  <button
                    type="button"
                    onClick={toggleDraw}
                    className="drs-chip flex h-6 items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
                <p
                  className="max-w-[340px] text-[9px] leading-relaxed"
                  style={{ color: draftMsg ? 'var(--drs-crash)' : 'var(--drs-dim)' }}
                >
                  {draftMsg
                    ?? 'Click to drop the start line, then drag to paint the ribbon. Cross the start again — or press Close loop — and the grid races your circuit.'}
                </p>
              </div>
            )}

            {/* In focus the stat board is gone, so its numbers come along. */}
            {focus && (
              <div className="flex items-baseline gap-3 border-t border-border pt-1.5">
                <span className="drs-display text-[12px] leading-none" style={{ color: 'var(--drs-flag)' }}>
                  H{String(snap.gen).padStart(3, '0')}
                </span>
                <span
                  className="drs-readout text-[12px] leading-none"
                  style={{ color: snap.recordLive ? 'var(--drs-purple)' : undefined }}
                >
                  {Math.round(snap.bestEver)} m
                </span>
                <span className="drs-readout text-[12px] leading-none text-muted-foreground">
                  {snap.alive}/{snap.pop}
                </span>
                <span className="drs-readout ml-auto text-[10px] text-muted-foreground">
                  tick {snap.tick.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Overlay / camera plate */}
          <div
            className={cx(
              'flex flex-wrap items-center gap-x-3 gap-y-1',
              'drs-float absolute right-3 top-3 z-20 flex w-[300px] flex-col items-stretch gap-1.5 px-2 py-2',
            )}
          >
            <div className={cx('flex flex-wrap items-center gap-1', 'flex flex-wrap items-center gap-1')}>
              {OVERLAY_CHIPS.map(c => (
                <Tooltip key={c.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleOverlay(c.key)}
                      data-on={overlays[c.key]}
                      className="drs-chip h-[20px] px-1.5 text-[9px] font-medium"
                    >
                      {c.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-60">{c.hint}</TooltipContent>
                </Tooltip>
              ))}
              <span className="mx-0.5 h-4 w-px bg-border" />
              {(['chase', 'circuit'] as CamMode[]).map(m => (
                <Tooltip key={m}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setCamMode(m)}
                      data-on={camMode === m}
                      className="drs-chip h-[20px] px-1.5 text-[9px] font-medium capitalize"
                    >
                      {m}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-60">
                    {m === 'chase' ? 'Camera hunts the leader.' : 'The whole circuit in frame.'}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div className={cx('flex flex-wrap items-center gap-1', 'flex flex-wrap items-center gap-1 border-t border-border pt-1.5')}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="drs-etch mr-0.5 cursor-help text-[9px]">Colour by</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  Paint the field by one number instead of team steel. The leader always wears
                  orange — purple when it&apos;s driving a record.
                </TooltipContent>
              </Tooltip>
              {COLOR_BY.map(c => (
                <Tooltip key={c.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setOverlays(o => ({ ...o, colorBy: c.key }))}
                      data-on={overlays.colorBy === c.key}
                      className="drs-chip h-[20px] px-1.5 text-[9px] font-medium"
                    >
                      {c.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-60">{c.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            {/* Focus keeps a five-row tower on the glass. */}
            {focus && (
              <div className="border-t border-border pt-1">
                <Tower
                  rows={snap.rows}
                  tick={snap.tick}
                  budget={snap.budget}
                  recordLive={snap.recordLive}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  compact
                />
              </div>
            )}
          </div>

          <div className={cx('min-h-[220px] flex-1', 'absolute inset-0 z-0')}>
            <Circuit
              ref={circuitRef}
              session={sessionRef}
              overlays={overlays}
              camMode={camMode}
              selectedId={selectedId}
              onSelect={setSelectedId}
              drawMode={drawMode}
              draftWidth={draftWidth}
              onDraftComplete={handleDraftComplete}
            />
          </div>

          {/* The telemetry recorder: three pens on the leader. */}
          <div
            className={cx(
              'drs-case h-[98px] shrink-0 overflow-hidden',
              'drs-float absolute bottom-3 left-3 right-3 z-20 h-[92px] overflow-hidden xl:right-[476px]',
            )}
          >
            <Telemetry ref={telemetryRef} session={sessionRef} />
          </div>

          {/* The bench: one deep instrument at a time. */}
          <div
            className={cx(
              'drs-case flex h-[210px] shrink-0 flex-col overflow-hidden',
              'drs-float absolute bottom-3 right-3 z-20 hidden h-[196px] w-[460px] flex-col overflow-hidden xl:flex',
            )}
          >
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              {BENCHES.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBench(b.id)}
                  data-on={bench === b.id}
                  className="drs-chip h-[20px] px-1.5 text-[9px] font-medium"
                >
                  {b.label}
                </button>
              ))}
              <p className="ml-auto hidden whitespace-nowrap text-[9px] text-muted-foreground xl:block">
                {benchBlurb}
              </p>
            </div>
            <div className="min-h-0 flex-1 p-2">
              {bench === 'progress' && <Progress ref={benchRef} session={sessionRef} />}
              {bench === 'attrition' && <Attrition ref={benchRef} session={sessionRef} />}
              {bench === 'diversity' && <Diversity ref={benchRef} session={sessionRef} />}
              {bench === 'weights' && <Weights ref={benchRef} session={sessionRef} />}
            </div>
          </div>
        </main>

        {/* ── The pit wall: timing and the brain monitor ── */}
        <aside
          className={cx(
            'order-2 flex w-full shrink-0 flex-col gap-2 border-t border-border p-3 lg:order-3 lg:w-[300px] lg:border-l lg:overflow-y-auto',
            watched
              ? 'absolute bottom-[116px] left-3 z-20 flex w-[300px] flex-col'
              : 'hidden',
          )}
        >
          <div className={cx('contents', 'hidden')}>
            {statBoard}
            <div className="drs-case flex min-h-[180px] flex-1 flex-col overflow-hidden py-1.5">
              <Tower
                rows={snap.rows}
                tick={snap.tick}
                budget={snap.budget}
                recordLive={snap.recordLive}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </div>

          {/* The brain monitor watches the selection, else the leader. */}
          <div className={cx('drs-case flex h-[240px] shrink-0 flex-col overflow-hidden', 'drs-float flex h-[240px] shrink-0 flex-col overflow-hidden')}>
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <span className="drs-etch">Brain monitor</span>
              <span className="drs-readout ml-auto text-[9px] text-muted-foreground">
                {watched
                  ? `car ${String(watched.id + 1).padStart(2, '0')} · P${watched.pos} · ${Math.round(watched.metres)} m`
                  : 'following the leader'}
              </span>
              {watched && (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="drs-chip flex h-[18px] w-[18px] items-center justify-center"
                  aria-label="Release the selection"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 p-1.5">
              <Brain ref={brainRef} session={sessionRef} watchId={selectedId} />
            </div>
            <p className="border-t border-border px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
              Wires are the genome itself: <span style={{ color: 'var(--drs-flag)' }}>orange</span> excites,{' '}
              <span style={{ color: 'var(--drs-steer)' }}>indigo</span> inhibits; brightness is the
              signal flowing right now. Click any car — or tower row — to watch it think.
            </p>
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}
