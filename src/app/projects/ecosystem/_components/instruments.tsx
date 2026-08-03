'use client';

// The instruments. Each one answers a different question about the same run:
//
//   Recorder      — what are the three populations doing?
//   Core sample   — how is a trait's whole distribution moving? (the signature)
//   Phase portrait— are grazers and hunters orbiting, or spiralling in?
//   Cost surface  — what does a body cost, and where does the population sit?
//   Turnover      — what is actually killing them?
//   Distributions — where is selection pushing right now?
//
// All of them draw imperatively from engine state; the page's single loop calls
// their `draw()` handles after each step.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  BINS,
  SAMPLE_EVERY,
  TRAITS,
  TRAIT_LABEL,
  TRAIT_UNIT,
  type Ecosystem,
  type TraitKey,
} from '../_lib/engine';
import { alpha, readPalette, type EcoPalette } from '../_lib/palette';

export interface DrawHandle {
  draw(): void;
}

type Render = (ctx: CanvasRenderingContext2D, w: number, h: number, pal: EcoPalette) => void;

/**
 * Shared canvas plumbing: device-pixel sizing, palette reads, and a repaint on
 * both resize and theme flip.
 */
const Canvas = forwardRef<DrawHandle, { render: Render; className?: string; onClick?: (x: number, y: number, w: number, h: number) => void }>(
  function Canvas({ render, className, onClick }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const palRef = useRef<EcoPalette | null>(null);
    const renderRef = useRef(render);
    renderRef.current = render;

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      if (w <= 0 || h <= 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      renderRef.current(ctx, w, h, palRef.current ?? readPalette(wrapRef.current));
    }, []);

    useImperativeHandle(ref, () => ({ draw }), [draw]);

    useEffect(() => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      palRef.current = readPalette(wrap);
      const ro = new ResizeObserver(entries => {
        const box = entries[0]?.contentRect;
        if (!box) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(box.width * dpr));
        canvas.height = Math.max(1, Math.floor(box.height * dpr));
        palRef.current = readPalette(wrap);
        draw();
      });
      ro.observe(wrap);
      const obs = new MutationObserver(() => {
        palRef.current = readPalette(wrap);
        draw();
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => {
        ro.disconnect();
        obs.disconnect();
      };
    }, [draw]);

    return (
      <div ref={wrapRef} className={className}>
        <canvas
          ref={canvasRef}
          className={`block h-full w-full${onClick ? ' cursor-pointer' : ''}`}
          onClick={e => {
            const c = canvasRef.current;
            if (!c || !onClick) return;
            const r = c.getBoundingClientRect();
            onClick(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
          }}
        />
      </div>
    );
  },
);

// ── Recorder ─────────────────────────────────────────────────────────────
// Three pens on three channels, each with its own scale. A shared axis would
// bury the hunters — they are an order of magnitude scarcer than the plants.

