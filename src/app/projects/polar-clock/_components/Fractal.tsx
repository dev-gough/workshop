'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAudio } from '@/components/AudioProvider';
import { makeBandReader } from './audio-analysis';

// ── GPU fractals for the dome ────────────────────────────────────
// Every slide here is one full-screen quad and one fragment shader. The
// room is dark-always (see .pc-theme in globals.css), so nothing here
// branches on the site theme — these are all authored for a black sky.

const VERT_SHADER = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * Shared prelude. `shade()` takes a *smooth* (fractional) iteration count
 * so gradients come out banding-free, and returns premultiplied colour —
 * interior points come back fully transparent so the dome shows through
 * and the opacity slider still means something.
 */
const FRACTAL_COMMON = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;

  const float TAU = 6.28318530718;

  // Iñigo Quílez's cosine palette: four vec3s, endless ramps.
  vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // Map plate coordinates to the complex plane (y up, as maths intends).
  vec2 plane(vec2 center, float span) {
    float scale = span / min(u_resolution.x, u_resolution.y);
    vec2 p = (gl_FragCoord.xy - u_resolution * 0.5) * scale;
    return vec2(center.x + p.x, center.y - p.y);
  }
`;

// Escape-time bodies share this tail: fold the smooth iteration count into
// a ramp, keep the interior transparent.
const ESCAPE_SHADE = `
  vec4 shade(float sn, float maxI, vec3 a, vec3 b, vec3 c, vec3 d, float gain) {
    if (sn < 0.0) return vec4(0.0);
    float v = pow(clamp(sn / maxI, 0.0, 1.0), 0.55);
    vec3 col = pal(v, a, b, c, d);
    float alpha = clamp((0.18 + 0.72 * v) * gain, 0.0, 1.0);
    return vec4(col * alpha, alpha);
  }
`;

const JULIA_FRAG = FRACTAL_COMMON + ESCAPE_SHADE + `
  uniform float u_manual;
  uniform vec2 u_c;
  uniform float u_zoom;
  uniform vec2 u_zoomCenter;
  void main() {
    float zoom = u_manual > 0.5 ? max(1.0, u_zoom) : 1.0;
    vec2 center = u_zoomCenter * (1.0 - 1.0 / zoom);
    vec2 z = plane(center, 3.0 / zoom);
    vec2 c = u_manual > 0.5
      ? u_c
      : vec2(-0.7 + 0.15 * cos(u_time), 0.27015 + 0.1 * sin(u_time * 0.7));

    float sn = -1.0;
    for (int i = 0; i < 96; i++) {
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
      if (dot(z, z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z)) / log(2.0)); break; }
    }
    // Violet through cyan — the coldest slide in the tray.
    gl_FragColor = shade(sn, 96.0,
      vec3(0.34, 0.38, 0.50), vec3(0.38, 0.36, 0.44),
      vec3(1.0, 1.0, 1.0), vec3(0.06, 0.32, 0.58), 1.0);
  }
`;

const MANDELBROT_FRAG = FRACTAL_COMMON + ESCAPE_SHADE + `
  void main() {
    // A three-minute dive into Seahorse Valley, fading out over the wrap so
    // the restart reads as a slide change rather than a glitch. u_time
    // advances 0.18/s, so 1.85 puts cycle in units of three seconds.
    float cycle = mod(u_time * 1.85, 60.0);
    float zoom = 1.0 + cycle * cycle * 0.2;
    float fade = smoothstep(0.0, 4.0, cycle) * smoothstep(0.0, 4.0, 60.0 - cycle);
    vec2 c = plane(vec2(-0.7436, 0.1318), 3.0 / zoom);

    vec2 z = vec2(0.0);
    float sn = -1.0;
    for (int i = 0; i < 140; i++) {
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
      if (dot(z, z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z)) / log(2.0)); break; }
    }
    // Midnight blue through brass.
    gl_FragColor = shade(sn, 140.0,
      vec3(0.30, 0.34, 0.44), vec3(0.44, 0.40, 0.32),
      vec3(1.0, 0.94, 0.72), vec3(0.00, 0.18, 0.48), fade);
  }
