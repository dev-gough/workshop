'use client';

import { useEffect, useRef } from 'react';
import { useAudio } from '@/components/AudioProvider';
import { makeBandReader, sampleSpectrum } from './audio-analysis';

// ── The Sound shelf ──────────────────────────────────────────────
// Every slide here reads the same analyser the floating player feeds, so
// whatever BarFoo is playing drives the dome. The room is dark-always, so
// none of these branch on the site theme.
//
// When nothing is playing the analyser honestly returns silence, and these
// keep their own motion — the tunnel still flies, the terrain still
// scrolls, the trace still sweeps — rather than inventing a spectrum to
// look busy. The control desk says so in as many words.

const VOID = 'rgba(5,7,14,';

// ── Spectrum: a straight bar analyser with peak hold ─────────────

export function SpectrumBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const barCount = Math.max(24, Math.min(72, Math.floor(width / 26)));
    const peaks = new Float32Array(barCount);
    const fall = new Float32Array(barCount);
    let spec: Float32Array = new Float32Array(barCount);

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      spec = sampleSpectrum(getFrequencyData(), barCount, spec);

      const span = width * 0.84;
      const barWidth = (span / barCount) * 0.8;
      const gap = (span / barCount) * 0.2;
      const startX = width * 0.08;
      const floorY = height - height * 0.09;
      const maxH = height * 0.62;

      for (let i = 0; i < barCount; i++) {
        const val = spec[i];
        const barH = val * maxH;
        const x = startX + i * (barWidth + gap);
        const hue = 188 + (i / barCount) * 150;

        ctx.fillStyle = `hsla(${hue}, 78%, 58%, ${0.34 + val * 0.5})`;
        ctx.beginPath();
        ctx.roundRect(x, floorY - barH, barWidth, barH, 2);
        ctx.fill();

        if (barH > peaks[i]) { peaks[i] = barH; fall[i] = 0; }
        else { fall[i] += 0.5; peaks[i] = Math.max(0, peaks[i] - fall[i] * 0.3); }
        ctx.fillStyle = `hsla(${hue}, 90%, 74%, 0.72)`;
        ctx.fillRect(x, floorY - peaks[i] - 2, barWidth, 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Orb: layered blobs breathing on the spectrum ─────────────────

export function OrbBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const baseR = Math.min(width, height) * 0.18;
    const points = 128;
    const smoothed = new Float32Array(points);
    let spec: Float32Array = new Float32Array(points);
    let t = 0;

    let raf: number;
    const draw = () => {
      ctx.fillStyle = VOID + '0.08)';
      ctx.fillRect(0, 0, width, height);
      t += 0.01;
      spec = sampleSpectrum(getFrequencyData(), points, spec);

      for (let layer = 2; layer >= 0; layer--) {
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const si = i % points;
          smoothed[si] += (spec[si] - smoothed[si]) * 0.15;
          const wobble = Math.sin(angle * 3 + t * 2) * 0.05 + Math.sin(angle * 5 - t) * 0.03;
          const r = baseR * (1 + layer * 0.3) + smoothed[si] * baseR * 1.5 + wobble * baseR;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const hue = (172 + layer * 52 + t * 18) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 55%, ${0.08 + layer * 0.03})`;
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue}, 84%, 64%, 0.22)`;
        ctx.lineWidth = 1.5 - layer * 0.3;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = VOID + '1)';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Aurora: three bands of particles rising ──────────────────────

export function AuroraBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const read = makeBandReader(getFrequencyData);

    const NUM = 300;
    const particles = Array.from({ length: NUM }, () => ({
      x: Math.random() * width,
      y: height + Math.random() * 50,
      vx: 0, vy: 0,
      life: Math.random() * 150 + 80,
      age: 0,
      band: Math.floor(Math.random() * 3),
      hue: Math.random() * 60,
      size: Math.random() * 2 + 1,
    }));
    const bandHues = [268, 165, 42];

    let raf: number;
    const draw = () => {
      ctx.fillStyle = VOID + '0.03)';
      ctx.fillRect(0, 0, width, height);

      const b = read();
      const bands = [b.bass, b.mid, b.treble];

      for (const p of particles) {
        const energy = bands[p.band];
        p.vy = -(1.5 + energy * 5);
        p.vx = Math.sin(p.y * 0.01 + p.x * 0.005) * (0.5 + energy * 2);
        p.x += p.vx;
        p.y += p.vy;
        p.age++;

        if (p.age > p.life || p.y < -20) {
          p.x = Math.random() * width;
          p.y = height + Math.random() * 30;
          p.age = 0;
          p.life = Math.random() * 150 + 80;
          p.band = Math.floor(Math.random() * 3);
          p.hue = Math.random() * 60;
        }

        const fadeIn = Math.min(p.age / 15, 1);
        const fadeOut = Math.max(0, 1 - p.age / p.life);
        const alpha = fadeIn * fadeOut * (0.15 + energy * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + energy * 1.5), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${bandHues[p.band] + p.hue}, 70%, 62%, ${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = VOID + '1)';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Radial: the same bars, wrapped around the dial ───────────────

export function RadialSpectrumBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const spokeCount = 72;
    const baseR = Math.min(width, height) * 0.12;
    const maxSpoke = Math.min(width, height) * 0.34;
    const smoothed = new Float32Array(spokeCount);
    let spec: Float32Array = new Float32Array(spokeCount);
    let rot = 0;

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      rot += 0.002;
      spec = sampleSpectrum(getFrequencyData(), spokeCount, spec);

      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, (Math.min(width, height) / spokeCount) * 0.5);

      for (let i = 0; i < spokeCount; i++) {
        smoothed[i] += (spec[i] - smoothed[i]) * 0.2;
        const v = smoothed[i];
        const angle = (i / spokeCount) * Math.PI * 2 + rot;
        const len = baseR + v * maxSpoke;
        const hue = 178 + (i / spokeCount) * 170 + rot * 26;
        ctx.strokeStyle = `hsla(${hue}, 80%, 62%, ${0.14 + v * 0.55})`;

        for (const a of [angle, angle + Math.PI]) {
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR);
          ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(207,224,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Spectral terrain ─────────────────────────────────────────────
// A rolling landscape whose every ridge is one past FFT frame. The newest
// spectrum enters at the front edge and the whole terrain walks toward the
// horizon, so you're looking at the last few seconds of the track laid out
// in depth.

export function TerrainBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const COLS = 84;
    const ROWS = 58;
    // Ring buffer of past spectra; `head` is where the next frame lands.
    const rows = new Float32Array(ROWS * COLS);
    let head = 0;
    let filled = 0;
    let spec: Float32Array = new Float32Array(COLS);
    let frame = 0;

    const horizon = height * 0.30;
    const depthOf = (age: number) => age / (ROWS - 1);
    // Not a true perspective divide — a shaped falloff reads better at
    // these depths and keeps the front ridge inside the frame.
    const rowY = (d: number) => horizon + height * 0.70 * Math.pow(1 - d, 1.55);
    const rowScale = (d: number) => 0.30 + 0.70 * Math.pow(1 - d, 0.75);

    let raf: number;
    const draw = () => {
      frame++;
      // One new ridge every other frame — 30 ridges/sec walks the terrain
      // at a speed you can actually follow.
      if (frame % 2 === 0) {
        spec = sampleSpectrum(getFrequencyData(), COLS, spec);
        rows.set(spec, head * COLS);
        head = (head + 1) % ROWS;
        if (filled < ROWS) filled++;
      }

      ctx.clearRect(0, 0, width, height);

      // Painter's algorithm: farthest ridge first, each one filled with the
      // dome colour so the ridges in front genuinely occlude it.
      for (let age = ROWS - 1; age >= 0; age--) {
        if (age >= filled) continue;
        const src = ((head - 1 - age) % ROWS + ROWS) % ROWS;
        const d = depthOf(age);
        const y0 = rowY(d);
        const s = rowScale(d);
        const amp = height * 0.20 * s;
        const halfSpan = width * 0.56 * s;
        const cx = width / 2;

        ctx.beginPath();
        for (let c = 0; c < COLS; c++) {
          const x = cx + (c / (COLS - 1) - 0.5) * halfSpan * 2;
          const y = y0 - rows[src * COLS + c] * amp;
          if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        const fade = 1 - d;
        ctx.lineTo(cx + halfSpan, y0 + 4);
        ctx.lineTo(cx - halfSpan, y0 + 4);
        ctx.closePath();
        ctx.fillStyle = `rgba(5,7,14,${0.55 + 0.35 * fade})`;
        ctx.fill();

        ctx.strokeStyle = `hsla(${188 + d * 130}, 82%, ${44 + fade * 26}%, ${0.12 + fade * 0.7})`;
        ctx.lineWidth = 0.6 + fade * 1.3;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Frequency tunnel ─────────────────────────────────────────────
// Each ring is a spectrum frozen at the moment it was born, then flown at
// the viewer. Looking down the tunnel is looking back through the track:
// the rings near the vanishing point are what played a moment ago.

interface Ring { z: number; spin: number; hue: number; hot: number; shape: Float32Array }

export function TunnelBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const read = makeBandReader(getFrequencyData);

    const SPOKES = 56;
    const baseR = Math.min(width, height) * 0.11;
    const cx = width / 2, cy = height / 2;
    const rings: Ring[] = [];
    let spec: Float32Array = new Float32Array(SPOKES);
    let frame = 0;
    let spin = 0;
    let hue = 190;

    let raf: number;
    const draw = () => {
      frame++;
      const b = read();
      spin += 0.004 + b.mid * 0.012;
      hue = (hue + 0.14 + b.treble * 0.5) % 360;

      // Emit on a steady clock, and again on a kick so the beat shows up as
      // a bright ring rather than a brightness change.
      if (frame % 4 === 0 || b.kick) {
        spec = sampleSpectrum(getFrequencyData(), SPOKES, spec);
        rings.push({ z: 1, spin, hue, hot: b.kick ? 1 : 0, shape: Float32Array.from(spec) });
        if (rings.length > 46) rings.shift();
      }

      for (const r of rings) r.z -= 0.0075 + b.bass * 0.012;
      while (rings.length && rings[0].z <= 0.045) rings.shift();

      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = 'round';

      // Far rings first so near ones draw over them.
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        const radius = baseR / r.z;
        if (radius > Math.max(width, height) * 1.5) continue;
        const near = 1 - r.z;                       // 0 at the vanishing point
        const alpha = Math.min(1, r.z * 1.6) * (0.16 + near * 0.5);

        ctx.beginPath();
        for (let s = 0; s <= SPOKES; s++) {
          const a = (s % SPOKES) / SPOKES * Math.PI * 2 + r.spin;
          const rr = radius * (1 + r.shape[s % SPOKES] * 0.55);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `hsla(${r.hue}, ${74 + r.hot * 20}%, ${52 + r.hot * 26}%, ${alpha})`;
        ctx.lineWidth = (0.8 + near * 2.4) * (1 + r.hot * 0.8);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getFrequencyData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Waveform ribbon ──────────────────────────────────────────────
// The raw time-domain trace, not the spectrum — an oscilloscope whose old
// sweeps drift upward and fade instead of being erased, leaving a ribbon of
// the last second or so of the actual waveform.

export function RibbonBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getWaveformData } = useAudio();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const PTS = 200;
    const TRAILS = 30;
    const trace = new Float32Array(TRAILS * PTS);
    let head = 0;
    let filled = 0;
    let t = 0;

    let raf: number;
    const draw = () => {
      t += 0.006;
      const wave = getWaveformData();
      const slot = head * PTS;
      if (wave && wave.length) {
        const step = wave.length / PTS;
        for (let i = 0; i < PTS; i++) {
          // 128 is the zero line for byte time-domain data.
          trace[slot + i] = (wave[Math.min(wave.length - 1, (i * step) | 0)] - 128) / 128;
        }
      } else {
        trace.fill(0, slot, slot + PTS);
      }
      head = (head + 1) % TRAILS;
      if (filled < TRAILS) filled++;

      ctx.clearRect(0, 0, width, height);
      const cy = height * 0.55;
      const amp = height * 0.26;

      // Oldest sweep first: it sits highest and faintest.
      for (let age = TRAILS - 1; age >= 0; age--) {
        if (age >= filled) continue;
        const src = ((head - 1 - age) % TRAILS + TRAILS) % TRAILS;
        const f = age / (TRAILS - 1);
        const lift = Math.pow(f, 1.3) * height * 0.24;
        const shrink = 1 - f * 0.35;

        ctx.beginPath();
        for (let i = 0; i < PTS; i++) {
          const x = (i / (PTS - 1)) * width;
          const drift = Math.sin(i * 0.05 + t + f * 2.2) * 4 * f;
          const y = cy - lift + trace[src * PTS + i] * amp * shrink + drift;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${(168 + f * 150 + t * 24) % 360}, 88%, ${68 - f * 18}%, ${(1 - f) * 0.7 + 0.04})`;
        ctx.lineWidth = 2.1 - f * 1.5;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, getWaveformData]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