export const Recorder = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null> }>(
  function Recorder({ engine }, ref) {
    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const pop = eco.pop;
      const lanes: { key: 'plants' | 'prey' | 'pred'; label: string; color: string }[] = [
        { key: 'plants', label: 'Plants', color: pal.plant },
        { key: 'prey', label: 'Grazers', color: pal.prey },
        { key: 'pred', label: 'Hunters', color: pal.pred },
      ];
      const laneH = h / lanes.length;

      lanes.forEach((lane, li) => {
        const top = li * laneH;
        const bottom = top + laneH - 1;
        const plotTop = top + 11;
        const plotH = Math.max(6, bottom - plotTop - 2);

        ctx.strokeStyle = alpha(pal.line, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(bottom) + 0.5);
        ctx.lineTo(w, Math.round(bottom) + 0.5);
        ctx.stroke();

        let max = 1;
        for (const s of pop) max = Math.max(max, s[lane.key]);
        max = Math.ceil(max * 1.12);
        const current = pop.length > 0 ? pop[pop.length - 1][lane.key] : 0;

        if (pop.length > 1) {
          const px = (i: number) => (i / (pop.length - 1)) * w;
          const py = (v: number) => plotTop + plotH - (v / max) * plotH;
          ctx.beginPath();
          ctx.moveTo(0, bottom);
          for (let i = 0; i < pop.length; i++) ctx.lineTo(px(i), py(pop[i][lane.key]));
          ctx.lineTo(w, bottom);
          ctx.closePath();
          ctx.fillStyle = alpha(lane.color, 0.13);
          ctx.fill();

          ctx.beginPath();
          for (let i = 0; i < pop.length; i++) {
            const x = px(i);
            const y = py(pop[i][lane.key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = lane.color;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }

        ctx.font = `600 8px ${pal.mono}`;
        ctx.fillStyle = lane.color;
        ctx.fillText(lane.label.toUpperCase(), 4, top + 9);
        ctx.fillStyle = pal.dim;
        ctx.textAlign = 'right';
        ctx.fillText(`${current}  ·  ceil ${max}`, w - 4, top + 9);
        ctx.textAlign = 'left';
      });
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);

// ── Core sample ──────────────────────────────────────────────────────────
// The signature instrument. Time runs left to right, trait value runs bottom to
// top across its legal bounds, and density is ink. You are looking at the whole
// distribution rather than its average, so you can see selection do the two
// things an average hides: shift the population, and narrow it.

export const CoreSample = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null>; trait: TraitKey }>(
  function CoreSample({ engine, trait }, ref) {
    const traitRef = useRef(trait);
    traitRef.current = trait;

    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const k = traitRef.current;
      const hist = eco.traitHistory;
      const [lo, hi] = eco.params.heredity.bounds[k];
      const gutter = 30;
      const plotW = w - gutter;
      const bandGap = 12;
      const bandH = (h - bandGap) / 2;

      const bands: { species: 'prey' | 'pred'; label: string; color: string; top: number }[] = [
        { species: 'prey', label: 'Grazers', color: pal.prey, top: 0 },
        { species: 'pred', label: 'Hunters', color: pal.pred, top: bandH + bandGap },
      ];

      if (hist.length < 2) {
        ctx.font = `9px ${pal.mono}`;
        ctx.fillStyle = pal.dim;
        ctx.fillText('waiting for the first samples…', gutter + 4, h / 2);
        return;
      }

      const colW = plotW / hist.length;

      for (const band of bands) {
        // The band sits on the cabinet, so its ground is the cabinet's own
        // recess — density then reads as ink on paper by day and as glow at
        // night, without either mode turning it to mud.
        ctx.fillStyle = pal.raise;
        ctx.fillRect(gutter, band.top, plotW, bandH);

        // Density: one rectangle per bin per sample.
        for (let c = 0; c < hist.length; c++) {
          const stat = hist[c][band.species][k];
          const x = gutter + c * colW;
          for (let b = 0; b < BINS; b++) {
            const d = stat.hist[b];
            if (d === 0) continue;
            const y = band.top + bandH - ((b + 1) / BINS) * bandH;
            ctx.fillStyle = alpha(band.color, 0.06 + (d / 255) * 0.84);
            ctx.fillRect(x, y, Math.max(1, colW + 0.6), bandH / BINS + 0.6);
          }
        }

        // The mean, drawn over the density so you can see it lead or lag.
        ctx.beginPath();
        let started = false;
        for (let c = 0; c < hist.length; c++) {
          const stat = hist[c][band.species][k];
          if (stat.hist.every(v => v === 0)) {
            started = false;
            continue;
          }
          const x = gutter + c * colW + colW / 2;
          const y = band.top + bandH - ((stat.mean - lo) / (hi - lo || 1)) * bandH;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = alpha(pal.line, 0.9);
        ctx.lineWidth = 1;
        ctx.strokeRect(gutter + 0.5, band.top + 0.5, plotW - 1, bandH - 1);

        ctx.font = `600 8px ${pal.mono}`;
        ctx.fillStyle = band.color;
        ctx.fillText(band.label.toUpperCase(), gutter + 4, band.top + 10);

        const last = hist[hist.length - 1][band.species][k];
        ctx.fillStyle = pal.dim;
        ctx.textAlign = 'right';
        ctx.fillText(`μ ${last.mean.toFixed(1)}  σ ${last.sd.toFixed(2)}`, w - 4, band.top + 10);
        ctx.textAlign = 'left';
      }

      // Shared trait axis down the gutter.
      ctx.font = `8px ${pal.mono}`;
      ctx.fillStyle = pal.faint;
      ctx.textAlign = 'right';
      for (const band of bands) {
        ctx.fillText(hi.toFixed(0), gutter - 5, band.top + 7);
        ctx.fillText(lo.toFixed(0), gutter - 5, band.top + bandH - 1);
      }
      ctx.textAlign = 'left';
      ctx.save();
      ctx.translate(9, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = pal.dim;
      ctx.font = `600 8px ${pal.mono}`;
      ctx.fillText(`${TRAIT_LABEL[k].toUpperCase()} (${TRAIT_UNIT[k]})`, 0, 0);
      ctx.restore();
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);

// ── Phase portrait ───────────────────────────────────────────────────────
// Grazers against hunters. A closed loop is a stable predator-prey cycle; a
// spiral inward is a system settling; a spiral outward is one on its way to a
// crash. The time axis is gone, which is the point.

export const PhasePortrait = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null> }>(
  function PhasePortrait({ engine }, ref) {
    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const pop = eco.pop;
      const pad = { l: 30, r: 8, t: 10, b: 18 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      if (pw <= 0 || ph <= 0) return;

      let maxPrey = 1;
      let maxPred = 1;
      for (const s of pop) {
        maxPrey = Math.max(maxPrey, s.prey);
        maxPred = Math.max(maxPred, s.pred);
      }
      maxPrey = Math.ceil(maxPrey * 1.1);
      maxPred = Math.ceil(maxPred * 1.1);

      ctx.strokeStyle = alpha(pal.line, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        ctx.moveTo(pad.l + (pw * i) / 4, pad.t);
        ctx.lineTo(pad.l + (pw * i) / 4, pad.t + ph);
        ctx.moveTo(pad.l, pad.t + (ph * i) / 4);
        ctx.lineTo(pad.l + pw, pad.t + (ph * i) / 4);
      }
      ctx.strokeStyle = alpha(pal.line, 0.45);
      ctx.stroke();

      const px = (v: number) => pad.l + (v / maxPrey) * pw;
      const py = (v: number) => pad.t + ph - (v / maxPred) * ph;

      // Older states fade, so the current orbit reads clearly against its past.
      ctx.lineWidth = 1.2;
      for (let i = 1; i < pop.length; i++) {
        ctx.strokeStyle = alpha(pal.lamp, 0.05 + 0.7 * (i / pop.length) ** 2);
        ctx.beginPath();
        ctx.moveTo(px(pop[i - 1].prey), py(pop[i - 1].pred));
        ctx.lineTo(px(pop[i].prey), py(pop[i].pred));
        ctx.stroke();
      }

      if (pop.length > 0) {
        const last = pop[pop.length - 1];
        ctx.fillStyle = pal.lamp;
        ctx.beginPath();
        ctx.arc(px(last.prey), py(last.pred), 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = `8px ${pal.mono}`;
      ctx.fillStyle = pal.prey;
      ctx.textAlign = 'center';
      ctx.fillText(`GRAZERS  0 → ${maxPrey}`, pad.l + pw / 2, h - 5);
      ctx.save();
      ctx.translate(9, pad.t + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = pal.pred;
      ctx.fillText(`HUNTERS  0 → ${maxPred}`, 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);

// ── Cost surface ─────────────────────────────────────────────────────────
// The bill, drawn as a landscape: what a body costs per tick across every
// speed and vision the bounds allow, with the living population scattered on
// top. Where the cloud sits relative to the gradient is the trade-off itself.

export const CostSurface = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null> }>(
  function CostSurface({ engine }, ref) {
    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const pad = { l: 30, r: 8, t: 10, b: 18 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      if (pw <= 0 || ph <= 0) return;

      const [sLo, sHi] = eco.params.heredity.bounds.speed;
      const [vLo, vHi] = eco.params.heredity.bounds.vision;
      const meanSize = eco.stats().traits.prey.size || eco.params.prey.founder.size;
      const cost = (speed: number, vision: number) =>
        eco.cost({ speed, vision, size: meanSize, threshold: 0 });

      const cMin = cost(sLo, vLo);
      const cMax = cost(sHi, vHi);
      const span = cMax - cMin || 1;

      // Coarse cells keep this cheap enough to redraw every frame.
      const step = 5;
      for (let x = 0; x < pw; x += step) {
        for (let y = 0; y < ph; y += step) {
          const speed = sLo + (x / pw) * (sHi - sLo);
          const vision = vHi - (y / ph) * (vHi - vLo);
          const t = (cost(speed, vision) - cMin) / span;
          ctx.fillStyle = alpha(pal.lamp, 0.05 + t * 0.3);
          ctx.fillRect(pad.l + x, pad.t + y, step, step);
        }
      }

      // Iso-cost lines: bodies on one line cost the same to run.
      ctx.strokeStyle = alpha(pal.ink, 0.3);
      ctx.lineWidth = 0.8;
      for (let level = 1; level <= 4; level++) {
        const target = cMin + (span * level) / 5;
        ctx.beginPath();
        let started = false;
        for (let x = 0; x <= pw; x += 2) {
          const speed = sLo + (x / pw) * (sHi - sLo);
          // Invert the vision term directly — cost is linear in vision.
          const base = eco.params.metabolism;
          const k = base.base * Math.pow(speed, base.speedExp) * (1 + meanSize * base.sizeCost);
          const vision = k > 0 ? (target / k - 1) / (base.visionCost || 1e-9) : NaN;
          if (!Number.isFinite(vision) || vision < vLo || vision > vHi) {
            started = false;
            continue;
          }
          const y = pad.t + ph - ((vision - vLo) / (vHi - vLo || 1)) * ph;
          if (!started) {
            ctx.moveTo(pad.l + x, y);
            started = true;
          } else ctx.lineTo(pad.l + x, y);
        }
        ctx.stroke();
      }

      for (const a of eco.agents) {
        const x = pad.l + ((a.genome.speed - sLo) / (sHi - sLo || 1)) * pw;
        const y = pad.t + ph - ((a.genome.vision - vLo) / (vHi - vLo || 1)) * ph;
        ctx.fillStyle = alpha(a.species === 'prey' ? pal.prey : pal.pred, 0.85);
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = alpha(pal.line, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);

      ctx.font = `8px ${pal.mono}`;
      ctx.fillStyle = pal.dim;
      ctx.textAlign = 'center';
      ctx.fillText(`SPEED  ${sLo.toFixed(1)} → ${sHi.toFixed(1)}`, pad.l + pw / 2, h - 5);
      ctx.save();
      ctx.translate(9, pad.t + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`VISION  ${vLo.toFixed(0)} → ${vHi.toFixed(0)}`, 0, 0);
      ctx.restore();
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.lamp;
      ctx.fillText(`cost ${cMin.toFixed(2)} – ${cMax.toFixed(2)} e/t`, w - 4, h - 5);
      ctx.textAlign = 'left';
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);

// ── Turnover ─────────────────────────────────────────────────────────────
// Births against deaths by cause. Two populations can hold the same numbers
// for very different reasons; this is where you find out which.

export const Turnover = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null> }>(
  function Turnover({ engine }, ref) {
    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const pop = eco.pop;
      const pad = { l: 30, r: 8, t: 12, b: 16 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      if (pw <= 0 || ph <= 0 || pop.length < 2) return;

      let max = 1;
      for (const s of pop) max = Math.max(max, s.births, s.starved + s.eaten + s.aged);
      max = Math.ceil(max * 1.1);

      const px = (i: number) => pad.l + (i / (pop.length - 1)) * pw;
      const py = (v: number) => pad.t + ph - (v / max) * ph;

      // Deaths stack; births sit over them as a single line.
      const causes: { key: 'eaten' | 'starved' | 'aged'; color: string }[] = [
        { key: 'eaten', color: pal.pred },
        { key: 'starved', color: pal.lamp },
        { key: 'aged', color: pal.faint },
      ];
      const running = new Array(pop.length).fill(0);
      for (const cause of causes) {
        ctx.beginPath();
        for (let i = 0; i < pop.length; i++) ctx.lineTo(px(i), py(running[i]));
        for (let i = pop.length - 1; i >= 0; i--) {
          running[i] += pop[i][cause.key];
          ctx.lineTo(px(i), py(running[i]));
        }
        ctx.closePath();
        ctx.fillStyle = alpha(cause.color, 0.42);
        ctx.fill();
      }

      ctx.beginPath();
      for (let i = 0; i < pop.length; i++) {
        const x = px(i);
        const y = py(pop[i].births);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = pal.prey;
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.strokeStyle = alpha(pal.line, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);

      const last = pop[pop.length - 1];
      ctx.font = `8px ${pal.mono}`;
      const legend: [string, string, number][] = [
        ['births', pal.prey, last.births],
        ['eaten', pal.pred, last.eaten],
        ['starved', pal.lamp, last.starved],
        ['aged', pal.faint, last.aged],
      ];
      let lx = pad.l + 3;
      for (const [label, color, value] of legend) {
        ctx.fillStyle = color;
        ctx.fillText(`${label} ${value}`, lx, pad.t - 3);
        lx += ctx.measureText(`${label} ${value}`).width + 9;
      }
      ctx.fillStyle = pal.faint;
      ctx.textAlign = 'right';
      ctx.fillText(`per ${SAMPLE_EVERY} ticks · ceil ${max}`, w - 4, h - 4);
      ctx.textAlign = 'left';
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);

// ── Distributions ────────────────────────────────────────────────────────
// Where selection is pushing, right now. Each trait gets a histogram per
// species; the hollow caret is the mean of everything just born. Caret ahead
// of the mean means the trait is climbing this generation.

export const Distributions = forwardRef<DrawHandle, { engine: React.RefObject<Ecosystem | null> }>(
  function Distributions({ engine }, ref) {
    const render = useCallback<Render>((ctx, w, h, pal) => {
      const eco = engine.current;
      if (!eco) return;
      const hist = eco.traitHistory;
      if (hist.length === 0) {
        ctx.font = `9px ${pal.mono}`;
        ctx.fillStyle = pal.dim;
        ctx.fillText('waiting for the first samples…', 4, 16);
        return;
      }
      const last = hist[hist.length - 1];
      const rowH = h / TRAITS.length;
      const labelW = 46;

      TRAITS.forEach((k, ti) => {
        const top = ti * rowH;
        const [lo, hi] = eco.params.heredity.bounds[k];
        ctx.font = `600 8px ${pal.mono}`;
        ctx.fillStyle = pal.dim;
        ctx.fillText(TRAIT_LABEL[k].toUpperCase(), 2, top + 9);
        ctx.font = `8px ${pal.mono}`;
        ctx.fillStyle = pal.faint;
        ctx.fillText(`${lo}–${hi}`, 2, top + 19);

        const plotW = w - labelW - 4;
        const speciesH = (rowH - 10) / 2;

        (['prey', 'pred'] as const).forEach((sp, si) => {
          const stat = last[sp][k];
          const color = sp === 'prey' ? pal.prey : pal.pred;
          const y0 = top + 3 + si * speciesH;
          const barH = speciesH - 3;
          const binW = plotW / BINS;

          ctx.strokeStyle = alpha(pal.line, 0.7);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(labelW, y0 + barH);
          ctx.lineTo(labelW + plotW, y0 + barH);
          ctx.stroke();

          for (let b = 0; b < BINS; b++) {
            const d = stat.hist[b] / 255;
            if (d <= 0) continue;
            const bh = Math.max(1, d * barH);
            ctx.fillStyle = alpha(color, 0.72);
            ctx.fillRect(labelW + b * binW, y0 + barH - bh, Math.max(1, binW - 0.7), bh);
          }

          const at = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * plotW;

          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(at(stat.mean), y0);
          ctx.lineTo(at(stat.mean), y0 + barH);
          ctx.stroke();

          if (Number.isFinite(stat.bornMean)) {
            const x = at(stat.bornMean);
            ctx.fillStyle = pal.lamp;
            ctx.beginPath();
            ctx.moveTo(x, y0 + barH - 1);
            ctx.lineTo(x - 3, y0 + barH + 4);
            ctx.lineTo(x + 3, y0 + barH + 4);
            ctx.closePath();
            ctx.fill();
          }
        });
      });
    }, [engine]);

    return <Canvas ref={ref} render={render} className="h-full w-full" />;
  },
);
