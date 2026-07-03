'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { useAudio } from '@/components/AudioProvider';

// ── Audio Visualizer Backgrounds ─────────────────────────────────

export function SpectrumBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData, isPlaying } = useAudio();
  const { theme } = useTheme();
  const peaksRef = useRef<number[]>([]);
  const peakDecayRef = useRef<number[]>([]);

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    const barCount = 48;
    peaksRef.current = new Array(barCount).fill(0);
    peakDecayRef.current = new Array(barCount).fill(0);

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const data = getFrequencyData();
      const barWidth = (width * 0.8) / barCount;
      const gap = barWidth * 0.2;
      const startX = width * 0.1;
      const maxH = height * 0.7;

      for (let i = 0; i < barCount; i++) {
        let val = 0;
        if (data && data.length > 0) {
          const idx = Math.min(Math.floor((i / barCount) * data.length), data.length - 1);
          val = data[idx] / 255;
        }
        const barH = val * maxH;
        const x = startX + i * (barWidth + gap);
        const y = height - 40 - barH;

        // Color gradient: warm bass -> cool treble
        const hue = 0 + (i / barCount) * 240;
        const alpha = isDark ? 0.6 + val * 0.3 : 0.4 + val * 0.3;
        ctx.fillStyle = `hsla(${hue}, 80%, ${isDark ? 55 : 45}%, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 2);
        ctx.fill();

        // Peak hold dot
        if (barH > peaksRef.current[i]) {
          peaksRef.current[i] = barH;
          peakDecayRef.current[i] = 0;
        } else {
          peakDecayRef.current[i] += 0.5;
          peaksRef.current[i] = Math.max(0, peaksRef.current[i] - peakDecayRef.current[i] * 0.3);
        }
        const peakY = height - 40 - peaksRef.current[i];
        ctx.fillStyle = `hsla(${hue}, 90%, ${isDark ? 70 : 55}%, ${isDark ? 0.8 : 0.6})`;
        ctx.fillRect(x, peakY - 2, barWidth, 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, getFrequencyData, isPlaying]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

export function OrbBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData, isPlaying } = useAudio();
  const { theme } = useTheme();
  const smoothedRef = useRef<number[]>([]);

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    const cx = width / 2, cy = height / 2;
    const baseR = Math.min(width, height) * 0.18;
    const points = 128;
    smoothedRef.current = new Array(points).fill(0);
    let t = 0;

    let raf: number;
    const draw = () => {
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, 0, width, height);
      t += 0.01;

      const data = getFrequencyData();

      for (let layer = 2; layer >= 0; layer--) {
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          let freqVal = 0;
          if (data && data.length > 0) {
            const idx = Math.floor((i % points) / points * data.length);
            freqVal = data[idx] / 255;
          }
          // Smooth the values
          const si = i % points;
          smoothedRef.current[si] += (freqVal - smoothedRef.current[si]) * 0.15;
          const sVal = smoothedRef.current[si];

          const wobble = Math.sin(angle * 3 + t * 2) * 0.05 + Math.sin(angle * 5 - t) * 0.03;
          const r = baseR * (1 + layer * 0.3) + sVal * baseR * 1.5 + wobble * baseR;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();

        const hue = (layer * 60 + t * 20) % 360;
        const alpha = isDark ? 0.08 + layer * 0.03 : 0.05 + layer * 0.02;
        ctx.fillStyle = `hsla(${hue}, 70%, ${isDark ? 55 : 40}%, ${alpha})`;
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue}, 80%, ${isDark ? 60 : 45}%, ${isDark ? 0.2 : 0.12})`;
        ctx.lineWidth = 1.5 - layer * 0.3;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, getFrequencyData, isPlaying]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

export function AuroraBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData, isPlaying } = useAudio();
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';

    const NUM = 300;
    const particles = Array.from({ length: NUM }, () => ({
      x: Math.random() * width,
      y: height + Math.random() * 50,
      vx: 0,
      vy: 0,
      life: Math.random() * 150 + 80,
      age: 0,
      band: Math.floor(Math.random() * 3), // 0=bass, 1=mid, 2=treble
      hue: Math.random() * 60, // offset within band color
      size: Math.random() * 2 + 1,
    }));

    let raf: number;
    const draw = () => {
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, width, height);

      const data = getFrequencyData();
      // Split into 3 bands
      let bass = 0, mid = 0, treble = 0;
      if (data && data.length > 0) {
        const third = Math.floor(data.length / 3);
        for (let i = 0; i < third; i++) bass += data[i];
        for (let i = third; i < third * 2; i++) mid += data[i];
        for (let i = third * 2; i < data.length; i++) treble += data[i];
        bass = bass / third / 255;
        mid = mid / third / 255;
        treble = treble / (data.length - third * 2) / 255;
      }
      const bands = [bass, mid, treble];
      const bandHues = [280, 160, 60]; // purple, teal, warm

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
        const alpha = fadeIn * fadeOut * (0.15 + energy * 0.4) * (isDark ? 1 : 0.7);
        const hue = bandHues[p.band] + p.hue;
        const sz = p.size * (1 + energy * 1.5);

        ctx.beginPath();
        ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 70%, ${isDark ? 60 : 45}%, ${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, getFrequencyData, isPlaying]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

export function RadialSpectrumBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getFrequencyData, isPlaying } = useAudio();
  const { theme } = useTheme();
  const rotRef = useRef(0);
  const smoothedRef = useRef<number[]>([]);

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    const cx = width / 2, cy = height / 2;
    const spokeCount = 64;
    const baseR = Math.min(width, height) * 0.12;
    const maxSpoke = Math.min(width, height) * 0.32;
    smoothedRef.current = new Array(spokeCount).fill(0);

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      rotRef.current += 0.002;

      const data = getFrequencyData();

      // Draw mirrored spokes
      for (let i = 0; i < spokeCount; i++) {
        let val = 0;
        if (data && data.length > 0) {
          const idx = Math.floor((i / spokeCount) * data.length);
          val = data[idx] / 255;
        }
        // Smooth
        smoothedRef.current[i] += (val - smoothedRef.current[i]) * 0.2;
        const sVal = smoothedRef.current[i];

        const angle = (i / spokeCount) * Math.PI * 2 + rotRef.current;
        const spokeLen = baseR + sVal * maxSpoke;
        const hue = (i / spokeCount) * 300 + rotRef.current * 30;
        const alpha = isDark ? 0.15 + sVal * 0.5 : 0.1 + sVal * 0.4;

        // Draw spoke from center outward
        const x1 = cx + Math.cos(angle) * baseR;
        const y1 = cy + Math.sin(angle) * baseR;
        const x2 = cx + Math.cos(angle) * spokeLen;
        const y2 = cy + Math.sin(angle) * spokeLen;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `hsla(${hue}, 80%, ${isDark ? 60 : 45}%, ${alpha})`;
        ctx.lineWidth = Math.max(1.5, (width / spokeCount) * 0.4);
        ctx.lineCap = 'round';
        ctx.stroke();

        // Mirror spoke
        const mirrorAngle = angle + Math.PI;
        const mx1 = cx + Math.cos(mirrorAngle) * baseR;
        const my1 = cy + Math.sin(mirrorAngle) * baseR;
        const mx2 = cx + Math.cos(mirrorAngle) * spokeLen;
        const my2 = cy + Math.sin(mirrorAngle) * spokeLen;

        ctx.beginPath();
        ctx.moveTo(mx1, my1);
        ctx.lineTo(mx2, my2);
        ctx.stroke();
      }

      // Subtle center circle
      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, getFrequencyData, isPlaying]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
