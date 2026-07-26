'use client';

import { useEffect, useRef } from 'react';
import { useDomeTheme } from './dome';

// ── Background: Voronoi Cells ───────────────────────────────────
export function VoronoiBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useDomeTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Use lower resolution for performance
    const scale = 3;
    const w = Math.ceil(width / scale);
    const h = Math.ceil(height / scale);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;

    const NUM_SEEDS = 20;
    const seeds = Array.from({ length: NUM_SEEDS }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      hue: Math.random() * 360,
    }));

    const isDark = theme === 'dark';
    let raf: number;
    let lastTick = 0;

    const draw = (t: number) => {
      if (t - lastTick < 80) { raf = requestAnimationFrame(draw); return; }
      lastTick = t;

      // Move seeds
      for (const s of seeds) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0 || s.x > w) s.vx *= -1;
        if (s.y < 0 || s.y > h) s.vy *= -1;
        s.hue += 0.1;
      }

      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          let minDist = Infinity;
          let minDist2 = Infinity;
          let closest = 0;

          for (let i = 0; i < NUM_SEEDS; i++) {
            const dx = px - seeds[i].x, dy = py - seeds[i].y;
            const d = dx * dx + dy * dy;
            if (d < minDist) { minDist2 = minDist; minDist = d; closest = i; }
            else if (d < minDist2) { minDist2 = d; }
          }

          const edge = Math.sqrt(minDist2) - Math.sqrt(minDist);
          const idx = (py * w + px) * 4;

          if (edge < 2) {
            // Edge line
            const a = isDark ? 40 : 25;
            data[idx] = isDark ? 150 : 80;
            data[idx + 1] = isDark ? 170 : 100;
            data[idx + 2] = isDark ? 200 : 140;
            data[idx + 3] = a;
          } else {
            // Cell fill
            const hue = seeds[closest].hue % 360;
            const a = isDark ? 12 : 8;
            // Simple hue to RGB
            const h60 = hue / 60;
            const x = 1 - Math.abs(h60 % 2 - 1);
            let r = 0, g = 0, b = 0;
            if (h60 < 1) { r = 1; g = x; }
            else if (h60 < 2) { r = x; g = 1; }
            else if (h60 < 3) { g = 1; b = x; }
            else if (h60 < 4) { g = x; b = 1; }
            else if (h60 < 5) { r = x; b = 1; }
            else { r = 1; b = x; }
            data[idx] = r * 200;
            data[idx + 1] = g * 200;
            data[idx + 2] = b * 200;
            data[idx + 3] = a;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: width, height: height, imageRendering: 'auto' }} />;
}
