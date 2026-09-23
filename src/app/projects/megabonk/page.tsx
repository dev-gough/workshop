'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import { type Build, defaultBuild, analyze } from './_lib/model';
import { decodeBuild, encodeBuild } from './_lib/share';
import { ImpactHero, DamageBar, ContributionList, BracketLadder } from './_components/viz';
import { CharacterPicker, ItemRoster, StatControls, Switch } from './_components/controls';
import { applyLiveSnapshot, type LiveSnapshot } from './_lib/live';
import { useMegabonkLive, type LiveStatus } from './_lib/use-live';

function LiveLink({ status, httpsPage, inRun }: { status: LiveStatus; httpsPage: boolean; inRun: boolean }) {
  const label = status === 'live'
    ? (inRun ? 'Game linked · in a run' : 'Game linked · in the menu')
    : status === 'connecting' ? 'Looking for the game' : 'Game offline';
  const dot = status === 'live' ? 'bg-primary' : status === 'connecting' ? 'bg-primary/50' : 'bg-border';
  return (
    <div className="mt-0.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </p>
      {httpsPage && status !== 'live' && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          This page is https, so the browser blocks the local game socket. Open the workshop over http, or run it on this PC.
        </p>
      )}
    </div>
  );
}

export default function MegabonkPage() {
  useHeaderConfig({ scopeClass: 'megabonk-theme' });

  const [build, setBuild] = useState<Build>(defaultBuild);
  const [shared, setShared] = useState(false);
  const [followGame, setFollowGame] = useState(true);
  const [liveDamage, setLiveDamage] = useState<number | null>(null);
  const [inRun, setInRun] = useState(false);
  const followRef = useRef(true);
  followRef.current = followGame;
  const set = (patch: Partial<Build>) => setBuild(b => ({ ...b, ...patch }));
  const a = useMemo(() => analyze(build), [build]);

  const onSnapshot = useCallback((snap: LiveSnapshot) => {
    setInRun(snap.inRun);
    const damage = snap.inRun ? snap.stats?.damageMultiplier : undefined;
    setLiveDamage(typeof damage === 'number' && Number.isFinite(damage) ? damage : null);
    if (!followRef.current || !snap.inRun) return;
    setBuild(current => applyLiveSnapshot(current, snap));
  }, []);
  const live = useMegabonkLive(onSnapshot);

  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get('build');
    const restored = encoded ? decodeBuild(encoded) : null;
    if (restored) setBuild(restored);
  }, []);

  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('build', encodeBuild(build));
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      setShared(false);
    }
  };

  return (
    <PageTransition>
      <div className="megabonk-theme min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

          {/* ── Masthead ── */}
          <FadeIn>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                  RM 15 · Damage Foundry
                </p>
                <h1 className="ws-serif mt-0.5 text-4xl font-semibold tracking-tight sm:text-5xl">
                  Megabonk <span className="mb-molten">Damage</span>
                </h1>
                <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                  Build a loadout and see exactly what percentage of your damage each
                  tome, character, item and stat is really pulling.
                </p>
              </div>

              {/* Global scenario toggles */}
              <div className="mb-plate flex flex-col gap-2 px-3.5 py-2.5 text-xs">
                <label className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Attack speed in total</span>
                  <Switch on={build.includeAttackSpeed} onChange={v => set({ includeAttackSpeed: v })} label="Attack speed in total" />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Target is an Elite</span>
                  <Switch on={build.targetElite} onChange={v => set({ targetElite: v })} label="Target is an Elite" />
                </label>
                <label className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Follow the game</span>
                  <Switch on={followGame} onChange={setFollowGame} label="Follow the game" />
                </label>
                <LiveLink status={live.status} httpsPage={live.httpsPage} inRun={inRun} />
                <div className="mt-0.5 grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => void share()}
                    className="flex items-center justify-center gap-1 rounded-md border border-border py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    {shared ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                    {shared ? 'Copied' : 'Share'}
                  </button>
                  <button
                    onClick={() => setBuild(defaultBuild())}
                    className="rounded-md border border-border py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* ── Two columns: the readout, and the build ── */}
          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_minmax(320px,380px)]">

            {/* Left — the visualization */}
            <FadeIn delay={0.05}>
              <div className="space-y-4">
                <ImpactHero a={a} liveDamage={liveDamage} />
                <DamageBar a={a} />
                <BracketLadder a={a} />
                <ContributionList a={a} />
              </div>
            </FadeIn>

            {/* Right — the build controls */}
            <FadeIn delay={0.1}>
              <div className="space-y-4">
                <CharacterPicker build={build} set={set} />
                <ItemRoster build={build} set={set} />
                <StatControls build={build} set={set} />
                <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                  Item percents and the crit curve are from the IL2CPP item constructors
                  and the verified crit function (lukeod/megabonk_research, 2026-01-28).
                  Character passives and Demonic Soul&apos;s per-kill number were not in
                  that dump. Conditional items are counted as if their condition is true
                  right now. With the bridge mod running, Follow the game copies the
                  live stats in at 5 Hz.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
