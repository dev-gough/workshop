'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// One S-cycle. The ground track is x = AMP·sin(2πu), z running the length
// of the pad. Lateral acceleration is only in x, and it flips sign once —
// that sign is what the booster rolls to meet.
const PERIOD = 16;
const AMP = 4.8;
const LENGTH = 16;

const BODY_R = 0.5;
const BODY_H = 5.4;
const FIN_Y = 1.55;

interface Readout {
  phase: string;
  bank: number;
  fin: number;
}

function sample(u: number) {
  const z = -LENGTH / 2 + LENGTH * u;
  const x = AMP * Math.sin(u * Math.PI * 2);
  const y = 3.35;
  return { x, y, z };
}

function accelX(u: number) {
  // d²x/du² of AMP·sin(2πu). Negative on the +x lobe: the turn pulls back
  // toward the centerline, which is the direction the fins have to push.
  return -AMP * (Math.PI * 2) ** 2 * Math.sin(u * Math.PI * 2);
}

function phaseLabel(turn: number): string {
  if (Math.abs(turn) < 0.22) return 'Inflection — fins ease, roll crosses center';
  if (turn > 0) return 'Banking — fin force aimed into the +x lobe';
  return 'Banking — fin force aimed into the −x lobe';
}

function makeGridFin(side: 1 | -1, finMat: THREE.Material, geos: THREE.BufferGeometry[]) {
  const hinge = new THREE.Group();
  hinge.name = side > 0 ? 'fin-pos-x' : 'fin-neg-x';
  hinge.position.set(side * BODY_R, FIN_Y, 0);

  const t = 0.03;
  const span = 1.05;
  const chord = 0.92;
  const height = 1.15;
  const y0 = -height / 2;
  const z0 = -chord / 2;
  // Lattice sits outboard of the hinge. `side` flips the radial axis so the
  // −X fin leaves the body instead of growing back into it.
  const xMid = side * span * 0.58;
  const xThick = 0.045;

  const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, finMat);
    mesh.position.set(x, y, z);
    hinge.add(mesh);
  };

  box(xMid, height / 2, 0, xThick, t, chord);
  box(xMid, y0, 0, xThick, t, chord);
  box(xMid, 0, z0, xThick, height, t);
  box(xMid, 0, chord / 2, xThick, height, t);

  const rows = 4;
  const cols = 4;
  for (let i = 1; i < cols; i++) {
    const z = z0 + (chord * i) / cols;
    box(xMid, 0, z, xThick * 0.72, height - t * 2, t * 0.7);
  }
  for (let i = 1; i < rows; i++) {
    const y = y0 + (height * i) / rows;
    box(xMid, y, 0, xThick * 0.72, t * 0.7, chord - t * 2);
  }

  box(side * span * 0.22, 0, 0, span * 0.42, 0.09, 0.1);
  return hinge;
}

