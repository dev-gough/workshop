'use client';

import { useState } from 'react';
import GameOfLife from '@/components/GameOfLife';
import GolCensus from '@/components/GolCensus';
import PageTransition from '@/components/motion/PageTransition';

type Tab = 'sim' | 'census';

export default function GameOfLifePage() {
  const [tab, setTab] = useState<Tab>('sim');

  return (
    <PageTransition>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] p-6">
        <div className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold">Game of Life</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conway&apos;s cellular automaton. Draw cells, load patterns, and watch life evolve.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-3 p-1 bg-muted/30 rounded-lg border border-border/40 w-fit shrink-0">
          {([
            { id: 'sim', label: 'Simulator' },
            { id: 'census', label: 'Census' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Simulator keeps its canvas mounted (heavy state) — hide instead of unmount */}
        <div className={tab === 'sim' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          <GameOfLife />
        </div>
        {tab === 'census' && (
          <div className="flex-1 min-h-0 overflow-auto pr-1">
            <GolCensus />
          </div>
        )}
      </div>
    </PageTransition>
  );
}
