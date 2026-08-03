'use client';

// The tank: the lit world itself, plus the overlays that expose what the
// agents are actually doing each tick. Everything here is a view of engine
// state — the tank never mutates the simulation.
//
// Rendering is imperative. The page owns one animation loop; it steps the
// engine and then calls `draw()` on this handle, so React never re-renders
// per frame.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Agent, Ecosystem, TraitKey } from '../_lib/engine';
import { readPalette, alpha, type EcoPalette } from '../_lib/palette';

export type ColorBy = 'species' | TraitKey | 'energy' | 'generation';

export interface Overlays {
  plants: boolean;
  vision: boolean;
  intent: boolean;
  energy: boolean;
  trails: boolean;
  grid: boolean;
  colorBy: ColorBy;
}

export const DEFAULT_OVERLAYS: Overlays = {
  plants: true,
  vision: false,
  intent: false,
  energy: false,
  trails: false,
  grid: false,
  colorBy: 'species',
};

export interface TankHandle {
  draw(): void;
}

// Sequential ramp for `colour by` — an instrument scale, deliberately unlike
// either species hue so a trait map can never be mistaken for a census.
const RAMP: [number, number, number][] = [
  [61, 95, 168],
  [87, 189, 160],
  [232, 182, 74],
];

function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

const CELL = 40;

/** The tank's own lamp. Fixed, like the species hues — the tank is lit from within. */
const LIT_LAMP = '#dda43f';