function buildBooster(geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const root = new THREE.Group();
  root.name = 'booster';

  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad,
    metalness: 0.82,
    roughness: 0.32,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1a1d22,
    metalness: 0.55,
    roughness: 0.45,
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xe7e4dc,
    metalness: 0.35,
    roughness: 0.4,
  });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x2c3138,
    metalness: 0.64,
    roughness: 0.38,
  });
  const bell = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    metalness: 0.7,
    roughness: 0.4,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffb25a,
    emissive: 0xff7a2a,
    emissiveIntensity: 0.85,
    roughness: 0.5,
    metalness: 0.1,
  });
  mats.push(steel, dark, white, finMat, bell, glow);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  add(new THREE.CylinderGeometry(BODY_R, BODY_R * 0.98, BODY_H, 28), steel, 0, 0, 0);
  add(new THREE.CylinderGeometry(BODY_R * 1.08, BODY_R * 1.16, 0.55, 28), dark, 0, -BODY_H / 2 + 0.15, 0);
  add(new THREE.CylinderGeometry(BODY_R * 1.02, BODY_R * 1.02, 0.16, 28), white, 0, BODY_H / 2 - 0.55, 0);
  add(new THREE.CylinderGeometry(BODY_R * 1.01, BODY_R * 1.01, 0.22, 28), dark, 0, -0.35, 0);
  add(new THREE.SphereGeometry(BODY_R * 0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, BODY_H / 2, 0);

  const race = new THREE.BoxGeometry(0.06, BODY_H * 0.72, 0.05);
  add(race, white, 0, 0.15, BODY_R + 0.02);

  const skirtY = -BODY_H / 2 - 0.02;
  add(new THREE.CylinderGeometry(0.1, 0.16, 0.28, 12), bell, 0, skirtY, 0);
  add(new THREE.CircleGeometry(0.07, 10), glow, 0, skirtY - 0.15, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.3;
    const z = Math.sin(a) * 0.3;
    add(new THREE.CylinderGeometry(0.07, 0.11, 0.24, 10), bell, x, skirtY, z);
    const throat = add(new THREE.CircleGeometry(0.05, 8), glow, x, skirtY - 0.13, z);
    throat.rotation.x = Math.PI / 2;
  }

  // Exactly two fins, opposite each other on ±X. Their hinge is the body
  // radial, so deflection pushes along body Z — one lateral axis only.
  const finPos = makeGridFin(1, finMat, geos);
  const finNeg = makeGridFin(-1, finMat, geos);
  root.add(finPos, finNeg);

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, FIN_Y, 0),
    1.2,
    0x9fd7e8,
    0.32,
    0.16,
  );
  arrow.name = 'fin-force';
  root.add(arrow);

  return { root, finPos, finNeg, arrow };
}

class GroundS extends THREE.Curve<THREE.Vector3> {
  constructor(private altitude: number) {
    super();
  }
  getPoint(t: number, optionalTarget = new THREE.Vector3()) {
    const p = sample(t);
    return optionalTarget.set(p.x, this.altitude, p.z);
  }
}

