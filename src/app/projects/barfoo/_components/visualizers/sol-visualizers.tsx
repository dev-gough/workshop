'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAudio } from '@/components/AudioProvider';
import { makeBandReader, sampleSpectrum } from '../../../polar-clock/_components/audio-analysis';

interface SceneProps {
  width: number;
  height: number;
}

interface SceneLoop {
  draw: (time: number) => void;
  dispose?: () => void;
}

type SceneSetup = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  reducedMotion: boolean,
) => SceneLoop;

function SceneCanvas({ width, height, setup }: SceneProps & { setup: SceneSetup }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = setup(ctx, width, height, reduced);
    let raf = 0;
    let last = 0;
    const frame = (time: number) => {
      if (!document.hidden && (!reduced || time - last >= 100)) {
        loop.draw(time);
        last = time;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      loop.dispose?.();
    };
  }, [height, setup, width]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

export function LacquerBloom({ width, height }: SceneProps) {
  const { getFrequencyData, getWaveformData } = useAudio();
  const setup = useCallback<SceneSetup>((ctx, w, h, reduced) => {
    const read = makeBandReader(getFrequencyData);
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.13;
    const pulses: { radius: number; alpha: number; hue: number }[] = [];

    return {
      draw(time) {
        const bands = read();
        const wave = getWaveformData();
        ctx.fillStyle = 'rgba(8,4,7,0.20)';
        ctx.fillRect(0, 0, w, h);

        if (bands.kick && !reduced) {
          pulses.push({ radius: base * 0.7, alpha: 0.85, hue: 346 + bands.treble * 34 });
          if (pulses.length > 10) pulses.shift();
        }
        for (const pulse of pulses) {
          pulse.radius += 2.5 + bands.bass * 7;
          pulse.alpha *= 0.976;
          ctx.beginPath();
          ctx.arc(cx, cy, pulse.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${pulse.hue},82%,67%,${pulse.alpha})`;
          ctx.lineWidth = 1 + pulse.alpha * 2;
          ctx.stroke();
        }

        const grooves = 8;
        for (let groove = grooves - 1; groove >= 0; groove--) {
          const points = 220;
          const radius = base + groove * Math.min(w, h) * 0.037;
          ctx.beginPath();
          for (let i = 0; i <= points; i++) {
            const index = wave?.length ? Math.min(wave.length - 1, Math.floor((i / points) * wave.length)) : 0;
            const sample = wave?.length ? (wave[index] - 128) / 128 : 0;
            const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
            const breath = Math.sin(angle * 3 + time * 0.00035) * 2;
            const r = radius + sample * (13 + bands.energy * 38) + breath;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = `hsla(${344 + groove * 7},78%,${54 + groove * 2}%,${0.17 + (grooves - groove) * 0.055})`;
          ctx.lineWidth = groove === 0 ? 2.2 : 1;
          ctx.stroke();
        }

        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.62);
        glow.addColorStop(0, `hsla(${36 + bands.mid * 20},92%,62%,${0.36 + bands.energy * 0.35})`);
        glow.addColorStop(0.18, 'rgba(20,8,8,0.95)');
        glow.addColorStop(0.23, 'rgba(239,166,55,0.45)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - base, cy - base, base * 2, base * 2);
      },
    };
  }, [getFrequencyData, getWaveformData]);

  return <SceneCanvas width={width} height={height} setup={setup} />;
}

export function NeedleGarden({ width, height }: SceneProps) {
  const { getFrequencyData } = useAudio();
  const setup = useCallback<SceneSetup>((ctx, w, h) => {
    const read = makeBandReader(getFrequencyData);
    const count = Math.max(28, Math.min(64, Math.floor(w / 24)));
    let spectrum: Float32Array = new Float32Array(count);
    const smooth = new Float32Array(count);

    return {
      draw(time) {
        const bands = read();
        spectrum = sampleSpectrum(getFrequencyData(), count, spectrum);
        ctx.fillStyle = 'rgba(5,8,7,0.34)';
        ctx.fillRect(0, 0, w, h);
        const floor = h * 0.88;
        const span = w * 0.88;
        const start = w * 0.06;

        for (let i = 0; i < count; i++) {
          smooth[i] += (spectrum[i] - smooth[i]) * 0.18;
          const value = smooth[i];
          const x = start + (i / (count - 1)) * span;
          const stem = h * (0.18 + value * 0.48);
          const sway = Math.sin(time * 0.0007 + i * 0.43) * (5 + bands.bass * 20);
          const tipX = x + sway;
          const tipY = floor - stem;
          const hue = 34 + (i / count) * 138;

          ctx.beginPath();
          ctx.moveTo(x, floor);
          ctx.bezierCurveTo(x, floor - stem * 0.35, tipX - sway * 0.3, floor - stem * 0.72, tipX, tipY);
          ctx.strokeStyle = `hsla(${hue},70%,54%,${0.34 + value * 0.58})`;
          ctx.lineWidth = 0.7 + value * 2.4;
          ctx.stroke();

          if (value > 0.24) {
            const petals = 3 + Math.floor(bands.treble * 5);
            for (let p = 0; p < petals; p++) {
              const angle = (p / petals) * Math.PI * 2 + time * 0.00025;
              const radius = 2 + value * 8;
              ctx.beginPath();
              ctx.ellipse(
                tipX + Math.cos(angle) * radius,
                tipY + Math.sin(angle) * radius,
                1.2 + value * 2.5,
                3 + value * 4,
                angle,
                0,
                Math.PI * 2,
              );
              ctx.fillStyle = `hsla(${hue + 28},86%,68%,${0.18 + value * 0.55})`;
              ctx.fill();
            }
          }
        }
        const soil = ctx.createLinearGradient(0, floor - 10, 0, h);
        soil.addColorStop(0, 'rgba(237,168,57,0.08)');
        soil.addColorStop(1, 'rgba(5,8,7,0)');
        ctx.fillStyle = soil;
        ctx.fillRect(0, floor - 10, w, h - floor + 10);
      },
    };
  }, [getFrequencyData]);

  return <SceneCanvas width={width} height={height} setup={setup} />;
}

export function ChladniDust({ width, height }: SceneProps) {
  const { getFrequencyData } = useAudio();
  const setup = useCallback<SceneSetup>((ctx, w, h, reduced) => {
    const read = makeBandReader(getFrequencyData);
    const count = reduced ? 500 : Math.min(1500, Math.floor((w * h) / 850));
    const dust = Array.from({ length: count }, (_, index) => ({
      x: ((index * 0.61803398875) % 1) * 2 - 1,
      y: ((index * 0.41421356237) % 1) * 2 - 1,
      seed: (index * 0.754877666) % 1,
    }));

    return {
      draw(time) {
        const bands = read(0.22, 0.08);
        ctx.fillStyle = 'rgba(4,7,9,0.24)';
        ctx.fillRect(0, 0, w, h);
        const scale = Math.min(w, h) * 0.43;
        const m = 2 + bands.bass * 3.5;
        const n = 3 + bands.mid * 4.5;
        const phase = time * 0.00018 + bands.treble * 1.8;

        for (const particle of dust) {
          const x = particle.x;
          const y = particle.y;
          const field =
            Math.sin(Math.PI * m * x + phase) * Math.sin(Math.PI * n * y) -
            Math.sin(Math.PI * n * x) * Math.sin(Math.PI * m * y + phase);
          const closeness = Math.max(0, 1 - Math.abs(field) * 5.5);
          if (closeness <= 0.06) continue;
          const jitter = (1 - closeness) * 7;
          const px = w / 2 + x * scale + Math.sin(time * 0.001 + particle.seed * 20) * jitter;
          const py = h / 2 + y * scale + Math.cos(time * 0.0012 + particle.seed * 17) * jitter;
          const hue = 166 + particle.seed * 52 + bands.treble * 30;
          ctx.fillStyle = `hsla(${hue},72%,68%,${0.10 + closeness * 0.58})`;
          ctx.fillRect(px, py, 0.7 + closeness * 1.5, 0.7 + closeness * 1.5);
        }
      },
    };
  }, [getFrequencyData]);

  return <SceneCanvas width={width} height={height} setup={setup} />;
}

export function SleeveEcho({ width, height }: SceneProps) {
  const { currentAlbum, getFrequencyData } = useAudio();
  const coverUrl = currentAlbum?.coverUrl ?? null;
  const setup = useCallback<SceneSetup>((ctx, w, h, reduced) => {
    const read = makeBandReader(getFrequencyData);
    const image = new Image();
    let loaded = false;
    if (coverUrl) {
      image.onload = () => { loaded = true; };
      image.src = coverUrl;
    }
    const cx = w / 2;
    const cy = h / 2;
    const wedges = reduced ? 6 : 10;

    return {
      draw(time) {
        const bands = read();
        ctx.fillStyle = 'rgba(5,4,8,0.22)';
        ctx.fillRect(0, 0, w, h);
        const radius = Math.hypot(w, h) * (0.54 + bands.bass * 0.05);
        const rotation = time * 0.000025 + bands.mid * 0.08;

        if (loaded) {
          const source = Math.min(image.naturalWidth, image.naturalHeight);
          const sx = (image.naturalWidth - source) / 2;
          const sy = (image.naturalHeight - source) / 2;
          for (let i = 0; i < wedges; i++) {
            const angle = (i / wedges) * Math.PI * 2 + rotation;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, -Math.PI / wedges, Math.PI / wedges);
            ctx.closePath();
            ctx.clip();
            if (i % 2) ctx.scale(-1, 1);
            const size = radius * (1.12 + bands.energy * 0.22);
            ctx.globalAlpha = 0.32 + bands.energy * 0.38;
            ctx.drawImage(image, sx, sy, source, source, -size * 0.12, -size * 0.5, size, size);
            ctx.restore();
          }
        } else {
          for (let i = 0; i < wedges; i++) {
            const angle = (i / wedges) * Math.PI * 2 + rotation;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, angle, angle + Math.PI * 2 / wedges);
            ctx.fillStyle = `hsla(${270 + i * 13 + bands.treble * 50},62%,46%,${0.08 + bands.energy * 0.18})`;
            ctx.fill();
          }
        }

        const shade = ctx.createRadialGradient(cx, cy, radius * 0.06, cx, cy, radius);
        shade.addColorStop(0, `rgba(240,174,68,${0.12 + bands.energy * 0.16})`);
        shade.addColorStop(0.42, 'rgba(8,4,10,0.02)');
        shade.addColorStop(1, 'rgba(5,3,7,0.72)');
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, w, h);
      },
    };
  }, [coverUrl, getFrequencyData]);

  return <SceneCanvas width={width} height={height} setup={setup} />;
}
