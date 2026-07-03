'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

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

export function JuliaBackground({ width, height, manual, cRe, cIm, dragging }: {
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

export function MandelbrotBackground({ width, height }: { width: number; height: number }) {
  return <WebGLFractalBackground width={width} height={height} fragSrc={MANDELBROT_FRAG} />;
}
