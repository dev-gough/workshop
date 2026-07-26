'use client';

import { useEffect, useRef } from 'react';

// ── Background: Clifford strange attractor ───────────────────────
//   x' = sin(a·y) + c·cos(a·x)
//   y' = sin(b·x) + d·cos(b·y)
// Four numbers and a single orbit, iterated forever. Nothing is drawn
// directly: each visited pixel adds to a density field that decays a little
// every frame, so the picture is a long-exposure photograph of where the
// orbit spends its time. The parameters drift on slow sines, and the
// exposure re-develops as they move.

/** Deep indigo → verdigris → lamplight, matching the room's own palette. */
function buildRamp(): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  const stops: [number, number, number, number][] = [
    [0.0, 26, 30, 72],
    [0.32, 40, 110, 150],
    [0.62, 87, 207, 182],
    [0.85, 214, 226, 190],
    [1.0, 255, 244, 224],
  ];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [t0, r0, g0, b0] = stops[s];
    const [t1, r1, g1, b1] = stops[s + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    lut[i * 4] = r0 + (r1 - r0) * f;
    lut[i * 4 + 1] = g0 + (g1 - g0) * f;
    lut[i * 4 + 2] = b0 + (b1 - b0) * f;
    // Transparent at the bottom of the ramp so the dome shows through the
    // empty regions and the opacity slider still has something to work on.
    lut[i * 4 + 3] = Math.min(255, Math.round(Math.pow(t, 0.7) * 235));
  }
  return lut;
}

const RAMP = buildRamp();

export function AttractorBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The density pass touches every cell every frame, so render at a
    // fraction of the viewport and let the browser upscale — which also
    // gives the exposure its bloom for free.
    const q = width * height > 1_400_000 ? 3 : 2;
    const rw = Math.max(2, Math.ceil(width / q));
    const rh = Math.max(2, Math.ceil(height / q));
    canvas.width = rw;
    canvas.height = rh;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(rw, rh);
    const pixels = img.data;
    const density = new Float32Array(rw * rh);

    const scale = Math.min(rw / 6.0, rh / 5.0);
    const cx = rw / 2, cy = rh / 2;

    // Live orbit position — carried across frames so the exposure is one
    // continuous trajectory rather than a fresh burst each time.
    let x = 0.1, y = 0.1;
    let t = 0;
    const POINTS = 16000;
    const DECAY = 0.955;

    let raf: number;
    const draw = () => {
      t += 0.0016;
      const a = 1.7 + 0.55 * Math.sin(t * 0.73);
      const b = -1.8 + 0.5 * Math.cos(t * 0.51);
      const c = 1.4 + 0.5 * Math.sin(t * 0.31 + 1.7);
      const d = 1.5 + 0.45 * Math.cos(t * 0.41 + 0.6);

      for (let i = 0; i < density.length; i++) density[i] *= DECAY;

      for (let i = 0; i < POINTS; i++) {
        const nx = Math.sin(a * y) + c * Math.cos(a * x);
        const ny = Math.sin(b * x) + d * Math.cos(b * y);
        x = nx; y = ny;
        const px = (cx + x * scale) | 0;
        const py = (cy + y * scale) | 0;
        if (px >= 0 && px < rw && py >= 0 && py < rh) density[py * rw + px] += 1;
      }

      // Log compression: an attractor's fold lines are orders of magnitude
      // denser than its outskirts, and a linear map would show only the folds.
      for (let i = 0, p = 0; i < density.length; i++, p += 4) {
        const v = density[i];
        const lut = v <= 0 ? 0 : Math.min(255, (Math.log1p(v * 2.2) * 74) | 0);
        const o = lut * 4;
        pixels[p] = RAMP[o];
        pixels[p + 1] = RAMP[o + 1];
        pixels[p + 2] = RAMP[o + 2];
        pixels[p + 3] = RAMP[o + 3];
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
