'use client';

import { useEffect, useRef } from 'react';
import { useDomeTheme } from './dome';

// ── Background: Particle Flow (Perlin noise) ────────────────────
export function ParticleFlowBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useDomeTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Simple hash-based noise
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];

    function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a: number, b: number, t: number) { return a + t * (b - a); }
    function grad(hash: number, x: number, y: number) {
      const h = hash & 3;
      const u = h < 2 ? x : y;
      const v = h < 2 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    function noise(x: number, y: number) {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
      const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
      return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
                  lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
    }

    const NUM = 600;
    const particles = Array.from({ length: NUM }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      life: Math.random() * 200 + 100,
      age: 0,
    }));

    let t = 0;
    let raf: number;
    const isDark = theme === 'dark';

    // Fading trail effect
    const draw = () => {
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, 0, width, height);

      t += 0.002;
      const scale = 0.003;

      for (const p of particles) {
        const angle = noise(p.x * scale, p.y * scale + t) * Math.PI * 4;
        p.x += Math.cos(angle) * 1.2;
        p.y += Math.sin(angle) * 1.2;
        p.age++;

        if (p.age > p.life || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.age = 0;
          p.life = Math.random() * 200 + 100;
        }

        const alpha = Math.min(p.age / 20, 1, (p.life - p.age) / 20) * (isDark ? 0.5 : 0.3);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(140,180,240,${alpha})`
          : `rgba(40,80,160,${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    // Clear fully first
    ctx.fillStyle = isDark ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
