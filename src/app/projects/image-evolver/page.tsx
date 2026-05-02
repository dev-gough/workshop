'use client';

import ImageEvolver from '@/components/ImageEvolver';
import PageTransition from '@/components/motion/PageTransition';

export default function ImageEvolverPage() {
  return (
    <PageTransition>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] p-6">
        <div className="mb-3 shrink-0">
          <h1 className="text-2xl font-bold">Image Evolver</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evolve semi-transparent polygons to approximate a target image using a genetic algorithm.
          </p>
        </div>
        <ImageEvolver />
      </div>
    </PageTransition>
  );
}
