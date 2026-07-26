'use client';

import { useEffect, useRef } from 'react';
import { useDomeTheme } from './dome';

// ── Background: Koch Snowflake ───────────────────────────────────
export function KochBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useDomeTheme();
  const depthRef = useRef(0);
  const growingRef = useRef(true);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Koch curve subdivision
    function kochPoints(p1: [number, number], p2: [number, number], depth: number): [number, number][] {
      if (depth === 0) return [p1, p2];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const a: [number, number] = [p1[0] + dx / 3, p1[1] + dy / 3];
      const b: [number, number] = [p1[0] + 2 * dx / 3, p1[1] + 2 * dy / 3];
      const peak: [number, number] = [
        (p1[0] + p2[0]) / 2 - dy * Math.sqrt(3) / 6,
        (p1[1] + p2[1]) / 2 + dx * Math.sqrt(3) / 6,
      ];
      return [
        ...kochPoints(p1, a, depth - 1),
        ...kochPoints(a, peak, depth - 1),
        ...kochPoints(peak, b, depth - 1),
        ...kochPoints(b, p2, depth - 1),
      ];
    }

    function snowflakePoints(cx: number, cy: number, radius: number, depth: number): [number, number][] {
      // Equilateral triangle vertices
      const v: [number, number][] = [];
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        v.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
      const pts: [number, number][] = [];
      for (let i = 0; i < 3; i++) {
        pts.push(...kochPoints(v[i], v[(i + 1) % 3], depth));
      }
      return pts;
    }

    const isDark = theme === 'dark';
    const strokeColor = isDark ? 'rgba(120,160,220,0.15)' : 'rgba(60,100,160,0.1)';
    const fillColor = isDark ? 'rgba(100,140,200,0.04)' : 'rgba(60,100,160,0.03)';

    let raf: number;
    const draw = (t: number) => {
      if (t - lastTickRef.current > 2000) {
        lastTickRef.current = t;
        if (growingRef.current) {
          depthRef.current++;
          if (depthRef.current >= 6) growingRef.current = false;
        } else {
          depthRef.current--;
          if (depthRef.current <= 0) growingRef.current = true;
        }
      }

      ctx.clearRect(0, 0, width, height);
      const r = Math.min(width, height) * 0.45;
      const pts = snowflakePoints(width / 2, height / 2, r, depthRef.current);

      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
