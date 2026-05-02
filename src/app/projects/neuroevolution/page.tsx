'use client';

import Neuroevolution from '@/components/Neuroevolution';
import PageTransition from '@/components/motion/PageTransition';

export default function NeuroevolutionPage() {
  return (
    <PageTransition>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] p-6">
        <div className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold">Neuroevolution</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evolve neural networks to drive cars around a procedural track. Natural selection meets machine learning.
          </p>
        </div>
        <Neuroevolution />
      </div>
    </PageTransition>
  );
}
