'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

// ── Background: Ripples ─────────────────────────────────────────
export function RipplesBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const isDark = theme === 'dark';

    interface Ripple {
      x: number; y: number; birth: number; speed: number;
    }
    const ripples: Ripple[] = [];
    let lastSpawn = 0;

    let raf: number;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // Spawn new ripple periodically
      if (t - lastSpawn > 1800 + Math.random() * 1200) {
        lastSpawn = t;
        ripples.push({
          x: cx + (Math.random() - 0.5) * width * 0.6,
          y: cy + (Math.random() - 0.5) * height * 0.6,
          birth: t,
          speed: 0.08 + Math.random() * 0.04,
        });
      }

      // Draw ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        const age = (t - rip.birth) * rip.speed;
        const maxAge = Math.max(width, height) * 0.8;

        if (age > maxAge) { ripples.splice(i, 1); continue; }

        const numRings = 4;
        for (let r = 0; r < numRings; r++) {
          const radius = age - r * 25;
          if (radius < 0) continue;
          const fadeIn = Math.min(radius / 30, 1);
          const fadeOut = Math.max(0, 1 - age / maxAge);
          const alpha = fadeIn * fadeOut * (1 - r * 0.2) * (isDark ? 0.2 : 0.3);

          ctx.beginPath();
          ctx.arc(rip.x, rip.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = isDark
            ? `rgba(120,170,230,${alpha})`
            : `rgba(30,70,160,${alpha})`;
          ctx.lineWidth = isDark ? 1.5 - r * 0.3 : 2 - r * 0.3;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
