'use client';

import GameOfLife from '@/components/GameOfLife';
import PageTransition from '@/components/motion/PageTransition';
import { useEffect, useState } from 'react';

export default function GameOfLifePage() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth - 32,
        height: window.innerHeight - 200,
      });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  return (
    <PageTransition>
      <div className="flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold mb-4">Game of Life</h1>
        <GameOfLife width={dimensions.width} height={dimensions.height} cellSize={8} />
      </div>
    </PageTransition>
  );
}
