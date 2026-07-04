'use client';

import { useState } from 'react';
import GameOfLife from '@/components/GameOfLife';
import GolCensus from '@/components/GolCensus';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';

type Tab = 'board' | 'census';

const TABS: { id: Tab; label: string }[] = [
  { id: 'board', label: 'The Board' },
  { id: 'census', label: 'The Census' },
];

export default function GameOfLifePage() {
  // Recolor the global header to match the seminar room.
  useHeaderConfig({ scopeClass: 'gol-theme' });

  const [tab, setTab] = useState<Tab>('board');
  // Once visited, the census stays mounted (hidden) so a deep multi-core run
  // keeps crunching while the visitor is back on the board.
  const [censusVisited, setCensusVisited] = useState(false);
  const selectTab = (t: Tab) => {
    if (t === 'census') setCensusVisited(true);
    setTab(t);
  };

  return (
    <PageTransition>
      <div className="gol-theme relative overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>
        {/* The board stays mounted across tabs — the engine's state lives here.
            Hidden (not unmounted) while the census is open. */}
        <div className={tab === 'board' ? 'absolute inset-0' : 'hidden'}>
          <GameOfLife />
        </div>

        {censusVisited && (
          <div className={tab === 'census' ? 'absolute inset-0 overflow-y-auto' : 'hidden'}>
            <div className="mx-auto max-w-5xl px-4 pb-14 pt-28 sm:px-6">
              <GolCensus />
            </div>
          </div>
        )}

        {/* Title plate — floats over both tabs */}
        <div className="gol-panel absolute left-3 top-3 z-30 px-4 pb-2.5 pt-3 sm:left-4 sm:top-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            RM 06 · Conway&apos;s Blackboard
          </p>
          <h1 className="ws-serif mt-0.5 text-xl font-semibold leading-tight sm:text-2xl">
            Game of Life{' '}
            <span className="gol-readout align-middle text-[11px] font-normal text-muted-foreground">
              B3/S23
            </span>
          </h1>
          <div className="mt-2 flex items-center gap-4 border-t border-border/60 pt-1.5">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={`border-b-2 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
