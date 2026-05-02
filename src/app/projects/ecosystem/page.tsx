'use client';

import EcosystemSim from '@/components/EcosystemSim';
import PageTransition from '@/components/motion/PageTransition';

export default function EcosystemPage() {
  return (
    <PageTransition>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] p-6">
        <div className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold">Ecosystem Sim</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Predator-prey co-evolution. Observe emergent behaviors as species adapt competing survival strategies.
          </p>
        </div>
        <EcosystemSim />
      </div>
    </PageTransition>
  );
}
