'use client';

import GameOfLife from '@/components/GameOfLife';
import PageTransition from '@/components/motion/PageTransition';

export default function GameOfLifePage() {
  return (
    <PageTransition>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] p-6">
        <div className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold">Game of Life</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conway&apos;s cellular automaton. Draw cells, load patterns, and watch life evolve.
          </p>
        </div>
        <GameOfLife />
      </div>
    </PageTransition>
  );
}