interface Props {
  engine: React.RefObject<Ecosystem | null>;
  overlays: Overlays;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

const Tank = forwardRef<TankHandle, Props>(function Tank({ engine, overlays, selectedId, onSelect }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<EcoPalette | null>(null);
  const overlaysRef = useRef(overlays);
  const selectedRef = useRef(selectedId);
  // Canvas-space geometry of the world rectangle, kept for hit-testing clicks.
  const viewRef = useRef({ ox: 0, oy: 0, scale: 1 });
  overlaysRef.current = overlays;
  selectedRef.current = selectedId;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const eco = engine.current;
    if (!canvas || !eco) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = paletteRef.current ?? readPalette(canvas.parentElement);
    const ov = overlaysRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    if (cw <= 0 || ch <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Letterbox the world so a unit of distance is the same in x and y —
    // stretching it would make every vision radius a lie.
    const { w: WW, h: WH } = eco.params.world;
    const scale = Math.min(cw / WW, ch / WH);
    const ox = (cw - WW * scale) / 2;
    const oy = (ch - WH * scale) / 2;
    viewRef.current = { ox, oy, scale };

    // The mount around the world reads as cabinet, not as ground — otherwise a
    // world that isn't the container's aspect looks like empty habitat.
    ctx.fillStyle = pal.panel;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.beginPath();
    ctx.rect(0, 0, WW * scale, WH * scale);
    ctx.clip();

    // Trails let the tank hold a few frames of motion; otherwise wipe clean.
    ctx.fillStyle = ov.trails ? alpha(pal.peat, 0.22) : pal.peat;
    ctx.fillRect(0, 0, WW * scale, WH * scale);

    if (!ov.trails) {
      // Substrate: the lamp pooling on the peat from above.
      const grad = ctx.createRadialGradient(WW * scale * 0.5, 0, 0, WW * scale * 0.5, 0, WH * scale * 1.15);
      grad.addColorStop(0, alpha(pal.peat2, 0.95));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WW * scale, WH * scale);
    }

    if (ov.grid) {
      // The spatial hash the engine actually searches — not decoration.
      ctx.strokeStyle = alpha(pal.faint, 0.22);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = 0; x <= WW; x += CELL) {
        ctx.moveTo(x * scale, 0);
        ctx.lineTo(x * scale, WH * scale);
      }
      for (let y = 0; y <= WH; y += CELL) {
        ctx.moveTo(0, y * scale);
        ctx.lineTo(WW * scale, y * scale);
      }
      ctx.stroke();
    }

    if (ov.plants) {
      ctx.fillStyle = pal.litPlant;
      ctx.globalAlpha = 0.8;
      for (const p of eco.plants) {
        ctx.fillRect(p.x * scale - 1, p.y * scale - 1, 2.2, 2.2);
      }
      ctx.globalAlpha = 1;
    }

    const bounds = eco.params.heredity.bounds;
    const colorOf = (a: Agent): string => {
      const c = ov.colorBy;
      if (c === 'species') return a.species === 'prey' ? pal.litPrey : pal.litPred;
      if (c === 'energy') return ramp(a.energy / Math.max(1, a.genome.threshold));
      if (c === 'generation') return ramp(eco.maxGen > 0 ? a.gen / eco.maxGen : 0);
      const [lo, hi] = bounds[c];
      return ramp((a.genome[c] - lo) / (hi - lo || 1));
    };

    if (ov.vision) {
      ctx.lineWidth = 0.6;
      for (const a of eco.agents) {
        ctx.strokeStyle = alpha(a.species === 'prey' ? pal.litPrey : pal.litPred, 0.13);
        ctx.beginPath();
        ctx.arc(a.x * scale, a.y * scale, a.genome.vision * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (ov.intent) {
      // The sense→act vector: where each agent decided to go this tick.
      ctx.lineWidth = 0.8;
      for (const a of eco.agents) {
        if (a.state === 'wander') continue;
        const len = Math.hypot(a.tx, a.ty);
        if (len < 0.001) continue;
        const k = Math.min(1, 26 / len);
        ctx.strokeStyle = alpha(a.state === 'flee' ? LIT_LAMP : a.state === 'hunt' ? pal.litPred : pal.litPlant, 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x * scale, a.y * scale);
        ctx.lineTo((a.x + a.tx * k) * scale, (a.y + a.ty * k) * scale);
        ctx.stroke();
      }
    }

    for (const a of eco.agents) {
      const sx = a.x * scale;
      const sy = a.y * scale;
      const r = Math.max(1.8, a.genome.size * scale * 0.62);
      ctx.globalAlpha = Math.max(0.35, Math.min(1, a.energy / Math.max(20, a.genome.threshold * 0.6)));
      ctx.fillStyle = colorOf(a);

      if (a.species === 'prey') {
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Hunters are arrowheads — heading is information, so give it a form.
        const h = a.heading;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(h) * r * 1.7, sy + Math.sin(h) * r * 1.7);
        ctx.lineTo(sx + Math.cos(h + 2.5) * r, sy + Math.sin(h + 2.5) * r);
        ctx.lineTo(sx + Math.cos(h - 2.5) * r, sy + Math.sin(h - 2.5) * r);
        ctx.closePath();
        ctx.fill();
      }

      if (ov.energy) {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = LIT_LAMP;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.min(1, a.energy / a.genome.threshold) * Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // The specimen under study.
    const sel = selectedRef.current === null ? null : eco.find(selectedRef.current);
    if (sel) {
      const sx = sel.x * scale;
      const sy = sel.y * scale;
      ctx.strokeStyle = LIT_LAMP;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(7, sel.genome.size * scale * 0.62 + 5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = alpha(LIT_LAMP, 0.55);
      ctx.beginPath();
      ctx.arc(sx, sy, sel.genome.vision * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (sel.state !== 'wander') {
        const len = Math.hypot(sel.tx, sel.ty);
        if (len > 0.001) {
          const k = Math.min(1, sel.genome.vision / len);
          ctx.strokeStyle = LIT_LAMP;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo((sel.x + sel.tx * k) * scale, (sel.y + sel.ty * k) * scale);
          ctx.stroke();
        }
      }
    }

    // The edge of the world — a hard wall in a walled run, a dashed seam in a
    // toroidal one, because in a toroidal world it is not really an edge.
    ctx.strokeStyle = eco.params.world.wrap ? 'rgba(190,205,180,0.28)' : 'rgba(190,205,180,0.55)';
    ctx.setLineDash(eco.params.world.wrap ? [4, 5] : []);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, WW * scale - 1, WH * scale - 1);
    ctx.setLineDash([]);
    ctx.restore();
  }, [engine]);

  useImperativeHandle(ref, () => ({ draw }), [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    paletteRef.current = readPalette(wrap);
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(box.width * dpr));
      canvas.height = Math.max(1, Math.floor(box.height * dpr));
      paletteRef.current = readPalette(wrap);
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // A theme flip changes every colour; re-read and repaint.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      paletteRef.current = readPalette(wrapRef.current);
      draw();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [overlays, selectedId, draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const eco = engine.current;
    const canvas = canvasRef.current;
    if (!eco || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { ox, oy, scale } = viewRef.current;
    const wx = (e.clientX - rect.left - ox) / scale;
    const wy = (e.clientY - rect.top - oy) / scale;
    const hit = eco.agentAt(wx, wy, 10 / scale);
    onSelect(hit ? hit.id : null);
  }, [engine, onSelect]);

  return (
    <div ref={wrapRef} className="eco-tank h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block h-full w-full cursor-crosshair"
      />
    </div>
  );
});

export default Tank;