`;

const BURNINGSHIP_FRAG = FRACTAL_COMMON + ESCAPE_SHADE + `
  void main() {
    // Same recurrence as the Mandelbrot but folded through |Re|, |Im| each
    // step, which shears the bulbs into a fleet of burning hulls. Drifting
    // toward the mast of the mini-ship at the far left of the armada.
    // Held much shallower than the Mandelbrot dive: the armada IS the
    // picture here, and past ~15x you're inside a hull looking at soot.
    float cycle = mod(u_time * 1.85, 60.0);
    float zoom = 1.0 + cycle * cycle * 0.004;
    float fade = smoothstep(0.0, 4.0, cycle) * smoothstep(0.0, 4.0, 60.0 - cycle);
    vec2 c = plane(mix(vec2(-0.5, -0.5), vec2(-1.755, -0.035), smoothstep(0.0, 45.0, cycle)), 3.4 / zoom);

    vec2 z = vec2(0.0);
    float sn = -1.0;
    for (int i = 0; i < 150; i++) {
      vec2 a = abs(z);
      z = vec2(a.x * a.x - a.y * a.y + c.x, 2.0 * a.x * a.y + c.y);
      if (dot(z, z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z)) / log(2.0)); break; }
    }
    // Ember: black hull, red waterline, white-hot rigging.
    //
    // This one shades on its own ramp rather than the shared power curve.
    // Out here almost every point escapes in a handful of steps, so a curve
    // stretched over 150 iterations leaves the whole armada crushed into
    // its bottom eighth — a red wash with the ship lost in it. A log ramp
    // topping out at 48 spends its range where the picture actually is.
    if (sn < 0.0) {
      gl_FragColor = vec4(0.0);
    } else {
      float v = clamp(log(1.0 + sn) / log(49.0), 0.0, 1.0);
      vec3 col = pal(v,
        vec3(0.36, 0.16, 0.08), vec3(0.52, 0.36, 0.20),
        vec3(1.0, 0.92, 0.72), vec3(0.02, 0.13, 0.26));
      float alpha = clamp(0.20 + 0.78 * v, 0.0, 1.0) * fade;
      gl_FragColor = vec4(col * alpha, alpha);
    }
  }
