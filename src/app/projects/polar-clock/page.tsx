'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Settings, X, Maximize, Minimize, ChevronDown, Download } from 'lucide-react';
import { generateWallpaperHTML, generateWEProjectJson, generateLivelyProperties, downloadZip, type WallpaperSettings } from './wallpaper-export';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '@/components/ThemeProvider';

// ── Helpers ─────────────────────────────────────────────────────
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000`;
}

// ── Color palettes ──────────────────────────────────────────────
const PALETTES: Record<string, { name: string; colors: string[] }> = {
  default: {
    name: 'Indigo Teal',
    colors: ['hsl(225,70%,60%)', 'hsl(172,66%,45%)', 'hsl(350,80%,62%)', 'hsl(45,93%,55%)', 'hsl(280,65%,62%)', 'hsl(160,60%,45%)', 'hsl(30,80%,55%)'],
  },
  sunset: {
    name: 'Sunset',
    colors: ['hsl(350,85%,60%)', 'hsl(25,90%,55%)', 'hsl(45,95%,55%)', 'hsl(15,80%,50%)', 'hsl(330,70%,55%)', 'hsl(0,75%,60%)', 'hsl(40,85%,50%)'],
  },
  ocean: {
    name: 'Ocean',
    colors: ['hsl(200,80%,50%)', 'hsl(180,70%,45%)', 'hsl(220,75%,55%)', 'hsl(190,65%,50%)', 'hsl(240,60%,60%)', 'hsl(170,60%,45%)', 'hsl(210,70%,50%)'],
  },
  neon: {
    name: 'Neon',
    colors: ['hsl(280,100%,65%)', 'hsl(160,100%,50%)', 'hsl(320,100%,60%)', 'hsl(190,100%,50%)', 'hsl(60,100%,55%)', 'hsl(130,100%,50%)', 'hsl(300,100%,60%)'],
  },
  mono: {
    name: 'Monochrome',
    colors: ['hsl(220,15%,55%)', 'hsl(220,15%,45%)', 'hsl(220,15%,65%)', 'hsl(220,15%,40%)', 'hsl(220,15%,60%)', 'hsl(220,15%,50%)', 'hsl(220,15%,70%)'],
  },
  aurora: {
    name: 'Aurora',
    colors: ['hsl(150,70%,45%)', 'hsl(170,60%,50%)', 'hsl(130,65%,40%)', 'hsl(270,50%,55%)', 'hsl(190,55%,45%)', 'hsl(290,45%,50%)', 'hsl(160,60%,48%)'],
  },
  cyberpunk: {
    name: 'Cyberpunk',
    colors: ['hsl(325,100%,55%)', 'hsl(195,100%,50%)', 'hsl(55,100%,50%)', 'hsl(280,100%,60%)', 'hsl(170,100%,45%)', 'hsl(340,95%,50%)', 'hsl(210,100%,55%)'],
  },
  earth: {
    name: 'Earth',
    colors: ['hsl(15,60%,45%)', 'hsl(140,35%,35%)', 'hsl(35,50%,40%)', 'hsl(25,70%,50%)', 'hsl(160,30%,40%)', 'hsl(45,55%,45%)', 'hsl(10,45%,38%)'],
  },
};

// ── Timezones ───────────────────────────────────────────────────
const TIMEZONE_OPTIONS = [
  { label: 'New York', value: 'America/New_York' },
  { label: 'Los Angeles', value: 'America/Los_Angeles' },
  { label: 'Chicago', value: 'America/Chicago' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Paris', value: 'Europe/Paris' },
  { label: 'Berlin', value: 'Europe/Berlin' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
  { label: 'Dubai', value: 'Asia/Dubai' },
  { label: 'Mumbai', value: 'Asia/Kolkata' },
  { label: 'Singapore', value: 'Asia/Singapore' },
  { label: 'Hong Kong', value: 'Asia/Hong_Kong' },
  { label: 'Moscow', value: 'Europe/Moscow' },
  { label: 'Sao Paulo', value: 'America/Sao_Paulo' },
  { label: 'Auckland', value: 'Pacific/Auckland' },
  { label: 'Honolulu', value: 'Pacific/Honolulu' },
  { label: 'Denver', value: 'America/Denver' },
  { label: 'Kingston', value: 'America/Toronto' },
  { label: 'Vancouver', value: 'America/Vancouver' },
  { label: 'Seoul', value: 'Asia/Seoul' },
];

interface RingConfig {
  seconds: boolean;
  minutes: boolean;
  hours: boolean;
  days: boolean;
  months: boolean;
  dayOfYear: boolean;
  weekOfYear: boolean;
}

interface CitySlot {
  label: string;
  timezone: string;
}

// ── GOL Engine (lightweight, for background) ────────────────────
class GOLEngine {
  rows: number; cols: number;
  current: Uint8Array; next: Uint8Array;
  constructor(rows: number, cols: number) {
    this.rows = rows; this.cols = cols;
    this.current = new Uint8Array(rows * cols);
    this.next = new Uint8Array(rows * cols);
  }
  randomize() {
    for (let i = 0; i < this.current.length; i++)
      this.current[i] = Math.random() > 0.7 ? 1 : 0;
  }
  step() {
    const { rows, cols, current, next } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
              n += current[nr * cols + nc];
          }
        }
        const idx = r * cols + c;
        next[idx] = current[idx] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    [this.current, this.next] = [this.next, this.current];
  }
}

// ── Background: Game of Life ────────────────────────────────────
function GOLBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GOLEngine | null>(null);
  const { theme } = useTheme();
  const cellSize = 8;

  useEffect(() => {
    if (!width || !height) return;
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const engine = new GOLEngine(rows, cols);
    engine.randomize();
    engineRef.current = engine;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const cellColor = theme === 'dark' ? 'rgba(100,140,200,0.12)' : 'rgba(60,90,140,0.08)';

    let raf: number;
    let lastStep = 0;
    const draw = (t: number) => {
      if (t - lastStep > 150) {
        engine.step();
        lastStep = t;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = cellColor;
        for (let r = 0; r < engine.rows; r++) {
          for (let c = 0; c < engine.cols; c++) {
            if (engine.current[r * engine.cols + c]) {
              ctx.fillRect(c * cellSize, r * cellSize, cellSize - 1, cellSize - 1);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Background: Fractal (Julia Set) ─────────────────────────────
// ── Shared WebGL fractal setup ───────────────────────────────────
const VERT_SHADER = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRACTAL_COMMON = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_isDark;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  vec4 colorize(int iter, int maxIter) {
    if (iter == maxIter) return vec4(0.0);
    float v = float(iter) / float(maxIter);
    float hue = v * 0.67 + 0.55;
    float sat = u_isDark > 0.5 ? 0.85 : 0.9;
    float val = u_isDark > 0.5 ? 0.4 + v * 0.6 : 0.2 + v * 0.6;
    vec3 col = hsv2rgb(vec3(hue, sat, val));
    float alpha = u_isDark > 0.5 ? 0.65 : 0.45;
    return vec4(col * alpha, alpha);
  }
`;

