'use client';

// The pit wall's chart instruments. All of them draw imperatively from session
// state when the page's loop calls draw() — React never re-renders per frame.
//
//   Telemetry  — the leader's speed / throttle / steer, tick by tick
//   Progress   — best & mean distance per heat, with lap lines
//   Attrition  — survival curves, recent heats overlaid
//   Diversity  — how much genetic room the grid has left
//   Weights    — the champion's genome, laid flat as a heat map

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { TELEMETRY_CAP, type Session } from '../_lib/engine';
import { readPalette, alpha, type DrsPalette } from '../_lib/palette';

export interface DrawHandle {
  draw(): void;
}

// Shared canvas scaffold: DPR sizing, palette read, theme re-read.
function useInstrument(drawImpl: (ctx: CanvasRenderingContext2D, w: number, h: number, pal: DrsPalette) => void) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<DrsPalette | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pal = paletteRef.current ?? readPalette(canvas.parentElement);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawImpl(ctx, w, h, pal);
  }, [drawImpl]);

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

  useEffect(() => {
    const obs = new MutationObserver(() => {
      paletteRef.current = readPalette(wrapRef.current);
      draw();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [draw]);

  return { wrapRef, canvasRef, draw };
}

interface Props {
  session: React.RefObject<Session | null>;
}

// ── Telemetry ────────────────────────────────────────────────────────────
// Three lanes, F1 style: speed filled, throttle and steer zero-centred.
// Vertical seams mark where one heat ended and the next began.

export const Telemetry = forwardRef<DrawHandle, Props>(function Telemetry({ session }, ref) {
  const { wrapRef, canvasRef, draw } = useInstrument(
    useCallback((ctx, w, h, pal) => {
      const s = session.current;
      if (!s) return;
      const t = s.telemetry;
      if (t.filled < 2) return;

      const labelW = 34;
      const plotW = w - labelW - 4;
      const laneH = h / 3;
      const n = t.filled;
      const start = (t.head - n + TELEMETRY_CAP) % TELEMETRY_CAP;
      const xAt = (k: number) => labelW + (k / (n - 1)) * plotW;

      // Heat seams first, under the traces.
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(pal.faint, 0.4);
      for (let k = 1; k < n; k++) {
        const i0 = (start + k - 1) % TELEMETRY_CAP;
        const i1 = (start + k) % TELEMETRY_CAP;
        if (t.genParity[i0] !== t.genParity[i1]) {
          ctx.beginPath();
          ctx.moveTo(xAt(k), 2);
          ctx.lineTo(xAt(k), h - 2);
          ctx.stroke();
        }
      }

      const lanes: {
        label: string;
        color: string;
        data: Float32Array;
        centred: boolean; // -1..1 about a zero line vs 0..1 up from the floor
      }[] = [
        { label: 'SPD', color: pal.speed, data: t.speed, centred: false },
        { label: 'THR', color: pal.throttle, data: t.throttle, centred: true },
        { label: 'STR', color: pal.steer, data: t.steer, centred: true },
      ];

      ctx.font = `7px ${pal.mono}`;
      lanes.forEach((lane, li) => {
        const top = li * laneH + 3;
        const bot = (li + 1) * laneH - 3;
        const mid = (top + bot) / 2;

        // Lane baseline.
        ctx.strokeStyle = alpha(pal.line, 0.9);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const baseY = lane.centred ? mid : bot;
        ctx.moveTo(labelW, baseY);
        ctx.lineTo(w - 4, baseY);
        ctx.stroke();

        // Trace.
        const yAt = (v: number) => lane.centred
          ? mid - v * ((bot - top) / 2) * 0.92
          : bot - v * (bot - top) * 0.92;

        if (!lane.centred) {
          // Speed gets a filled body — it reads as effort.
          ctx.fillStyle = alpha(lane.color, 0.16);
          ctx.beginPath();
          ctx.moveTo(xAt(0), bot);
          for (let k = 0; k < n; k++) ctx.lineTo(xAt(k), yAt(lane.data[(start + k) % TELEMETRY_CAP]));
          ctx.lineTo(xAt(n - 1), bot);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = lane.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const y = yAt(lane.data[(start + k) % TELEMETRY_CAP]);
          k === 0 ? ctx.moveTo(xAt(k), y) : ctx.lineTo(xAt(k), y);
        }
        ctx.stroke();

        // Direct label + live value, in ink — the chip carries the colour.
        ctx.fillStyle = lane.color;
        ctx.fillRect(2, mid - 6, 3, 12);
        ctx.fillStyle = pal.dim;
        ctx.textAlign = 'left';
        ctx.fillText(lane.label, 8, mid + 2.5);
        const last = lane.data[(t.head - 1 + TELEMETRY_CAP) % TELEMETRY_CAP];
        ctx.fillStyle = pal.ink;
        ctx.textAlign = 'right';
        ctx.fillText(last.toFixed(2), w - 6, top + 7);
        ctx.textAlign = 'left';
      });
    }, [session]),
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});

// ── Progress ─────────────────────────────────────────────────────────────

export const Progress = forwardRef<DrawHandle, Props>(function Progress({ session }, ref) {
  const { wrapRef, canvasRef, draw } = useInstrument(
    useCallback((ctx, w, h, pal) => {
      const s = session.current;
      if (!s) return;
      const hist = s.history;
      if (hist.length === 0) {
        ctx.fillStyle = pal.dim;
        ctx.font = `9px ${pal.mono}`;
        ctx.fillText('no heats on the sheet yet — run the session', 8, h / 2);
        return;
      }

      const padL = 6, padR = 34, padT = 8, padB = 12;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxY = Math.max(...hist.map(r => r.best), 1) * 1.08;
      const xAt = (i: number) => padL + (hist.length === 1 ? plotW / 2 : (i / (hist.length - 1)) * plotW);
      const yAt = (v: number) => padT + plotH - (v / maxY) * plotH;

      // Lap lines: the distances that mean "made it all the way round".
      const lapM = s.track.centerline.length * s.track.stepLen;
      ctx.font = `7px ${pal.mono}`;
      for (let lap = 1; lap * lapM < maxY; lap++) {
        const y = yAt(lap * lapM);
        ctx.strokeStyle = alpha(pal.faint, 0.4);
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pal.dim;
        ctx.textAlign = 'left';
        ctx.fillText(`lap ${lap}`, w - padR + 3, y + 2.5);
      }

      // Fresh-circuit seams.
      for (let i = 0; i < hist.length; i++) {
        if (!hist[i].newCircuit) continue;
        ctx.strokeStyle = alpha(pal.litRay, 0.5);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(xAt(i), padT);
        ctx.lineTo(xAt(i), padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Mean, then best on top.
      ctx.strokeStyle = alpha(pal.dim, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      hist.forEach((r, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(r.mean)) : ctx.lineTo(xAt(i), yAt(r.mean)));
      ctx.stroke();

      ctx.strokeStyle = pal.speed;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((r, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(r.best)) : ctx.lineTo(xAt(i), yAt(r.best)));
      ctx.stroke();

      // Records get the purple dot.
      ctx.fillStyle = pal.purple;
      for (let i = 0; i < hist.length; i++) {
        if (!hist[i].record) continue;
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(hist[i].best), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Legend, direct: labels in ink beside colour chips.
      ctx.font = `7px ${pal.mono}`;
      ctx.fillStyle = pal.speed;
      ctx.fillRect(padL, h - 8, 3, 6);
      ctx.fillStyle = pal.dim;
      ctx.fillText('best', padL + 6, h - 3);
      ctx.fillStyle = alpha(pal.dim, 0.7);
      ctx.fillRect(padL + 30, h - 8, 3, 6);
      ctx.fillStyle = pal.dim;
      ctx.fillText('mean of the grid', padL + 36, h - 3);
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.ink;
      ctx.fillText(`${Math.round(hist[hist.length - 1].best)} m`, w - padR - 4, yAt(hist[hist.length - 1].best) - 4);
      ctx.textAlign = 'left';
    }, [session]),
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});

// ── Attrition ────────────────────────────────────────────────────────────
// One curve per recent heat: how many cars were still running at each tick.
// The story of learning is these curves marching to the right.

export const Attrition = forwardRef<DrawHandle, Props>(function Attrition({ session }, ref) {
  const { wrapRef, canvasRef, draw } = useInstrument(
    useCallback((ctx, w, h, pal) => {
      const s = session.current;
      if (!s) return;
      const past = s.pastAttrition;
      const padL = 6, padR = 8, padT = 8, padB = 12;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const budget = s.params.session.tickBudget;
      const xAt = (tk: number) => padL + Math.min(1, tk / budget) * plotW;
      const yAt = (frac: number) => padT + plotH - frac * plotH;

      ctx.strokeStyle = alpha(pal.line, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(padL, padT, plotW, plotH);

      const drawCurve = (curve: number[], pop: number, color: string, width: number) => {
        if (curve.length < 2 || pop === 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < curve.length; i++) {
          const x = xAt(i * 4);
          const y = yAt(curve[i] / pop);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      past.forEach((rec, i) => {
        const recency = past.length === 1 ? 1 : i / (past.length - 1);
        drawCurve(rec.curve, rec.pop, alpha(pal.dim, 0.12 + recency * 0.4), 1);
      });
      drawCurve(s.attrition, s.cars.length, pal.speed, 1.5);

      ctx.font = `7px ${pal.mono}`;
      ctx.fillStyle = pal.dim;
      ctx.fillText('all running', padL + 4, padT + 8);
      ctx.fillText('none', padL + 4, padT + plotH - 3);
      ctx.textAlign = 'right';
      ctx.fillText(`flag at ${budget.toLocaleString()} t`, w - padR - 3, h - 3);
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.speed;
      ctx.fillRect(padL, h - 8, 3, 6);
      ctx.fillStyle = pal.dim;
      ctx.fillText('this heat', padL + 6, h - 3);
      ctx.fillStyle = alpha(pal.dim, 0.5);
      ctx.fillRect(padL + 44, h - 8, 3, 6);
      ctx.fillStyle = pal.dim;
      ctx.fillText('earlier heats', padL + 50, h - 3);
    }, [session]),
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});

// ── Diversity ────────────────────────────────────────────────────────────

export const Diversity = forwardRef<DrawHandle, Props>(function Diversity({ session }, ref) {
  const { wrapRef, canvasRef, draw } = useInstrument(
    useCallback((ctx, w, h, pal) => {
      const s = session.current;
      if (!s) return;
      const hist = s.history;
      if (hist.length === 0) {
        ctx.fillStyle = pal.dim;
        ctx.font = `9px ${pal.mono}`;
        ctx.fillText('measured when each heat ends', 8, h / 2);
        return;
      }
      const padL = 6, padR = 36, padT = 8, padB = 12;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxY = Math.max(...hist.map(r => r.diversity), 0.01) * 1.1;
      const xAt = (i: number) => padL + (hist.length === 1 ? plotW / 2 : (i / (hist.length - 1)) * plotW);
      const yAt = (v: number) => padT + plotH - (v / maxY) * plotH;

      ctx.strokeStyle = pal.steer;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((r, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(r.diversity)) : ctx.lineTo(xAt(i), yAt(r.diversity)));
      ctx.stroke();

      const last = hist[hist.length - 1];
      ctx.font = `7px ${pal.mono}`;
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'right';
      ctx.fillText(last.diversity.toFixed(3), w - 4, yAt(last.diversity) + 2.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.dim;
      ctx.fillText('weight spread across the grid, per heat', padL, h - 3);
    }, [session]),
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});

// ── Weights ──────────────────────────────────────────────────────────────
// The champion's genome laid flat: one cell per weight, diverging colour.
// Watching columns organise over heats IS watching learning happen.

export const Weights = forwardRef<DrawHandle, Props>(function Weights({ session }, ref) {
  const { wrapRef, canvasRef, draw } = useInstrument(
    useCallback((ctx, w, h, pal) => {
      const s = session.current;
      if (!s) return;
      const champ = s.champion();
      if (!champ) return;
      const shape = s.shape;
      const g = champ.genome;

      let maxW = 0.001;
      for (let i = 0; i < g.length; i++) {
        const a = Math.abs(g[i]);
        if (a > maxW) maxW = a;
      }

      const cellFor = (wgt: number): string => {
        const t = Math.max(-1, Math.min(1, wgt / maxW));
        return t >= 0 ? alpha(pal.flag, 0.08 + t * 0.9) : alpha(pal.steer, 0.08 - t * 0.9);
      };

      const cols1 = shape.inputs + 1;   // + bias
      const rows1 = shape.hidden;
      const cols2 = shape.hidden + 1;   // + bias
      const rows2 = 2;
      const gap = 12;
      const labelH = 10;

      const cell = Math.max(2, Math.min(
        (w - gap - 8) / (cols1 + cols2),
        (h - labelH - 4) / Math.max(rows1, rows2),
      ));

      const block1W = cell * cols1;
      const x1 = 4, y1 = labelH + 2;
      for (let r = 0; r < rows1; r++) {
        for (let c = 0; c < cols1; c++) {
          ctx.fillStyle = cellFor(g[r * cols1 + c]);
          ctx.fillRect(x1 + c * cell, y1 + r * cell, cell - 1, cell - 1);
        }
      }
      const base2 = rows1 * cols1;
      const x2 = x1 + block1W + gap;
      for (let r = 0; r < rows2; r++) {
        for (let c = 0; c < cols2; c++) {
          ctx.fillStyle = cellFor(g[base2 + r * cols2 + c]);
          ctx.fillRect(x2 + c * cell, y1 + r * cell, cell - 1, cell - 1);
        }
      }

      ctx.font = `7px ${pal.mono}`;
      ctx.fillStyle = pal.dim;
      ctx.fillText('rays+spd+b → hidden', x1, 8);
      ctx.fillText('hidden+b → steer/thr', x2, 8);
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.ink;
      ctx.fillText(`${shape.size} w`, w - 4, 8);
      ctx.textAlign = 'left';
    }, [session]),
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});
