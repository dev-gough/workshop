'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

// ── Background: Apollonian Gasket ───────────────────────────────
export function ApollonianBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    const cx = width / 2, cy = height / 2;

    interface Circle { x: number; y: number; r: number; depth: number; }
    const circles: Circle[] = [];

    // Generate Apollonian gasket
    function descartes(k1: number, k2: number, k3: number): number {
      return k1 + k2 + k3 + 2 * Math.sqrt(k1 * k2 + k2 * k3 + k1 * k3);
    }

    function apollonian(
      c1: Circle, c2: Circle, c3: Circle, depth: number, maxDepth: number
    ) {
      if (depth > maxDepth) return;
      const k1 = 1 / c1.r, k2 = 1 / c2.r, k3 = 1 / c3.r;
      const k4 = descartes(k1, k2, k3);
      if (k4 <= 0 || 1 / k4 < 2) return;

      // Approximate position using weighted average
      const r4 = 1 / k4;
      const totalK = k1 + k2 + k3;
      const x4 = (c1.x * k1 + c2.x * k2 + c3.x * k3) / totalK;
      const y4 = (c1.y * k1 + c2.y * k2 + c3.y * k3) / totalK;

      const newCircle = { x: x4, y: y4, r: r4, depth };
      circles.push(newCircle);

      apollonian(c1, c2, newCircle, depth + 1, maxDepth);
      apollonian(c1, c3, newCircle, depth + 1, maxDepth);
      apollonian(c2, c3, newCircle, depth + 1, maxDepth);
    }

    const R = Math.min(width, height) * 0.42;
    const outerCircle: Circle = { x: cx, y: cy, r: R, depth: 0 };
    circles.push(outerCircle);

    // Three inner circles tangent to outer and each other
    const r = R / (1 + 2 / Math.sqrt(3));
    const innerCircles: Circle[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      innerCircles.push({
        x: cx + (R - r) * Math.cos(angle),
        y: cy + (R - r) * Math.sin(angle),
        r: r,
        depth: 1,
      });
    }
    circles.push(...innerCircles);

    apollonian(innerCircles[0], innerCircles[1], innerCircles[2], 2, 6);

    // Animate with slow rotation
    let angle = 0;
    let raf: number;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      angle += 0.001;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);

      for (const c of circles) {
        const hue = (c.depth * 45 + angle * 50) % 360;
        const alpha = isDark
          ? Math.max(0.04, 0.2 - c.depth * 0.025)
          : Math.max(0.03, 0.12 - c.depth * 0.015);

        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(c.r, 1), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue},50%,${isDark ? 60 : 40}%,${alpha})`;
        ctx.lineWidth = Math.max(0.5, 2 - c.depth * 0.3);
        ctx.stroke();
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
