'use client';

// The brain monitor: the watched car's network, live. Left column is what the
// car can know — its rangefinders and its own speed. The wires are the genome
// itself: width is the weight's size, colour its sign, brightness the signal
// actually flowing this tick. The right edge is everything the car can do:
// one steering channel, one throttle channel.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Car, Session } from '../_lib/engine';
import { readPalette, alpha, type DrsPalette } from '../_lib/palette';

export interface DrawHandle {
  draw(): void;
}

interface Props {
  session: React.RefObject<Session | null>;
  /** Which car to watch; null follows the leader. */
  watchId: number | null;
}

const Brain = forwardRef<DrawHandle, Props>(function Brain({ session, watchId }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<DrsPalette | null>(null);
  const watchRef = useRef(watchId);
  watchRef.current = watchId;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = session.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = paletteRef.current ?? readPalette(canvas.parentElement);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const car: Car | null = watchRef.current !== null
      ? s.find(watchRef.current) ?? s.champion()
      : s.champion();
    if (!car) return;

    const thought = s.think(car);
    const shape = s.shape;
    const genome = car.genome;

    const padY = 12;
    const inX = 30;
    const hidX = w * 0.44;
    const outX = w * 0.66;
    const gaugeX = w * 0.74;
    const gaugeW = w - gaugeX - 12;

    const yAt = (i: number, n: number) =>
      n === 1 ? h / 2 : padY + (i / (n - 1)) * (h - padY * 2);

    // ── Wires ──
    // input → hidden
    for (let hh = 0; hh < shape.hidden; hh++) {
      const hy = yAt(hh, shape.hidden);
      for (let i = 0; i < shape.inputs; i++) {
        const wgt = genome[hh * (shape.inputs + 1) + i];
        const signal = Math.abs(wgt * thought.inputs[i]);
        const a = Math.min(0.85, 0.05 + signal * 0.4);
        ctx.strokeStyle = alpha(wgt >= 0 ? pal.flag : pal.steer, a);
        ctx.lineWidth = Math.min(2.4, 0.4 + Math.abs(wgt) * 0.7);
        ctx.beginPath();
        ctx.moveTo(inX, yAt(i, shape.inputs));
        ctx.lineTo(hidX, hy);
        ctx.stroke();
      }
    }
    // hidden → output
    const hiddenBase = shape.hidden * (shape.inputs + 1);
    let maxH = 0;
    for (const v of thought.hidden) if (v > maxH) maxH = v;
    for (let o = 0; o < 2; o++) {
      const oy = yAt(o === 0 ? 1 : 3, 5);
      for (let hh = 0; hh < shape.hidden; hh++) {
        const wgt = genome[hiddenBase + o * (shape.hidden + 1) + hh];
        const signal = Math.abs(wgt * thought.hidden[hh]);
        const a = Math.min(0.85, 0.05 + signal * 0.3);
        ctx.strokeStyle = alpha(wgt >= 0 ? pal.flag : pal.steer, a);
        ctx.lineWidth = Math.min(2.4, 0.4 + Math.abs(wgt) * 0.7);
        ctx.beginPath();
        ctx.moveTo(hidX, yAt(hh, shape.hidden));
        ctx.lineTo(outX, oy);
        ctx.stroke();
      }
    }

    // ── Nodes ──
    // Inputs: rangefinders as ticks whose fill is the reading; speed as a diamond.
    for (let i = 0; i < shape.inputs; i++) {
      const y = yAt(i, shape.inputs);
      const v = thought.inputs[i];
      const isSpeed = i === shape.inputs - 1;
      if (isSpeed) {
        ctx.fillStyle = alpha(pal.ink, 0.15 + v * 0.85);
        ctx.beginPath();
        ctx.moveTo(inX, y - 5);
        ctx.lineTo(inX + 5, y);
        ctx.lineTo(inX, y + 5);
        ctx.lineTo(inX - 5, y);
        ctx.closePath();
        ctx.fill();
      } else {
        // A close wall reads low — draw the *proximity* so danger glows.
        ctx.fillStyle = alpha(pal.litRay, 0.12 + (1 - v) * 0.88);
        ctx.strokeStyle = alpha(pal.dim, 0.5);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(inX, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.font = `7px ${pal.mono}`;
    ctx.fillStyle = pal.dim;
    ctx.textAlign = 'center';
    ctx.fillText('rays', inX, padY - 4 < 7 ? 7 : padY - 4);
    ctx.fillText('spd', inX - 14, yAt(shape.inputs - 1, shape.inputs) + 3);

    // Hidden: fill by activation share.
    for (let hh = 0; hh < shape.hidden; hh++) {
      const y = yAt(hh, shape.hidden);
      const v = maxH > 0 ? thought.hidden[hh] / maxH : 0;
      ctx.fillStyle = alpha(pal.ink, 0.1 + v * 0.9);
      ctx.strokeStyle = alpha(pal.dim, 0.5);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(hidX, y, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ── The two commands, as pit gauges ──
    const steer = thought.out[0];
    const throttle = thought.out[1];
    const steerY = yAt(1, 5);
    const throtY = yAt(3, 5);

    // Output nodes.
    ctx.fillStyle = alpha(pal.steer, 0.25 + Math.abs(steer) * 0.75);
    ctx.beginPath(); ctx.arc(outX, steerY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = alpha(pal.throttle, 0.25 + Math.abs(throttle) * 0.75);
    ctx.beginPath(); ctx.arc(outX, throtY, 5, 0, Math.PI * 2); ctx.fill();

    ctx.font = `8px ${pal.mono}`;
    ctx.textAlign = 'left';

    // Steer gauge: centred, needle swings left/right.
    const sy = steerY;
    ctx.strokeStyle = alpha(pal.dim, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gaugeX, sy); ctx.lineTo(gaugeX + gaugeW, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gaugeX + gaugeW / 2, sy - 5); ctx.lineTo(gaugeX + gaugeW / 2, sy + 5);
    ctx.stroke();
    ctx.fillStyle = pal.steer;
    const needleX = gaugeX + gaugeW / 2 + (steer * gaugeW) / 2;
    ctx.fillRect(needleX - 1.5, sy - 6, 3, 12);
    ctx.fillStyle = pal.dim;
    ctx.fillText('steer', gaugeX, sy - 10);
    ctx.fillStyle = pal.ink;
    ctx.textAlign = 'right';
    ctx.fillText(steer.toFixed(2), gaugeX + gaugeW, sy + 14);

    // Throttle gauge: zero-centred bar — reverse is real.
    const ty = throtY;
    ctx.textAlign = 'left';
    ctx.strokeStyle = alpha(pal.dim, 0.5);
    ctx.beginPath();
    ctx.moveTo(gaugeX, ty); ctx.lineTo(gaugeX + gaugeW, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gaugeX + gaugeW / 2, ty - 5); ctx.lineTo(gaugeX + gaugeW / 2, ty + 5);
    ctx.stroke();
    ctx.fillStyle = alpha(pal.throttle, 0.85);
    const tw = (throttle * gaugeW) / 2;
    ctx.fillRect(gaugeX + gaugeW / 2 + Math.min(0, tw), ty - 3.5, Math.abs(tw), 7);
    ctx.fillStyle = pal.dim;
    ctx.fillText('throttle', gaugeX, ty - 10);
    ctx.fillStyle = pal.ink;
    ctx.textAlign = 'right';
    ctx.fillText(throttle.toFixed(2), gaugeX + gaugeW, ty + 14);
    ctx.textAlign = 'left';

    // Retired watermark — bottom-right, clear of the input labels.
    if (!car.alive) {
      ctx.fillStyle = alpha(pal.crash, 0.85);
      ctx.font = `600 9px ${pal.mono}`;
      ctx.textAlign = 'right';
      ctx.fillText(car.out === 'wall' ? 'OUT — BARRIER' : 'OUT — STALLED', w - 8, h - 6);
      ctx.textAlign = 'left';
    }
  }, [session]);

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

  useEffect(() => {
    const obs = new MutationObserver(() => {
      paletteRef.current = readPalette(wrapRef.current);
      draw();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [watchId, draw]);

  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});

export default Brain;