export function BoosterStage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const resetRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [readout, setReadout] = useState<Readout>({
    phase: 'Banking — fin force aimed into the turn',
    bank: 0,
    fin: 0,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080c);
    scene.fog = new THREE.Fog(0x07080c, 28, 62);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 90);
    camera.position.set(10.5, 16.5, 17.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.4, 0);
    controls.maxDistance = 40;
    controls.minDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    scene.add(new THREE.AmbientLight(0x8e97a6, 0.55));
    const key = new THREE.DirectionalLight(0xf2f0ea, 2.1);
    key.position.set(8, 14, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd7e8, 0.85);
    rim.position.set(-10, 4, -8);
    scene.add(rim);
    const warm = new THREE.DirectionalLight(0xe2a04a, 0.35);
    warm.position.set(0, 2, 12);
    scene.add(warm);

    const grid = new THREE.GridHelper(48, 24, 0x243040, 0x161b24);
    grid.position.y = 0;
    scene.add(grid);

    const pathMat = new THREE.MeshStandardMaterial({
      color: 0xe2a04a,
      emissive: 0x8a5414,
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.15,
    });
    mats.push(pathMat);

    const flightTube = new THREE.Mesh(new THREE.TubeGeometry(new GroundS(0.06), 180, 0.055, 8, false), pathMat);
    geos.push(flightTube.geometry);
    scene.add(flightTube);

    const { root: booster, finPos, finNeg, arrow } = buildBooster(geos, mats);
    scene.add(booster);

    const beadGeo = new THREE.SphereGeometry(0.12, 16, 12);
    const bead = new THREE.Mesh(beadGeo, pathMat);
    geos.push(beadGeo);
    scene.add(bead);

    const up = new THREE.Vector3(0, 1, 0);
    const finAxis = new THREE.Vector3(1, 0, 0);
    const qRoll = new THREE.Quaternion();
    const qLean = new THREE.Quaternion();
    const dir = new THREE.Vector3();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w < 1 || h < 1) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const clock = new THREE.Clock();
    let elapsed = 0;
    let lastUi = 0;
    let raf = 0;

    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (resetRef.current) {
        elapsed = 0;
        resetRef.current = false;
      }
      if (!pausedRef.current) elapsed += dt;

      const u = (elapsed % PERIOD) / PERIOD;
      const p = sample(u);
      booster.position.set(p.x, p.y, p.z);
      bead.position.set(p.x, 0.12, p.z);

      const ax = accelX(u);
      // Roll about the long axis until body +Z (the only fin-force axis)
      // lies along the lateral acceleration. Lean a little into that same
      // direction so the bank reads as a tilt, not only a fin swap.
      // Denominator is a large fraction of peak accel so the bank sweeps
      // through the S instead of sitting pinned near ±90°.
      const roll = Math.atan2(-ax, 95);
      const lean = THREE.MathUtils.clamp(-ax / 220, -1, 1) * 0.38;
      qRoll.setFromAxisAngle(up, roll);
      finAxis.set(1, 0, 0).applyQuaternion(qRoll);
      qLean.setFromAxisAngle(finAxis, lean);
      booster.quaternion.copy(qLean).multiply(qRoll);

      const turn = Math.sin(u * Math.PI * 2);
      const deflect = turn * 0.62;
      finPos.rotation.x = deflect;
      finNeg.rotation.x = deflect;

      const mag = 0.35 + Math.abs(deflect) * 2.4;
      dir.set(0, 0, Math.sign(deflect) || 1);
      arrow.setDirection(dir);
      arrow.setLength(mag, 0.32, 0.16);

      const now = elapsed;
      if (now - lastUi > 0.12 || resetRef.current) {
        lastUi = now;
        setReadout({
          phase: phaseLabel(turn),
          bank: THREE.MathUtils.radToDeg(roll),
          fin: THREE.MathUtils.radToDeg(deflect),
        });
      }

      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      const seenGeo = new Set<THREE.BufferGeometry>();
      const seenMat = new Set<THREE.Material>();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && !seenGeo.has(mesh.geometry)) {
          seenGeo.add(mesh.geometry);
          mesh.geometry.dispose();
        }
        const mat = mesh.material;
        const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const m of list) {
          if (!seenMat.has(m)) {
            seenMat.add(m);
            m.dispose();
          }
        }
      });
      for (const g of geos) if (!seenGeo.has(g)) g.dispose();
      for (const m of mats) if (!seenMat.has(m)) m.dispose();
    };
  }, []);

  return (
    <div>
      <div className="relative min-h-[60vh] overflow-hidden rounded-lg border border-border bg-[#07080c]">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
          <div className="max-w-sm rounded-md border border-border bg-card/85 px-3 py-2 backdrop-blur-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              {paused ? 'Paused' : 'Live'}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-foreground">{readout.phase}</p>
          </div>
          <div className="rounded-md border border-border bg-card/85 px-3 py-2 text-right font-mono text-[11px] tabular-nums backdrop-blur-sm">
            <p className="text-muted-foreground">
              bank <span className="text-foreground">{readout.bank.toFixed(0)}°</span>
            </p>
            <p className="text-muted-foreground">
              fin <span className="text-primary">{readout.fin.toFixed(0)}°</span>
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3">
          <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
            <span className="rounded-sm border border-border bg-card/85 px-2 py-1 text-[#e2a04a]">S path</span>
            <span className="rounded-sm border border-border bg-card/85 px-2 py-1 text-primary">Fin force · body Z</span>
            <span className="rounded-sm border border-border bg-card/85 px-2 py-1 text-muted-foreground">Fins on ±X only</span>
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                pausedRef.current = !pausedRef.current;
                setPaused(pausedRef.current);
              }}
              className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/50"
            >
              {paused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetRef.current = true;
              }}
              className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/50"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
