'use client';

import { useEffect, useRef } from 'react';
import { useDomeTheme } from './dome';

// ── Background: Lissajous Curves ────────────────────────────────
export function LissajousBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useDomeTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const isDark = theme === 'dark';
    let t = 0;
    let raf: number;

    const draw = () => {
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, width, height);

      const numCurves = 3;
      for (let c = 0; c < numCurves; c++) {
        const freqX = 3 + c * 2 + Math.sin(t * 0.1 + c) * 0.5;
        const freqY = 2 + c * 2 + Math.cos(t * 0.13 + c) * 0.5;
        const phase = t * 0.3 + c * Math.PI / 3;
        const radius = Math.min(width, height) * (0.3 + c * 0.05);

        ctx.beginPath();
        const hue = (c * 120 + t * 10) % 360;
        const alpha = isDark ? 0.15 : 0.1;
        ctx.strokeStyle = `hsla(${hue},70%,${isDark ? 60 : 40}%,${alpha})`;
        ctx.lineWidth = 1.5;

        for (let i = 0; i <= 500; i++) {
          const s = (i / 500) * Math.PI * 2;
          const x = cx + Math.sin(freqX * s + phase) * radius;
          const y = cy + Math.sin(freqY * s) * radius * (height / width);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      t += 0.005;
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