const JULIA_FRAG = FRACTAL_COMMON + `
  uniform float u_manual;
  uniform vec2 u_c;
  uniform float u_zoom;
  uniform vec2 u_zoomCenter;
  void main() {
    float zoom = u_manual > 0.5 ? max(1.0, u_zoom) : 1.0;
    float scale = 3.0 / (min(u_resolution.x, u_resolution.y) * zoom);
    vec2 z = (gl_FragCoord.xy - u_resolution * 0.5) * scale + u_zoomCenter * (1.0 - 1.0/zoom);
    z.y = -z.y;
    float cRe = u_manual > 0.5 ? u_c.x : -0.7 + 0.15 * cos(u_time);
    float cIm = u_manual > 0.5 ? u_c.y : 0.27015 + 0.1 * sin(u_time * 0.7);
    int iter = 0;
    for (int i = 0; i < 80; i++) {
      if (z.x * z.x + z.y * z.y > 4.0) break;
      float tmp = z.x * z.x - z.y * z.y + cRe;
      z.y = 2.0 * z.x * z.y + cIm;
      z.x = tmp;
      iter++;
    }
    gl_FragColor = colorize(iter, 80);
  }
`;

const MANDELBROT_FRAG = FRACTAL_COMMON + `
  void main() {
    // Slowly zoom into Seahorse Valley (-0.75, 0.1)
    float cycle = mod(u_time * 0.15, 30.0);
    float zoom = 1.0 + cycle * cycle * 0.5;
    vec2 center = vec2(-0.75, 0.1);

    float scale = 3.0 / (min(u_resolution.x, u_resolution.y) * zoom);
    vec2 c = (gl_FragCoord.xy - u_resolution * 0.5) * scale + center;
    c.y = -c.y;
    vec2 z = vec2(0.0);
    int iter = 0;
    for (int i = 0; i < 120; i++) {
      if (z.x * z.x + z.y * z.y > 4.0) break;
      float tmp = z.x * z.x - z.y * z.y + c.x;
      z.y = 2.0 * z.x * z.y + c.y;
      z.x = tmp;
      iter++;
    }
    gl_FragColor = colorize(iter, 120);
  }
`;

function WebGLFractalBackground({ width, height, fragSrc, extraUniforms }: {
  width: number; height: number; fragSrc: string;
  extraUniforms?: (gl: WebGLRenderingContext, prog: WebGLProgram) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const timeRef = useRef(0);
  const extraRef = useRef(extraUniforms);
  extraRef.current = extraUniforms;

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext('webgl');
    if (!gl) return;

    const isDark = theme === 'dark';

    function compileShader(src: string, type: number) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compileShader(VERT_SHADER, gl.VERTEX_SHADER));
    gl.attachShader(prog, compileShader(fragSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uDark = gl.getUniformLocation(prog, 'u_isDark');

    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let raf: number;
    const render = () => {
      timeRef.current += 0.003;
      gl!.uniform2f(uRes, width, height);
      gl!.uniform1f(uTime, timeRef.current);
      gl!.uniform1f(uDark, isDark ? 1.0 : 0.0);
      extraRef.current?.(gl!, prog);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, fragSrc]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// Find an interesting zoom target on the Julia set boundary
function findJuliaBoundaryPoint(cRe: number, cIm: number): [number, number] {
  const maxIter = 80;
  const gridSize = 40;
  const scale = 3.0;
  let bestX = 0, bestY = 0, bestScore = -1;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const zx0 = (gx / gridSize - 0.5) * scale;
      const zy0 = (gy / gridSize - 0.5) * scale;
      let zx = zx0, zy = zy0;
      let iter = 0;
      while (zx * zx + zy * zy < 4 && iter < maxIter) {
        const tmp = zx * zx - zy * zy + cRe;
        zy = 2 * zx * zy + cIm;
        zx = tmp;
        iter++;
      }
      // Best score: iterations close to 60-70% of max (boundary region, not inside)
      if (iter < maxIter) {
        const score = iter - Math.abs(iter - maxIter * 0.65) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestX = zx0;
          bestY = -zy0;
        }
      }
    }
  }
  return [bestX, bestY];
}

function JuliaBackground({ width, height, manual, cRe, cIm, dragging }: {
  width: number; height: number; manual: boolean; cRe: number; cIm: number; dragging: boolean;
}) {
  const zoomRef = useRef(1);
  const zoomTargetRef = useRef<[number, number]>([0, 0]);
  const lastDragging = useRef(dragging);

  // Reset zoom when user starts dragging; find target when they release
  useEffect(() => {
    if (dragging && !lastDragging.current) {
      zoomRef.current = 1;
    }
    if (!dragging && lastDragging.current) {
      zoomRef.current = 1;
      zoomTargetRef.current = findJuliaBoundaryPoint(cRe, cIm);
    }
    lastDragging.current = dragging;
  }, [dragging, cRe, cIm]);

  const setUniforms = useCallback((gl: WebGLRenderingContext, prog: WebGLProgram) => {
    if (manual && !dragging) {
      zoomRef.current += zoomRef.current * 0.0005;
    }
    gl.uniform1f(gl.getUniformLocation(prog, 'u_manual'), manual ? 1.0 : 0.0);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_c'), cRe, cIm);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoomRef.current);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_zoomCenter'), zoomTargetRef.current[0], zoomTargetRef.current[1]);
  }, [manual, cRe, cIm, dragging]);
  return <WebGLFractalBackground width={width} height={height} fragSrc={JULIA_FRAG} extraUniforms={setUniforms} />;
}

