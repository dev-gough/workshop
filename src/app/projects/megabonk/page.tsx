'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { type Build, defaultBuild, analyze } from './_lib/model';
import { decodeBuild, encodeBuild } from './_lib/share';
import { ImpactHero, DamageBar, ContributionList, BracketLadder } from './_components/viz';
import { ItemRoster, StatControls, Switch } from './_components/controls';
import { applyLiveSnapshot, type LiveSnapshot } from './_lib/live';
import { useMegabonkLive, type LiveStatus } from './_lib/use-live';
import { LiveRun, type DpsPoint } from './_components/live-run';

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
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [dpsHistory, setDpsHistory] = useState<DpsPoint[]>([]);
  const [view, setView] = useState<'run' | 'model'>('run');
  const followRef = useRef(true);
  followRef.current = followGame;
  const set = (patch: Partial<Build>) => setBuild(b => ({ ...b, ...patch }));
  const a = useMemo(() => analyze(build), [build]);

  const onSnapshot = useCallback((next: LiveSnapshot) => {
    setSnap(next);
    setInRun(next.inRun);
    const damage = next.inRun ? next.stats?.damageMultiplier : undefined;
    setLiveDamage(typeof damage === 'number' && Number.isFinite(damage) ? damage : null);
    if (!next.inRun) {
      setDpsHistory([]);
    } else if (typeof next.dps === 'number' && Number.isFinite(next.dps)) {
      const t = next.t / 1000;
      setDpsHistory(history => {
        const point = { t, dps: next.dps as number };
        if (history.length > 0 && t - history[history.length - 1].t < 0.25) {
          const copy = history.slice();
          copy[copy.length - 1] = point;
          return copy;
        }
        const copy = history.concat(point);
        return copy.length > 720 ? copy.slice(copy.length - 720) : copy;
      });
    }
    if (!followRef.current || !next.inRun) return;
    setBuild(current => applyLiveSnapshot(current, next));
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
      <div className="megabonk-theme flex h-[calc(100vh-57px)] flex-col overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-[1680px] flex-col px-4 py-3 sm:px-5">
          <div className="flex shrink-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">RM 15 · Damage Foundry</p>
              <h1 className="ws-serif truncate text-2xl font-semibold leading-tight">
                Megabonk <span className="mb-molten">Damage</span>
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <LiveLink status={live.status} httpsPage={live.httpsPage} inRun={inRun} />
              <div className="mb-plate flex p-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]">
                <button
                  onClick={() => setView('run')}
                  className={`rounded px-2.5 py-1 ${view === 'run' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >Run</button>
                <button
                  onClick={() => setView('model')}
                  className={`rounded px-2.5 py-1 ${view === 'model' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >Model</button>
              </div>
            </div>
          </div>

          {view === 'run' ? (
            <div className="mt-2 min-h-0 flex-1">
              {snap && inRun ? (
                <LiveRun snap={snap} history={dpsHistory} />
              ) : (
                <div className="mb-plate grid h-full place-items-center px-6 text-center">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {live.status === 'live' ? 'In the menu. The run fills this screen once it starts.' : 'Waiting for the game on this PC.'}
                    </p>
                    {live.httpsPage && live.status !== 'live' && (
                      <p className="mt-2 text-[11px] text-muted-foreground">Open the workshop over http so the browser can reach the local game socket.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              <div className="mb-3 flex flex-wrap items-center justify-end gap-3 text-xs">
                <label className="flex items-center gap-2 text-muted-foreground">
                  Attack speed in total
                  <Switch on={build.includeAttackSpeed} onChange={v => set({ includeAttackSpeed: v })} label="Attack speed in total" />
                </label>
                <label className="flex items-center gap-2 text-muted-foreground">
                  Target is an Elite
                  <Switch on={build.targetElite} onChange={v => set({ targetElite: v })} label="Target is an Elite" />
                </label>
                <label className="flex items-center gap-2 text-muted-foreground">
                  Follow the game
                  <Switch on={followGame} onChange={setFollowGame} label="Follow the game" />
                </label>
                <button onClick={() => void share()} className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:border-primary hover:text-primary">
                  {shared ? 'Copied' : 'Share'}
                </button>
                <button onClick={() => setBuild(defaultBuild())} className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:border-primary hover:text-primary">
                  Reset
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,380px)]">
                <div className="space-y-4">
                  <ImpactHero a={a} liveDamage={liveDamage} />
                  <DamageBar a={a} />
                  <BracketLadder a={a} />
                  <ContributionList a={a} />
                </div>
                <div className="space-y-4">
                  <ItemRoster build={build} set={set} />
                  <StatControls build={build} set={set} />
                  <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                    Item constants and the crit curve are from lukeod/megabonk_research
                    (IL2CPP constructors and GetCritDamageMultiplier, 2026-01-28).
                    Joe&apos;s Dagger growth cap of +200% per copy per minute is the v1.0.12
                    patch note. Character passives and Demonic Soul&apos;s per-kill amount are not
                    in that dump. Conditional items add nothing until their switch is on.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
