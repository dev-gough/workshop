'use client';

import { useEffect, useRef } from 'react';
import { useDomeTheme } from './dome';

// ── Background: Sine Wave Interference ──────────────────────────
export function SineWaveBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useDomeTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    let t = 0;
    let raf: number;

    const numWaves = 5;
    const waves = Array.from({ length: numWaves }, (_, i) => ({
      amplitude: 30 + i * 15,
      frequency: 0.005 + i * 0.003,
      speed: 0.02 + i * 0.008,
      phase: (i * Math.PI * 2) / numWaves,
      yOffset: (i + 1) * (height / (numWaves + 1)),
      hue: i * 60,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      t += 0.016;

      for (const wave of waves) {
        ctx.beginPath();
        const alpha = isDark ? 0.12 : 0.08;
        ctx.strokeStyle = `hsla(${(wave.hue + t * 15) % 360},60%,${isDark ? 55 : 40}%,${alpha})`;
        ctx.lineWidth = 2;

        for (let x = 0; x <= width; x += 2) {
          let y = wave.yOffset;
          // Interference from all other waves
          for (const w2 of waves) {
            y += w2.amplitude * Math.sin(x * w2.frequency + t * w2.speed + w2.phase);
          }
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill below wave
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = `hsla(${(wave.hue + t * 15) % 360},60%,${isDark ? 55 : 40}%,${isDark ? 0.02 : 0.015})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