function MandelbrotBackground({ width, height }: { width: number; height: number }) {
  return <WebGLFractalBackground width={width} height={height} fragSrc={MANDELBROT_FRAG} />;
}

// ── Background: Koch Snowflake ───────────────────────────────────
function KochBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
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

// ── Background: Starfield ───────────────────────────────────────
function StarfieldBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;

    const NUM_STARS = 400;
    const stars = Array.from({ length: NUM_STARS }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: Math.random() * 0.01 + 0.001,
      speed: Math.random() * 0.3 + 0.1,
      size: Math.random() * 1.5 + 0.5,
      brightness: Math.random() * 0.5 + 0.3,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const isDark = theme === 'dark';

      for (const star of stars) {
        star.dist += star.speed * 0.002;
        star.angle += 0.001;
        if (star.dist > 1.5) {
          star.dist = Math.random() * 0.01 + 0.001;
          star.angle = Math.random() * Math.PI * 2;
        }

        const maxDim = Math.max(width, height);
        const x = cx + Math.cos(star.angle) * star.dist * maxDim;
        const y = cy + Math.sin(star.angle) * star.dist * maxDim;

        const alpha = Math.min(star.dist * 2, 1) * star.brightness * (isDark ? 0.7 : 0.4);
        const sz = star.size * (0.5 + star.dist * 2);

        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(180,200,240,${alpha})`
          : `rgba(60,80,140,${alpha})`;
        ctx.fill();

        // Streak for fast-moving distant stars
        if (star.dist > 0.3) {
          const streakLen = star.speed * star.dist * 15;
          const sx = x - Math.cos(star.angle) * streakLen;
          const sy = y - Math.sin(star.angle) * streakLen;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(x, y);
          ctx.strokeStyle = isDark
            ? `rgba(180,200,240,${alpha * 0.4})`
            : `rgba(60,80,140,${alpha * 0.3})`;
          ctx.lineWidth = sz * 0.5;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Background: Particle Flow (Perlin noise) ────────────────────
function ParticleFlowBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

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

// ── Background: Matrix Rain ─────────────────────────────────────
function MatrixRainBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const fontSize = 14;
    const cols = Math.ceil(width / fontSize);
    const drops = new Float32Array(cols);
    for (let i = 0; i < cols; i++) drops[i] = Math.random() * -100;

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
    const isDark = theme === 'dark';

    let raf: number;
    let lastTick = 0;

    const draw = (t: number) => {
      if (t - lastTick > 50) {
        lastTick = t;
        ctx.fillStyle = isDark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < cols; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          // Head character brighter
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = isDark
            ? `rgba(80,200,120,0.25)`
            : `rgba(0,80,20,0.35)`;
          ctx.fillText(char, x, y);

          if (y > height && Math.random() > 0.98) {
            drops[i] = 0;
          }
          drops[i] += 0.5 + Math.random() * 0.5;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Background: Voronoi Cells ───────────────────────────────────
function VoronoiBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Use lower resolution for performance
    const scale = 3;
    const w = Math.ceil(width / scale);
    const h = Math.ceil(height / scale);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;

    const NUM_SEEDS = 20;
    const seeds = Array.from({ length: NUM_SEEDS }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      hue: Math.random() * 360,
    }));

    const isDark = theme === 'dark';
    let raf: number;
    let lastTick = 0;

    const draw = (t: number) => {
      if (t - lastTick < 80) { raf = requestAnimationFrame(draw); return; }
      lastTick = t;

      // Move seeds
      for (const s of seeds) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0 || s.x > w) s.vx *= -1;
        if (s.y < 0 || s.y > h) s.vy *= -1;
        s.hue += 0.1;
      }

      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          let minDist = Infinity;
          let minDist2 = Infinity;
          let closest = 0;

          for (let i = 0; i < NUM_SEEDS; i++) {
            const dx = px - seeds[i].x, dy = py - seeds[i].y;
            const d = dx * dx + dy * dy;
            if (d < minDist) { minDist2 = minDist; minDist = d; closest = i; }
            else if (d < minDist2) { minDist2 = d; }
          }

          const edge = Math.sqrt(minDist2) - Math.sqrt(minDist);
          const idx = (py * w + px) * 4;

          if (edge < 2) {
            // Edge line
            const a = isDark ? 40 : 25;
            data[idx] = isDark ? 150 : 80;
            data[idx + 1] = isDark ? 170 : 100;
            data[idx + 2] = isDark ? 200 : 140;
            data[idx + 3] = a;
          } else {
            // Cell fill
            const hue = seeds[closest].hue % 360;
            const a = isDark ? 12 : 8;
            // Simple hue to RGB
            const h60 = hue / 60;
            const x = 1 - Math.abs(h60 % 2 - 1);
            let r = 0, g = 0, b = 0;
            if (h60 < 1) { r = 1; g = x; }
            else if (h60 < 2) { r = x; g = 1; }
            else if (h60 < 3) { g = 1; b = x; }
            else if (h60 < 4) { g = x; b = 1; }
            else if (h60 < 5) { r = x; b = 1; }
            else { r = 1; b = x; }
            data[idx] = r * 200;
            data[idx + 1] = g * 200;
            data[idx + 2] = b * 200;
            data[idx + 3] = a;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: width, height: height, imageRendering: 'auto' }} />;
}

// ── Background: Ripples ─────────────────────────────────────────
function RipplesBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const isDark = theme === 'dark';

    interface Ripple {
      x: number; y: number; birth: number; speed: number;
    }
    const ripples: Ripple[] = [];
    let lastSpawn = 0;

    let raf: number;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // Spawn new ripple periodically
      if (t - lastSpawn > 1800 + Math.random() * 1200) {
        lastSpawn = t;
        ripples.push({
          x: cx + (Math.random() - 0.5) * width * 0.6,
          y: cy + (Math.random() - 0.5) * height * 0.6,
          birth: t,
          speed: 0.08 + Math.random() * 0.04,
        });
      }

      // Draw ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        const age = (t - rip.birth) * rip.speed;
        const maxAge = Math.max(width, height) * 0.8;

        if (age > maxAge) { ripples.splice(i, 1); continue; }

        const numRings = 4;
        for (let r = 0; r < numRings; r++) {
          const radius = age - r * 25;
          if (radius < 0) continue;
          const fadeIn = Math.min(radius / 30, 1);
          const fadeOut = Math.max(0, 1 - age / maxAge);
          const alpha = fadeIn * fadeOut * (1 - r * 0.2) * (isDark ? 0.2 : 0.3);

          ctx.beginPath();
          ctx.arc(rip.x, rip.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = isDark
            ? `rgba(120,170,230,${alpha})`
            : `rgba(30,70,160,${alpha})`;
          ctx.lineWidth = isDark ? 1.5 - r * 0.3 : 2 - r * 0.3;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Polar Clock SVG ─────────────────────────────────────────────
function PolarClockSVG({
  timezone, label, time, palette, smooth, rings, size, showCity = true, showDate = true,
}: {
  timezone: string; label: string; time: Date;
  palette: string; smooth: boolean; rings: RingConfig; size: number;
  showCity?: boolean; showDate?: boolean;
}) {
  const { theme } = useTheme();
  const colors = PALETTES[palette]?.colors ?? PALETTES.default.colors;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    day: 'numeric', month: 'numeric', year: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(time);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');

  const seconds = get('second') + (smooth ? time.getMilliseconds() / 1000 : 0);
  const minutes = get('minute') + (smooth ? seconds / 60 : 0);
  const hours = get('hour') + (smooth ? minutes / 60 : 0);
  const day = get('day');
  const month = get('month');
  const year = get('year');
  const daysInMonth = new Date(year, month, 0).getDate();

  const tzOffset = new Date(time.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const localTime = new Date(tzOffset);
  const dayOfYear = Math.floor((localTime.getTime() - new Date(localTime.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const jan1 = new Date(year, 0, 1);
  const weekOfYear = Math.ceil(((localTime.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);

  const bgRingColor = theme === 'dark' ? 'rgba(40,50,70,0.6)' : 'rgba(200,210,220,0.6)';
  const textColor = theme === 'dark' ? 'hsl(210,20%,92%)' : 'hsl(224,30%,15%)';
  const mutedColor = theme === 'dark' ? 'hsl(210,10%,60%)' : 'hsl(220,10%,45%)';

  const activeRings: { label: string; value: string; percentage: number; color: string }[] = [];
  let ci = 0;
  if (rings.weekOfYear) activeRings.push({ label: 'Week', value: `W${weekOfYear}`, percentage: (weekOfYear / 52) * 100, color: colors[ci++ % colors.length] });
  if (rings.dayOfYear) activeRings.push({ label: 'Year Day', value: `${dayOfYear}/${daysInYear}`, percentage: (dayOfYear / daysInYear) * 100, color: colors[ci++ % colors.length] });
  if (rings.months) activeRings.push({ label: 'Month', value: `${month}/12`, percentage: (month / 12) * 100, color: colors[ci++ % colors.length] });
  if (rings.days) activeRings.push({ label: 'Day', value: `${day}/${daysInMonth}`, percentage: (day / daysInMonth) * 100, color: colors[ci++ % colors.length] });
  if (rings.hours) activeRings.push({ label: 'Hour', value: `${Math.floor(hours)}`, percentage: (hours / 24) * 100, color: colors[ci++ % colors.length] });
  if (rings.minutes) activeRings.push({ label: 'Min', value: `${Math.floor(minutes)}`, percentage: (minutes / 60) * 100, color: colors[ci++ % colors.length] });
  if (rings.seconds) activeRings.push({ label: 'Sec', value: `${Math.floor(seconds)}`, percentage: (seconds / 60) * 100, color: colors[ci++ % colors.length] });

  const cx = size / 2, cy = size / 2;
  const ringCount = activeRings.length || 1;
  const ringThickness = Math.min((size / 2 - 30) / (ringCount + 1.5), size / 14);
  const maxR = size / 2 - ringThickness / 2 - 6;
  const ringGap = Math.max(2, size / 120);

  const digitalTime = time.toLocaleTimeString('en-US', { timeZone: timezone, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const digitalDate = time.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' });

  const [hovered, setHovered] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Font sizes scale with clock
  const cityFontSize = Math.max(14, size / 18);
  const timeFontSize = Math.max(20, size / 12);
  const dateFontSize = Math.max(10, size / 28);
  const legendFontSize = Math.max(9, size / 40);

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        onMouseMove={(e) => {
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        }}
        onMouseLeave={() => { setHovered(null); setMousePos(null); }}
      >
        {activeRings.map((ring, i) => {
          const r = maxR - i * (ringThickness + ringGap);
          const circumference = 2 * Math.PI * r;
          const dashLen = circumference * (ring.percentage / 100);
          return (
            <g
              key={ring.label}
              onMouseEnter={() => setHovered(ring.label)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="transparent" strokeWidth={ringThickness + 8} />
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgRingColor} strokeWidth={ringThickness} strokeLinecap="round" />
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke={ring.color}
                strokeWidth={ringThickness}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                opacity={hovered === ring.label ? 1 : 0.85}
                style={{ transition: smooth ? 'opacity 0.15s' : 'stroke-dasharray 0.3s ease, opacity 0.15s' }}
              />
            </g>
          );
        })}
        {/* Center: City, Time, Date */}
        {showCity && (
          <text x={cx} y={cy - timeFontSize * 0.9} textAnchor="middle" dominantBaseline="middle"
            fontSize={cityFontSize} fill={mutedColor} fontFamily="'Inter', system-ui, sans-serif" letterSpacing="0.12em" fontWeight="300">
            {label.toUpperCase()}
          </text>
        )}
        <text x={cx} y={cy + (showCity ? 2 : -timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
          fontSize={timeFontSize} fontWeight="700" fill={textColor} fontFamily="'JetBrains Mono', 'SF Mono', monospace">
          {digitalTime}
        </text>
        {showDate && (
          <text x={cx} y={cy + timeFontSize * 0.85 - (showCity ? 0 : timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
            fontSize={dateFontSize} fill={mutedColor}>
            {digitalDate}
          </text>
        )}
      </svg>
      {/* Tooltip */}
      {hovered && mousePos && (
        <div
          style={{ left: mousePos.x + 12, top: mousePos.y - 12, position: 'absolute' }}
          className="bg-popover/95 backdrop-blur text-popover-foreground border shadow-md px-3 py-1.5 rounded text-sm z-10 pointer-events-none whitespace-nowrap"
        >
          <span className="font-semibold">{hovered}:</span>{' '}
          {activeRings.find(r => r.label === hovered)?.value}
        </div>
      )}
    </div>
  );
}

// ── Background: Lissajous Curves ────────────────────────────────
function LissajousBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const cx = width / 2, cy = height / 2;
    const isDark = theme === 'dark';
    let t = 0;
    let raf: number;

    const draw = () => {
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, 0, width, height);

      const numCurves = 3;
      for (let c = 0; c < numCurves; c++) {
        const freqX = 3 + c * 2 + Math.sin(t * 0.1 + c) * 0.5;
        const freqY = 2 + c * 2 + Math.cos(t * 0.13 + c) * 0.5;
        const phase = t * 0.3 + c * Math.PI / 3;
        const radius = Math.min(width, height) * (0.3 + c * 0.05);

        ctx.beginPath();
        const hue = (c * 120 + t * 10) % 360;
        const alpha = isDark ? 0.15 : 0.1;
        ctx.strokeStyle = `hsla(${hue},70%,${isDark ? 60 : 40}%,${alpha})`;
        ctx.lineWidth = 1.5;

        for (let i = 0; i <= 500; i++) {
          const s = (i / 500) * Math.PI * 2;
          const x = cx + Math.sin(freqX * s + phase) * radius;
          const y = cy + Math.sin(freqY * s) * radius * (height / width);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      t += 0.005;
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = isDark ? 'black' : 'white';
    ctx.fillRect(0, 0, width, height);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Background: Sine Wave Interference ──────────────────────────
function SineWaveBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    let t = 0;
    let raf: number;

    const numWaves = 5;
    const waves = Array.from({ length: numWaves }, (_, i) => ({
      amplitude: 30 + i * 15,
      frequency: 0.005 + i * 0.003,
      speed: 0.02 + i * 0.008,
      phase: (i * Math.PI * 2) / numWaves,
      yOffset: (i + 1) * (height / (numWaves + 1)),
      hue: i * 60,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      t += 0.016;

      for (const wave of waves) {
        ctx.beginPath();
        const alpha = isDark ? 0.12 : 0.08;
        ctx.strokeStyle = `hsla(${(wave.hue + t * 15) % 360},60%,${isDark ? 55 : 40}%,${alpha})`;
        ctx.lineWidth = 2;

        for (let x = 0; x <= width; x += 2) {
          let y = wave.yOffset;
          // Interference from all other waves
          for (const w2 of waves) {
            y += w2.amplitude * Math.sin(x * w2.frequency + t * w2.speed + w2.phase);
          }
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Fill below wave
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = `hsla(${(wave.hue + t * 15) % 360},60%,${isDark ? 55 : 40}%,${isDark ? 0.02 : 0.015})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Background: Apollonian Gasket ───────────────────────────────
function ApollonianBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!width || !height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const isDark = theme === 'dark';
    const cx = width / 2, cy = height / 2;

    interface Circle { x: number; y: number; r: number; depth: number; }
    const circles: Circle[] = [];

    // Generate Apollonian gasket
    function descartes(k1: number, k2: number, k3: number): number {
      return k1 + k2 + k3 + 2 * Math.sqrt(k1 * k2 + k2 * k3 + k1 * k3);
    }

    function apollonian(
      c1: Circle, c2: Circle, c3: Circle, depth: number, maxDepth: number
    ) {
      if (depth > maxDepth) return;
      const k1 = 1 / c1.r, k2 = 1 / c2.r, k3 = 1 / c3.r;
      const k4 = descartes(k1, k2, k3);
      if (k4 <= 0 || 1 / k4 < 2) return;

      // Approximate position using weighted average
      const r4 = 1 / k4;
      const totalK = k1 + k2 + k3;
      const x4 = (c1.x * k1 + c2.x * k2 + c3.x * k3) / totalK;
      const y4 = (c1.y * k1 + c2.y * k2 + c3.y * k3) / totalK;

      const newCircle = { x: x4, y: y4, r: r4, depth };
      circles.push(newCircle);

      apollonian(c1, c2, newCircle, depth + 1, maxDepth);
      apollonian(c1, c3, newCircle, depth + 1, maxDepth);
      apollonian(c2, c3, newCircle, depth + 1, maxDepth);
    }

    const R = Math.min(width, height) * 0.42;
    const outerCircle: Circle = { x: cx, y: cy, r: R, depth: 0 };
    circles.push(outerCircle);

    // Three inner circles tangent to outer and each other
    const r = R / (1 + 2 / Math.sqrt(3));
    const innerCircles: Circle[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      innerCircles.push({
        x: cx + (R - r) * Math.cos(angle),
        y: cy + (R - r) * Math.sin(angle),
        r: r,
        depth: 1,
      });
    }
    circles.push(...innerCircles);

    apollonian(innerCircles[0], innerCircles[1], innerCircles[2], 2, 6);

    // Animate with slow rotation
    let angle = 0;
    let raf: number;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      angle += 0.001;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);

      for (const c of circles) {
        const hue = (c.depth * 45 + angle * 50) % 360;
        const alpha = isDark
          ? Math.max(0.04, 0.2 - c.depth * 0.025)
          : Math.max(0.03, 0.12 - c.depth * 0.015);

        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(c.r, 1), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue},50%,${isDark ? 60 : 40}%,${alpha})`;
        ctx.lineWidth = Math.max(0.5, 2 - c.depth * 0.3);
        ctx.stroke();
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}

// ── Collapsible Settings Section ─────────────────────────────────
function SettingsSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full cursor-pointer group"
      >
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        <motion.div
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function PolarClockPage() {
  const { theme } = useTheme();
  const [time, setTime] = useState(new Date());
  const [smooth, setSmooth] = useState(true);
  const [palette, setPalette] = useState(() => getCookie('polarclock_palette') ?? 'default');
  const [background, setBackground] = useState<'none' | 'gol' | 'julia' | 'mandelbrot' | 'koch' | 'starfield' | 'particles' | 'matrix' | 'voronoi' | 'ripples' | 'lissajous' | 'sinewaves' | 'apollonian'>(() => { const v = getCookie('polarclock_bg'); return v === 'fractal' ? 'julia' : (v as any) ?? 'none'; });
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>(() => (getCookie('polarclock_align') as any) ?? 'center');
  const [showYearBar, setShowYearBar] = useState(() => getCookie('polarclock_yearbar') !== 'false');
  const [showSlots, setShowSlots] = useState(() => getCookie('polarclock_slots_vis') !== 'false');
  const [showCity, setShowCity] = useState(() => getCookie('polarclock_city') !== 'false');
  const [showDate, setShowDate] = useState(() => getCookie('polarclock_date') !== 'false');
  const [showClock, setShowClock] = useState(() => getCookie('polarclock_clock') !== 'false');
  const [juliaManual, setJuliaManual] = useState(() => getCookie('polarclock_julia_manual') === 'true');
  const [juliaCRe, setJuliaCRe] = useState(() => { const v = getCookie('polarclock_julia_re'); return v ? parseFloat(v) : -0.7; });
  const [juliaCIm, setJuliaCIm] = useState(() => { const v = getCookie('polarclock_julia_im'); return v ? parseFloat(v) : 0.27015; });
  const [juliaDragging, setJuliaDragging] = useState(false);
  const [bgOpacity, setBgOpacity] = useState(() => {
    const saved = getCookie('polarclock_bgopacity');
    return saved ? parseFloat(saved) : 1;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [rings, setRings] = useState<RingConfig>(() => {
    const saved = getCookie('polarclock_rings');
    if (saved) try { return JSON.parse(saved); } catch {}
    return { seconds: true, minutes: true, hours: true, days: true, months: true, dayOfYear: false, weekOfYear: false };
  });

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localLabel = localTz.split('/').pop()?.replace(/_/g, ' ') ?? 'Local';

  const [slots, setSlots] = useState<(CitySlot | null)[]>(() => {
    const saved = getCookie('polarclock_slots');
    if (saved) try { return JSON.parse(saved); } catch {}
    return [{ label: localLabel, timezone: localTz }, null, null, null, null];
  });
  const [activeSlot, setActiveSlot] = useState(0);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 's') setShowSettings(prev => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  // Viewport size for background and clock sizing
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Tick
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), smooth ? 50 : 1000);
    return () => clearInterval(interval);
  }, [smooth]);

  // Persist settings
  useEffect(() => { setCookie('polarclock_slots', JSON.stringify(slots)); }, [slots]);
  useEffect(() => { setCookie('polarclock_palette', palette); }, [palette]);
  useEffect(() => { setCookie('polarclock_bg', background); }, [background]);
  useEffect(() => { setCookie('polarclock_align', alignment); }, [alignment]);
  useEffect(() => { setCookie('polarclock_yearbar', String(showYearBar)); }, [showYearBar]);
  useEffect(() => { setCookie('polarclock_slots_vis', String(showSlots)); }, [showSlots]);
  useEffect(() => { setCookie('polarclock_city', String(showCity)); }, [showCity]);
  useEffect(() => { setCookie('polarclock_date', String(showDate)); }, [showDate]);
  useEffect(() => { setCookie('polarclock_clock', String(showClock)); }, [showClock]);
  useEffect(() => { setCookie('polarclock_julia_manual', String(juliaManual)); }, [juliaManual]);
  useEffect(() => { setCookie('polarclock_julia_re', String(juliaCRe)); }, [juliaCRe]);
  useEffect(() => { setCookie('polarclock_julia_im', String(juliaCIm)); }, [juliaCIm]);
  useEffect(() => { setCookie('polarclock_bgopacity', String(bgOpacity)); }, [bgOpacity]);
  useEffect(() => { setCookie('polarclock_rings', JSON.stringify(rings)); }, [rings]);

  const toggleRing = (key: keyof RingConfig) => setRings(prev => ({ ...prev, [key]: !prev[key] }));

  const assignSlot = (slotIdx: number, tz: typeof TIMEZONE_OPTIONS[number]) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIdx] = { label: tz.label, timezone: tz.value };
      return next;
    });
    setActiveSlot(slotIdx);
    setEditingSlot(null);
  };

  const clearSlot = (slotIdx: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
    if (activeSlot === slotIdx) setActiveSlot(0);
    setEditingSlot(null);
  };

  const currentSlot = slots[activeSlot];
  const currentTz = currentSlot?.timezone ?? localTz;
  const currentLabel = currentSlot?.label ?? localLabel;

  // Clock size: fill viewport minus header(64) + hotkey bar(48) + year bar(60) + padding
  const headerH = isFullscreen ? 0 : 64;
  const hotbarH = showSlots ? 48 : 0;
  const yearBarH = showYearBar ? 60 : 0;
  const pad = 16;
  const availH = viewSize.h - headerH - hotbarH - yearBarH - pad;
  const clockSize = Math.max(200, Math.min(availH, viewSize.w - 40));

  const ringLabels: { key: keyof RingConfig; label: string }[] = [
    { key: 'seconds', label: 'Seconds' }, { key: 'minutes', label: 'Minutes' },
    { key: 'hours', label: 'Hours' }, { key: 'days', label: 'Days' },
    { key: 'months', label: 'Months' }, { key: 'dayOfYear', label: 'Day of Year' },
    { key: 'weekOfYear', label: 'Week of Year' },
  ];

  return (
    <>
      {/* Full-viewport container */}
      <div ref={containerRef} className="relative overflow-hidden bg-background" style={{ height: isFullscreen ? '100vh' : `calc(100vh - ${headerH}px)` }}>

        {/* Background layer */}
        <div className="absolute inset-0 z-0" style={{ opacity: bgOpacity }}>
          {background === 'gol' && viewSize.w > 0 && (
            <GOLBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'julia' && viewSize.w > 0 && (
            <JuliaBackground width={viewSize.w} height={viewSize.h - headerH} manual={juliaManual} cRe={juliaCRe} cIm={juliaCIm} dragging={juliaDragging} />
          )}
          {background === 'mandelbrot' && viewSize.w > 0 && (
            <MandelbrotBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'koch' && viewSize.w > 0 && (
            <KochBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'starfield' && viewSize.w > 0 && (
            <StarfieldBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'particles' && viewSize.w > 0 && (
            <ParticleFlowBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'matrix' && viewSize.w > 0 && (
            <MatrixRainBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'voronoi' && viewSize.w > 0 && (
            <VoronoiBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'ripples' && viewSize.w > 0 && (
            <RipplesBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'lissajous' && viewSize.w > 0 && (
            <LissajousBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'sinewaves' && viewSize.w > 0 && (
            <SineWaveBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
          {background === 'apollonian' && viewSize.w > 0 && (
            <ApollonianBackground width={viewSize.w} height={viewSize.h - headerH} />
          )}
        </div>

        {/* Clock — centered */}
        {showClock &&
        <div className={`absolute inset-0 z-10 flex items-center ${
          alignment === 'left' ? 'justify-start pl-8' : alignment === 'right' ? 'justify-end pr-8' : 'justify-center'
        }`} style={{ bottom: hotbarH + yearBarH }}>
          {clockSize > 0 && (
            <PolarClockSVG
              timezone={currentTz}
              label={currentLabel}
              time={time}
              palette={palette}
              smooth={smooth}
              rings={rings}
              size={clockSize}
              showCity={showCity}
              showDate={showDate}
            />
          )}
        </div>}

        {/* Top right controls */}
        <div className="absolute top-4 right-4 z-30 flex gap-2">
          <button
            onClick={toggleFullscreen}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer bg-card/80 backdrop-blur border text-foreground hover:bg-muted"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              showSettings ? 'bg-primary text-primary-foreground' : 'bg-card/80 backdrop-blur border text-foreground hover:bg-muted'
            }`}
          >
            <Settings className={`h-5 w-5 transition-transform ${showSettings ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {/* Settings panel — slides from right */}
        <AnimatePresence>
          {showSettings && (
            <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-20"
              onClick={() => setShowSettings(false)}
            />
            <motion.div
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute top-16 right-4 z-30 w-72 bg-card/95 backdrop-blur-lg border rounded-xl shadow-2xl p-4 space-y-5 max-h-[70vh] overflow-y-auto"
            >
              {/* Background */}
              <SettingsSection title="Background">
                <div className="flex flex-wrap gap-1.5">
                  {([['none', 'None'], ['gol', 'Game of Life'], ['julia', 'Julia Set'], ['mandelbrot', 'Mandelbrot'], ['koch', 'Koch Curve'], ['starfield', 'Starfield'], ['particles', 'Flow Field'], ['matrix', 'Matrix Rain'], ['voronoi', 'Voronoi'], ['ripples', 'Ripples'], ['lissajous', 'Lissajous'], ['sinewaves', 'Sine Waves'], ['apollonian', 'Apollonian']] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setBackground(key)}
                      className={`px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                        background === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {background !== 'none' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-muted-foreground">Opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgOpacity}
                      onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(bgOpacity * 100)}%</span>
                  </div>
                )}
                {background === 'julia' && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setJuliaManual(!juliaManual)}
                        className={`px-2 py-1 rounded text-[10px] cursor-pointer ${juliaManual ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      >{juliaManual ? 'Manual C' : 'Animated'}</button>
                      {juliaManual && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          c = {juliaCRe.toFixed(3)} + {juliaCIm.toFixed(3)}i
                        </span>
                      )}
                    </div>
                    {juliaManual && (
                      <div
                        ref={(el) => { if (el) (el as any).__plotEl = el; }}
                        className="relative w-full aspect-square bg-muted/50 rounded-lg border cursor-crosshair overflow-hidden"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setJuliaDragging(true);
                          const plotEl = e.currentTarget;
                          const update = (ev: MouseEvent | React.MouseEvent) => {
                            const rect = plotEl.getBoundingClientRect();
                            const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                            const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                            setJuliaCRe(x * 4 - 2);
                            setJuliaCIm(y * 4 - 2);
                          };
                          update(e);
                          const onMove = (ev: MouseEvent) => { ev.preventDefault(); update(ev); };
                          const onUp = () => {
                            setJuliaDragging(false);
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                      >
                        {/* Grid lines */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/40" />
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-border/40" />
                        {/* Axis labels */}
                        <span className="absolute bottom-0.5 right-1 text-[8px] text-muted-foreground/50">Re</span>
                        <span className="absolute top-0.5 left-1 text-[8px] text-muted-foreground/50">Im</span>
                        <span className="absolute bottom-0.5 left-1 text-[8px] text-muted-foreground/30">-2</span>
                        <span className="absolute bottom-0.5 right-1 text-[8px] text-muted-foreground/30">2</span>
                        <span className="absolute top-0.5 right-1 text-[8px] text-muted-foreground/30">-2</span>
                        {/* Crosshair dot */}
                        <div
                          className="absolute w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                          style={{
                            left: `${((juliaCRe + 2) / 4) * 100}%`,
                            top: `${((juliaCIm + 2) / 4) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </SettingsSection>

              {/* Palette */}
              <SettingsSection title="Palette">
                <div className="space-y-1">
                  {Object.entries(PALETTES).map(([key, p]) => (
                    <button
                      key={key}
                      onClick={() => setPalette(key)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                        palette === key ? 'bg-primary/15 border border-primary/30' : 'hover:bg-muted'
                      }`}
                    >
                      <div className="flex -space-x-1">
                        {p.colors.slice(0, 5).map((c, i) => (
                          <div key={i} className="w-3 h-3 rounded-full border border-background" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </SettingsSection>

              {/* Rings */}
              <SettingsSection title="Rings">
                <div className="flex flex-wrap gap-1.5">
                  {ringLabels.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => toggleRing(key)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                        rings[key] ? 'bg-primary/15 border border-primary/30 font-medium' : 'bg-muted opacity-50 hover:opacity-80'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </SettingsSection>

              {/* Animation */}
              <SettingsSection title="Animation">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSmooth(true)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${smooth ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Smooth</button>
                  <button
                    onClick={() => setSmooth(false)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${!smooth ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Discrete</button>
                </div>
              </SettingsSection>

              {/* Alignment */}
              <SettingsSection title="Position">
                <div className="flex gap-1.5">
                  {([['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const).map(([key, lbl]) => (
                    <button
                      key={key}
                      onClick={() => setAlignment(key)}
                      className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${alignment === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                    >{lbl}</button>
                  ))}
                </div>
              </SettingsSection>

              {/* Show/Hide UI */}
              <SettingsSection title="Interface">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setShowYearBar(!showYearBar)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showYearBar ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Year Bar</button>
                  <button
                    onClick={() => setShowSlots(!showSlots)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showSlots ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >City Slots</button>
                  <button
                    onClick={() => setShowClock(!showClock)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showClock ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Clock</button>
                  <button
                    onClick={() => setShowCity(!showCity)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showCity ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >City Name</button>
                  <button
                    onClick={() => setShowDate(!showDate)}
                    className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${showDate ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >Date</button>
                </div>
              </SettingsSection>

              <SettingsSection title="Export as Wallpaper" defaultOpen={false}>
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">Export with your current settings as a standalone animated wallpaper.</p>
                  <button
                    onClick={() => {
                      const ws: WallpaperSettings = {
                        palette, background, bgOpacity, smooth, alignment,
                        rings, showCity, showDate,
                        timezone: slots[activeSlot]?.timezone ?? 'America/New_York',
                        cityLabel: slots[activeSlot]?.label ?? 'New York',
                      };
                      const html = generateWallpaperHTML(ws);
                      const proj = generateWEProjectJson();
                      downloadZip('polar-clock-wallpaper-engine.zip', [
                        { name: 'index.html', content: html },
                        { name: 'project.json', content: proj },
                      ]);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Wallpaper Engine
                  </button>
                  <button
                    onClick={() => {
                      const ws: WallpaperSettings = {
                        palette, background, bgOpacity, smooth, alignment,
                        rings, showCity, showDate,
                        timezone: slots[activeSlot]?.timezone ?? 'America/New_York',
                        cityLabel: slots[activeSlot]?.label ?? 'New York',
                      };
                      const html = generateWallpaperHTML(ws);
                      const props = generateLivelyProperties();
                      downloadZip('polar-clock-lively.zip', [
                        { name: 'index.html', content: html },
                        { name: 'LivelyProperties.json', content: props },
                      ]);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Lively Wallpaper
                  </button>
                </div>
              </SettingsSection>
            </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* City Hotkeys — bottom of clock area */}
        {showSlots && <div className="absolute left-0 right-0 z-20 flex items-center px-4" style={{ bottom: yearBarH }}>
          <div className="flex items-center gap-2">
            {slots.map((slot, i) => (
              <div key={i} className="relative">
                <button
                  onClick={() => {
                    if (slot) {
                      setActiveSlot(i);
                      setEditingSlot(null);
                    } else {
                      setEditingSlot(editingSlot === i ? null : i);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (i > 0) setEditingSlot(editingSlot === i ? null : i);
                  }}
                  className={`w-9 h-9 rounded-lg text-sm font-mono font-bold transition-all cursor-pointer ${
                    activeSlot === i && slot
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                      : slot
                      ? 'bg-card/80 backdrop-blur border text-foreground hover:bg-muted'
                      : 'bg-card/40 backdrop-blur border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-card/60'
                  }`}
                  title={slot ? `${slot.label} (right-click to change)` : 'Click to assign'}
                >
                  {i + 1}
                </button>
                {/* Slot label */}
                {slot && activeSlot === i && (
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap font-medium">
                    {slot.label}
                  </span>
                )}

                {/* Slot picker dropdown */}
                <AnimatePresence>
                  {editingSlot === i && (
                    <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.1 }}
                      className="fixed inset-0 z-30"
                      onClick={() => setEditingSlot(null)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-12 left-0 z-40 w-48 max-h-60 overflow-y-auto bg-card/95 backdrop-blur-lg border rounded-lg shadow-xl p-1.5"
                    >
                      {slot && i > 0 && (
                        <button
                          onClick={() => clearSlot(i)}
                          className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-destructive/15 text-destructive cursor-pointer mb-1"
                        >
                          Clear slot
                        </button>
                      )}
                      {TIMEZONE_OPTIONS.map(tz => (
                        <button
                          key={tz.value}
                          onClick={() => assignSlot(i, tz)}
                          className={`w-full text-left px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors ${
                            slot?.timezone === tz.value ? 'bg-primary/15 font-medium' : 'hover:bg-muted'
                          }`}
                        >
                          {tz.label}
                        </button>
                      ))}
                    </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>}

        {/* Year Progress — pinned to very bottom */}
        {showYearBar && <div className="absolute left-0 right-0 bottom-0 z-20 px-4 py-2">
          <div className="flex items-center gap-4 bg-card/70 backdrop-blur-md border rounded-full px-5 py-2 shadow-lg">
            <span className="text-xs font-semibold text-muted-foreground">{time.getFullYear()}</span>
            <div className="flex-1 relative h-2 bg-muted/50 rounded-full overflow-hidden">
              {[25, 50, 75].map(q => (
                <div key={q} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${q}%` }} />
              ))}
              {(() => {
                const year = time.getFullYear();
                const start = new Date(year, 0, 1);
                const end = new Date(year + 1, 0, 1);
                const pct = ((time.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
                return (
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${PALETTES[palette].colors[0]}, ${PALETTES[palette].colors[1]}, ${PALETTES[palette].colors[2]})`,
                      width: `${pct}%`,
                    }}
                  />
                );
              })()}
            </div>
            {(() => {
              const year = time.getFullYear();
              const start = new Date(year, 0, 1);
              const end = new Date(year + 1, 0, 1);
              const elapsed = time.getTime() - start.getTime();
              const total = end.getTime() - start.getTime();
              const pct = (elapsed / total) * 100;
              const dayOfYear = Math.floor(elapsed / 86400000) + 1;
              const daysInYear = Math.floor(total / 86400000);
              return (
                <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
                  <strong className="text-foreground">{pct.toFixed(1)}%</strong>
                  <span>Day {dayOfYear}</span>
                  <span>{daysInYear - dayOfYear} left</span>
                </div>
              );
            })()}
          </div>
        </div>}
      </div>
    </>
  );
}