`;

const NEWTON_FRAG = FRACTAL_COMMON + `
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 cdiv(vec2 a, vec2 b) {
    float d = max(dot(b, b), 1e-9);
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
  }
  void main() {
    // Newton's method on z^3 - 1. Every point in the plane belongs to
    // whichever of the three cube roots of unity it falls into, and the
    // borders between those three territories are the fractal.
    float th = u_time * 0.28;
    float breathe = 2.6 + 0.55 * sin(u_time * 0.19);
    vec2 p = plane(vec2(0.0), breathe);
    vec2 z = vec2(p.x * cos(th) - p.y * sin(th), p.x * sin(th) + p.y * cos(th));

    float steps = 0.0;
    for (int i = 0; i < 44; i++) {
      vec2 z2 = cmul(z, z);
      vec2 z3 = cmul(z2, z);
      vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0 * z2);
      z -= delta;
      steps += 1.0;
      if (dot(delta, delta) < 1e-7) break;
    }

    vec2 r0 = vec2( 1.0,  0.0);
    vec2 r1 = vec2(-0.5,  0.86602540);
    vec2 r2 = vec2(-0.5, -0.86602540);
    float d0 = distance(z, r0), d1 = distance(z, r1), d2 = distance(z, r2);
    float root = d0 < d1 ? (d0 < d2 ? 0.0 : 2.0) : (d1 < d2 ? 1.0 : 2.0);

    // Hue picks the basin; brightness records how long it took to fall in,
    // so the boundaries glow and the basin interiors go quiet.
    float speed = 1.0 - clamp(steps / 26.0, 0.0, 1.0);
    vec3 col = pal(root / 3.0 + 0.02 * steps,
      vec3(0.48, 0.46, 0.52), vec3(0.42, 0.40, 0.44),
      vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
    float alpha = 0.16 + 0.62 * pow(speed, 1.4);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

const RESONANCE_FRAG = FRACTAL_COMMON + ESCAPE_SHADE + `
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_treble;
  uniform float u_energy;
  void main() {
    // The Julia constant is the instrument. Bass walks it left along the
    // real axis, treble lifts it off the real line — so the set opens and
    // shatters in time with the track, and drifts gently when it's quiet.
    vec2 c = vec2(
      -0.74 + 0.12 * cos(u_time * 0.6) - u_bass * 0.20,
       0.16 + 0.09 * sin(u_time * 0.43) + u_treble * 0.20
    );
    float zoom = 1.0 + u_bass * 0.45;
    vec2 z = plane(vec2(0.0), 3.0 / zoom);

    float sn = -1.0;
    for (int i = 0; i < 110; i++) {
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
      if (dot(z, z) > 256.0) { sn = float(i) + 1.0 - log2(log(length(z)) / log(2.0)); break; }
    }
    // Mids rotate the ramp, energy opens the aperture.
    vec3 d = vec3(0.08, 0.34, 0.60) + u_mid * 0.30;
    gl_FragColor = shade(sn, 110.0,
      vec3(0.40, 0.38, 0.46), vec3(0.44, 0.42, 0.46),
      vec3(1.0, 0.96, 0.88), d, 0.72 + u_energy * 0.9);
  }
`;

// ── Runner ───────────────────────────────────────────────────────

type UniformSetter = (gl: WebGLRenderingContext, loc: (name: string) => WebGLUniformLocation | null) => void;

function WebGLFractalBackground({ width, height, fragSrc, extraUniforms }: {
  width: number; height: number; fragSrc: string; extraUniforms?: UniformSetter;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    const compile = (src: string, type: number) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(VERT_SHADER, gl.VERTEX_SHADER));
    gl.attachShader(prog, compile(fragSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform lookup is a driver round-trip; the audio slides ask for five
    // of them every frame, so memoise per program.
    const locs = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
      return locs.get(name)!;
    };

    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    // Shaders emit premultiplied alpha, so the source term is ONE.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let raf: number;
    const render = () => {
      timeRef.current += 0.003;
      gl.uniform2f(loc('u_resolution'), width, height);
      gl.uniform1f(loc('u_time'), timeRef.current);
      extraRef.current?.(gl, loc);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [width, height, fragSrc]);

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

  const setUniforms = useCallback<UniformSetter>((gl, loc) => {
    if (manual && !dragging) {
      zoomRef.current += zoomRef.current * 0.0005;
    }
    gl.uniform1f(loc('u_manual'), manual ? 1.0 : 0.0);
    gl.uniform2f(loc('u_c'), cRe, cIm);
    gl.uniform1f(loc('u_zoom'), zoomRef.current);
    gl.uniform2f(loc('u_zoomCenter'), zoomTargetRef.current[0], zoomTargetRef.current[1]);
  }, [manual, cRe, cIm, dragging]);
  return <WebGLFractalBackground width={width} height={height} fragSrc={JULIA_FRAG} extraUniforms={setUniforms} />;
}

export function MandelbrotBackground({ width, height }: { width: number; height: number }) {
  return <WebGLFractalBackground width={width} height={height} fragSrc={MANDELBROT_FRAG} />;
}

export function BurningShipBackground({ width, height }: { width: number; height: number }) {
  return <WebGLFractalBackground width={width} height={height} fragSrc={BURNINGSHIP_FRAG} />;
}

export function NewtonBackground({ width, height }: { width: number; height: number }) {
  return <WebGLFractalBackground width={width} height={height} fragSrc={NEWTON_FRAG} />;
}

/**
 * The Julia set with the music holding the pen. Bass and treble steer the
 * constant `c`, which is the one number that decides the set's whole shape
 * — so the fractal genuinely reshapes to the track rather than having a
 * spectrum bolted onto it.
 */
export function ResonanceBackground({ width, height }: { width: number; height: number }) {
  const { getFrequencyData } = useAudio();
  const readRef = useRef(makeBandReader(getFrequencyData));
  useEffect(() => { readRef.current = makeBandReader(getFrequencyData); }, [getFrequencyData]);

  const setUniforms = useCallback<UniformSetter>((gl, loc) => {
    const b = readRef.current();
    gl.uniform1f(loc('u_bass'), b.bass);
    gl.uniform1f(loc('u_mid'), b.mid);
    gl.uniform1f(loc('u_treble'), b.treble);
    gl.uniform1f(loc('u_energy'), b.energy);
  }, []);

  return <WebGLFractalBackground width={width} height={height} fragSrc={RESONANCE_FRAG} extraUniforms={setUniforms} />;
}
