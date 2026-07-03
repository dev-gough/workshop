'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

// ── Background: Matrix Rain ─────────────────────────────────────
export function MatrixRainBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const fontSize = 14;
    const cols = Math.ceil(width / fontSize);
    const drops = new Float32Array(cols);
    for (let i = 0; i < cols; i++) drops[i] = Math.random() * -100;

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
    const isDark = theme === 'dark';

    let raf: number;
    let lastTick = 0;

    const draw = (t: number) => {
      if (t - lastTick > 50) {
        lastTick = t;
        ctx.fillStyle = isDark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < cols; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          // Head character brighter
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = isDark
            ? `rgba(80,200,120,0.25)`
            : `rgba(0,80,20,0.35)`;
          ctx.fillText(char, x, y);

          if (y > height && Math.random() > 0.98) {
            drops[i] = 0;
          }
          drops[i] += 0.5 + Math.random() * 0.5;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
