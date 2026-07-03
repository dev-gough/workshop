'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

// ── Background: Starfield ───────────────────────────────────────
export function StarfieldBackground({ width, height }: { width: number; height: number }) {
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

    const NUM_STARS = 400;
    const stars = Array.from({ length: NUM_STARS }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: Math.random() * 0.01 + 0.001,
      speed: Math.random() * 0.3 + 0.1,
      size: Math.random() * 1.5 + 0.5,
      brightness: Math.random() * 0.5 + 0.3,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const isDark = theme === 'dark';

      for (const star of stars) {
        star.dist += star.speed * 0.002;
        star.angle += 0.001;
        if (star.dist > 1.5) {
          star.dist = Math.random() * 0.01 + 0.001;
          star.angle = Math.random() * Math.PI * 2;
        }

        const maxDim = Math.max(width, height);
        const x = cx + Math.cos(star.angle) * star.dist * maxDim;
        const y = cy + Math.sin(star.angle) * star.dist * maxDim;

        const alpha = Math.min(star.dist * 2, 1) * star.brightness * (isDark ? 0.7 : 0.4);
        const sz = star.size * (0.5 + star.dist * 2);

        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(180,200,240,${alpha})`
          : `rgba(60,80,140,${alpha})`;
        ctx.fill();

        // Streak for fast-moving distant stars
        if (star.dist > 0.3) {
          const streakLen = star.speed * star.dist * 15;
          const sx = x - Math.cos(star.angle) * streakLen;
          const sy = y - Math.sin(star.angle) * streakLen;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(x, y);
          ctx.strokeStyle = isDark
            ? `rgba(180,200,240,${alpha * 0.4})`
            : `rgba(60,80,140,${alpha * 0.3})`;
          ctx.lineWidth = sz * 0.5;
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
